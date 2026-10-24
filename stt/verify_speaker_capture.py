"""Verify real browser capture against the two-person fixture's known turn schedule.

Align actual captured audio with the fixture by waveform correlation, rather than
assuming model loading/Chrome capture starts at a fixed time. No network calls.
"""
import argparse
import json
from pathlib import Path
import wave
import numpy as np
from datetime import datetime


def read_wav(filename):
    with wave.open(str(filename)) as audio:
        assert audio.getframerate() == 16000 and audio.getnchannels() == 1
        assert audio.getsampwidth() == 2
        return np.frombuffer(audio.readframes(audio.getnframes()), dtype='<i2').astype(np.float32) / 32768


def verify(capture_path):
    capture_path = Path(capture_path)
    capture = json.loads(capture_path.read_text(encoding='utf-8'))
    fixture = Path(capture['fixture'])
    plan = json.loads(fixture.with_suffix('.json').read_text(encoding='utf-8'))
    original = read_wav(fixture)[::32]
    recorded = read_wav(capture['capturedWav'])[::32]
    size = 1 << (len(original) + len(recorded) - 1).bit_length()
    correlation = np.fft.irfft(np.fft.rfft(recorded, size) * np.conj(np.fft.rfft(original, size)), size)
    lags = np.arange(-15 * 500, 1)
    lag = int(lags[np.argmax(correlation[lags % size])])
    offset = -lag / 500
    matched = []
    mapping = {}
    mistakes = []
    for record in capture['records']:
        start = datetime.fromisoformat(record['t0'].replace('Z', '+00:00')).timestamp() - capture['audioStart'] / 1000 + offset
        end = datetime.fromisoformat(record['t1'].replace('Z', '+00:00')).timestamp() - capture['audioStart'] / 1000 + offset
        midpoint = (start + end) / 2
        turn_index = next((i for i, turn in enumerate(plan['turns']) if turn['start'] - 0.15 <= midpoint <= turn['end'] + 0.15), None)
        if turn_index is None:
            mistakes.append(f'Text outside a known speech turn: {midpoint:.2f}s {record["speaker"]}')
            continue
        turn = plan['turns'][turn_index]
        speaker = record['speaker']
        matched.append({'turn':turn_index + 1, 'expected':turn['person'], 'speaker':speaker,
                        'short':turn['short'], 'start':round(start, 2), 'text':record['text']})
        if speaker == '講者未確認':
            continue
        if turn['short']:
            mistakes.append(f'Short turn received a confirmed identity: {speaker}')
        mapping.setdefault(turn['person'], set()).add(speaker)
    for person, identities in mapping.items():
        if len(identities) != 1:
            mistakes.append(f'Identity split: {person} -> {sorted(identities)}')
    if set(mapping) != {'person-1', 'person-2'}:
        mistakes.append('Both people must have confirmed text')
    if mapping.get('person-1', set()) & mapping.get('person-2', set()):
        mistakes.append('Two different people were merged into one identity')
    for i, turn in enumerate(plan['turns'], 1):
        if not turn['short'] and not any(m['turn'] == i and m['speaker'] != '講者未確認' for m in matched):
            mistakes.append(f'No confirmed text for long turn {i}')
    speaker_decisions = []
    for decision in capture.get('speakerTurns', []):
        midpoint = (decision['start'] + decision['end']) / 2 + offset
        turn = next((turn for turn in plan['turns'] if turn['start'] - 0.2 <= midpoint <= turn['end'] + 0.2), None)
        if not turn:
            continue
        name = decision['speaker']
        speaker_decisions.append({'expected':turn['person'], 'speaker':name, 'short':turn['short']})
        if name != '講者未確認':
            if turn['short']:
                mistakes.append('Short turn had a confirmed speaker decision')
            if name not in mapping.get(turn['person'], set()):
                mistakes.append(f'Incorrect voice decision: {turn["person"]} -> {name}')
    report = {'passed':not mistakes, 'alignmentOffsetSeconds':offset,
              'firstTextAfterStartSeconds':round(capture['firstTextAfterSeconds'], 2),
              'mapping':{k:sorted(v) for k, v in mapping.items()},
              'unknownRecords':sum(m['speaker'] == '講者未確認' for m in matched),
              'confirmedRecords':sum(m['speaker'] != '講者未確認' for m in matched),
              'turns':matched, 'speakerDecisions':speaker_decisions, 'mistakes':mistakes,
              'scope':'Known public human recordings through Chromium virtual microphone; not a physical room/acoustic test.'}
    capture_path.with_name('verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if mistakes:
        raise SystemExit(1)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('capture')
    verify(parser.parse_args().capture)
