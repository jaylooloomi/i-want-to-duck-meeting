"""Local PCM16/16k -> VAD -> speaker embeddings + Paraformer. JSON lines in/out.

Models must already be cached. No downloads or remote calls at runtime.
"""
import argparse
import base64
import json
import os
import queue
import sys
import threading
import time

import numpy as np

RATE = 16000


class SpeechContext:
    """Bounded per-lane history: retain weak consonants around VAD boundaries."""
    def __init__(self, padding=0.3, capacity=30):
        self.padding = int(padding * RATE)
        self.capacity = int(capacity * RATE)
        self.audio = np.empty(0, dtype=np.float32)
        self.base = 0
        self.consumed = 0

    def append(self, audio):
        self.audio = np.concatenate((self.audio, audio))
        excess = max(0, len(self.audio) - self.capacity)
        if excess:
            self.audio = self.audio[excess:]
            self.base += excess

    def region(self, start, samples):
        end = start + len(samples)
        if start < self.base or end > self.base + len(self.audio):
            raise RuntimeError('語音緩衝區不足，已保留錄音；不能靜默截斷語音')
        begin = max(self.base, self.consumed, start - self.padding)
        # Forced maximum-length VAD cuts can end mid-word. Do not borrow a
        # partial tail that the next speech region will decode again.
        finish = end + self.padding if end + self.padding <= self.base + len(self.audio) else end
        begin = min(begin, start)  # never discard original VAD speech
        self.consumed = finish
        return self.audio[begin - self.base:finish - self.base].copy(), begin


def send(**data):
    print(json.dumps(data, ensure_ascii=False), flush=True)


def label(index):
    result = ''
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        result = chr(65 + remainder) + result
    return '講者 ' + result


class Speakers:
    """Conservative online clustering: uncertainty never creates a speaker identity.

    Thresholds are cosine similarities, not calibrated probabilities. A new identity
    requires two independent, consistent windows (at least 3 s total). A voice near
    an established identity stays unknown instead of splitting it into a new one.
    """
    def __init__(self, threshold=0.55, novelty_threshold=0.40, confirmation_threshold=0.65, label_offset=0):
        self.threshold = threshold
        self.novelty_threshold = novelty_threshold
        self.confirmation_threshold = confirmation_threshold
        self.centers = []
        self.candidates = []
        self.clock = 0.0
        self.label_offset = label_offset

    def assign(self, vector, duration=2.0, start=None):
        # Copy: never normalize a caller-owned embedding in place.
        vector = np.array(vector, dtype=np.float32, copy=True)
        if vector.ndim != 1 or not vector.size or not np.all(np.isfinite(vector)):
            return '講者未確認', 0.0
        norm = float(np.linalg.norm(vector))
        if norm < 1e-9 or not np.isfinite(duration) or duration < 1.5:
            return '講者未確認', 0.0
        vector /= norm
        start = self.clock if start is None else float(start)
        if not np.isfinite(start) or start < self.clock - 0.05:
            return '講者未確認', 0.0  # overlapping/replayed windows cannot confirm a new identity
        self.clock = start + duration
        self.candidates = [c for c in self.candidates if start - c['end'] <= 10]
        scores = [float(np.dot(center, vector)) for center in self.centers]
        if scores and max(scores) >= self.threshold:
            index = int(np.argmax(scores))
            best = scores[index]
            if len(scores) > 1 and best - sorted(scores)[-2] < 0.08:
                return '講者未確認', best
            # Adapt only on a very clear match; ambiguous fragments cannot move a profile.
            if best >= 0.75 and (len(scores) == 1 or best - sorted(scores)[-2] >= 0.15):
                center = 0.95 * self.centers[index] + 0.05 * vector
                self.centers[index] = center / np.linalg.norm(center)
            return label(index + self.label_offset), best
        best = max(scores, default=0.0)
        if scores and best >= self.novelty_threshold:
            return '講者未確認', best

        # A single outlier, noise burst, or changed voice quality is only a candidate.
        similarities = [float(np.dot(c['anchor'], vector)) for c in self.candidates]
        if similarities and max(similarities) >= self.confirmation_threshold:
            index = int(np.argmax(similarities))
            if len(similarities) > 1 and max(similarities) - sorted(similarities)[-2] < 0.08:
                return '講者未確認', max(similarities)
            candidate = self.candidates.pop(index)
            center = candidate['anchor'] + vector
            center /= np.linalg.norm(center)
            # The combined evidence must still be clearly distinct from established voices.
            if any(float(np.dot(c, center)) >= self.novelty_threshold for c in self.centers):
                return '講者未確認', best
            self.centers.append(center)
            return label(len(self.centers) - 1 + self.label_offset), max(similarities)
        self.candidates.append({'anchor':vector, 'end':start + duration})
        self.candidates = self.candidates[-8:]  # bounded per-session temporary evidence
        return '講者未確認', best


class Engine:
    def __init__(self, model_dir, mode='microphone'):
        import sherpa_onnx
        from paraformer import Paraformer
        from transcribe import make_converter
        self.asr = Paraformer(model_dir)
        # Preserve spoken vocabulary: s2twp rewrites 代碼 to 程式碼, for example.
        self.converter = make_converter('s2t')
        config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
            model=os.path.join(model_dir, 'speaker-embedding.onnx'), num_threads=2, provider='cpu')
        if not config.validate():
            raise RuntimeError('講者模型設定無效')
        self.extractor = sherpa_onnx.SpeakerEmbeddingExtractor(config)
        self.mode = mode
        self.model_dir = model_dir
        self.speakers = Speakers(label_offset=1 if mode == 'teams' else 0)
        self.vad = self.new_vad()

    def new_vad(self):
        import sherpa_onnx
        config = sherpa_onnx.VadModelConfig()
        config.silero_vad.model = os.path.join(self.model_dir, 'silero_vad.onnx')
        # Keep brief thinking pauses and Chinese/English code-switches together.
        # Cutting just before an English product name loses useful ASR context.
        config.silero_vad.min_silence_duration = 1.2
        config.silero_vad.min_speech_duration = 0.35
        config.silero_vad.max_speech_duration = 15
        config.sample_rate = RATE
        return sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=30)

    def turns(self, audio, offset=0):
        # Probe adjacent 2-second windows to detect a change even without a long pause.
        windows = []
        for start in range(0, len(audio), RATE * 2):
            end = min(start + RATE * 2, len(audio))
            if end - start < RATE and windows:
                windows[-1][1] = end
            else:
                windows.append([start, end])
        turns = []
        for start, end in windows:
            name, confidence = '講者未確認', 0.0
            if end - start >= 1.5 * RATE:
                stream = self.extractor.create_stream()
                stream.accept_waveform(sample_rate=RATE, waveform=audio[start:end])
                stream.input_finished()
                if self.extractor.is_ready(stream):
                    name, confidence = self.speakers.assign(
                        self.extractor.compute(stream), duration=(end - start) / RATE,
                        start=(offset + start) / RATE)
            if turns and turns[-1][2] == name:
                turns[-1][1] = end
            else:
                turns.append([start, end, name, confidence])
        return turns

    def recognize(self, audio, offset, lane='mic'):
        from transcribe import normalize_punct
        from paraformer import normalize_digits
        turns = ([[0, len(audio), '講者 A', 1.0]] if getattr(self, 'mode', '') == 'teams' and lane == 'mic'
                 else self.turns(audio, offset))
        for start, end, speaker, confidence in turns:
            send(type='speaker-turn', speaker=speaker, confidence=round(confidence, 3),
                 start=(offset + start) / RATE, end=(offset + end) / RATE, lane=lane)
        names = {turn[2] for turn in turns}
        send(type='pending', speaker=next(iter(names)) if len(names) == 1 else '講者未確認', start=offset / RATE, lane=lane)
        # Decode the full speech region once. A tentative speaker boundary must never
        # cut a sentence into tiny ASR inputs and lose words on either side.
        segments, _ = self.asr.transcribe(audio)
        groups = []
        duration = len(audio) / RATE
        for segment in segments:
            if segment.no_speech_prob >= 0.8:
                continue
            words = getattr(segment, 'words', None)
            units = [(w.start, w.end, w.word) for w in words] if words else [(segment.start, segment.end, segment.text)]
            for begin, end, text in units:
                begin, end = max(0.0, min(duration, begin)), max(0.0, min(duration, end))
                speaker, confidence = '講者未確認', 0.0
                if words:
                    midpoint = (begin + end) * RATE / 2
                    match = next((turn for turn in turns if turn[0] <= midpoint < turn[1]), None)
                    if match:
                        speaker, confidence = match[2], match[3]
                else:
                    # Without word alignment, a sentence across several identities is unknown.
                    matches = [turn for turn in turns if turn[0] < end * RATE and turn[1] > begin * RATE]
                    if matches and len({turn[2] for turn in matches}) == 1:
                        speaker, confidence = matches[0][2], min(turn[3] for turn in matches)
                if groups and groups[-1]['speaker'] == speaker and begin - groups[-1]['end'] <= 1:
                    groups[-1]['text'] += text
                    groups[-1]['end'] = max(groups[-1]['end'], end)
                    groups[-1]['confidence'] = min(groups[-1]['confidence'], confidence)
                else:
                    groups.append(dict(speaker=speaker, confidence=confidence, text=text, start=begin, end=max(begin, end)))
        for group in groups:
            text = normalize_digits(normalize_punct(self.converter.convert(group['text']).strip()))
            if text:
                send(type='record', speaker=group['speaker'], confidence=round(group['confidence'], 3), text=text,
                     start=offset / RATE + group['start'], end=offset / RATE + group['end'], lane=lane)
        send(type='clear', lane=lane)


def run(model_dir, mode='microphone'):
    engine = Engine(model_dir, mode)
    jobs = queue.Queue(maxsize=20)
    failures = []

    def recognize():
        try:
            while True:
                job = jobs.get()
                if job is None:
                    break
                started = time.monotonic()
                engine.recognize(*job)
                send(type='progress', queued=jobs.qsize(), processingSeconds=round(time.monotonic() - started, 2))
        except Exception as error:
            failures.append(error)
            send(type='error', message=str(error))

    thread = threading.Thread(target=recognize, daemon=True)
    thread.start()
    send(type='ready')
    lanes = {lane:dict(vad=engine.vad if lane == 'mic' else engine.new_vad(), buffer=np.empty(0, dtype=np.float32), offset=None,
                      context=SpeechContext())
             for lane in (['mic', 'system'] if mode == 'teams' else ['mic'])}

    def drain(lane):
        state = lanes[lane]
        while not state['vad'].empty():
            segment = state['vad'].front
            samples, start = state['context'].region(segment.start, segment.samples)
            try:
                jobs.put_nowait((samples, start + (state['offset'] or 0), lane))
            except queue.Full:
                raise RuntimeError('辨識速度不足，已停止收音以免持續累積延遲；錄音已保留')
            state['vad'].pop()

    for line in sys.stdin:
        if failures:
            raise failures[0]
        packet = json.loads(line)
        lane = packet.get('lane', 'mic')
        if lane not in lanes:
            raise ValueError('未知音訊軌道')
        state = lanes[lane]
        if state['offset'] is None:
            state['offset'] = int(packet.get('offset', 0))
        audio = np.frombuffer(base64.b64decode(packet['pcm'], validate=True), dtype='<i2').astype(np.float32) / 32768
        state['buffer'] = np.concatenate((state['buffer'], audio))
        while len(state['buffer']) >= 512:
            chunk = state['buffer'][:512]
            state['context'].append(chunk)
            state['vad'].accept_waveform(chunk)
            state['buffer'] = state['buffer'][512:]
            drain(lane)
    for lane, state in lanes.items():
        if len(state['buffer']):
            chunk = np.pad(state['buffer'], (0, 512 - len(state['buffer'])))
            state['context'].append(chunk)
            state['vad'].accept_waveform(chunk)
        state['vad'].flush()
        drain(lane)
    while thread.is_alive():
        try:
            jobs.put(None, timeout=0.2)
            break
        except queue.Full:
            continue
    thread.join()
    if failures:
        raise failures[0]
    send(type='done')


if __name__ == '__main__':
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding='utf-8', errors='replace')
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-dir', required=True)
    parser.add_argument('--mode', choices=['microphone', 'teams'], default='microphone')
    args = parser.parse_args()
    try:
        run(args.model_dir, args.mode)
    except Exception as error:
        send(type='error', message=str(error))
        sys.exit(1)
