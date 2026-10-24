"""Build a deterministic two-person test from the public four-speaker Chinese fixture.

Input: csukuangfj/speaker-embedding-models/0-four-speakers-zh.wav (0743f30).
No downloads and no synthetic voice cloning. Reuses two known speech regions,
changes gain/adds mild noise, and includes a short turn that should stay unknown.
"""
import argparse
import json
from pathlib import Path
import wave
import numpy as np


def build(source, destination):
    with wave.open(str(source)) as audio:
        assert audio.getframerate() == 16000 and audio.getnchannels() == 1
        width = audio.getsampwidth()
        raw = audio.readframes(audio.getnframes())
    samples = ((np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128) / 128
               if width == 1 else np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768)
    rate = 16000
    clips = {'person-1':samples[int(0.61 * rate):int(6.61 * rate)],
             'person-2':samples[int(27.682 * rate):int(31.682 * rate)]}
    plan = [('person-1', 1.0, 0.0, None), ('person-2', 1.0, 0.0, None),
            ('person-1', 0.45, 0.0, None), ('person-2', 0.65, 0.003, None),
            ('person-1', 0.8, 0.0, 0.7), ('person-1', 0.8, 0.0, None)]
    pieces = [np.zeros(rate * 12, dtype=np.float32)]
    annotations = []
    cursor = 12.0
    rng = np.random.default_rng(20261024)
    for person, gain, noise, length in plan:
        clip = clips[person].copy()
        if length is not None:
            clip = clip[:int(length * rate)]
        clip = clip * gain + rng.normal(0, noise, len(clip)).astype(np.float32)
        annotations.append({'person':person, 'start':cursor, 'end':cursor + len(clip) / rate,
                            'short':length is not None, 'gain':gain, 'noise':noise})
        pieces.extend([clip, np.zeros(rate * 2, dtype=np.float32)])
        cursor += len(clip) / rate + 2
    data = np.concatenate(pieces)
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(destination), 'wb') as output:
        output.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        output.writeframes((np.clip(data, -1, 1) * 32767).astype('<i2').tobytes())
    destination.with_suffix('.json').write_text(json.dumps({'duration':len(data) / rate, 'turns':annotations}, indent=2), encoding='utf-8')
    print(f'Built {len(data) / rate:.1f}s, {len(annotations)} turns: {destination}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    build(args.source, args.output)
