"""Make two independent Teams-style audio lanes with a deliberate overlap."""
import argparse
import json
from pathlib import Path
import wave
import numpy as np
from build_speaker_validation import build


def create(source, destination):
    destination = Path(destination)
    reference = destination / 'reference.wav'
    build(source, reference)
    plan = json.loads(reference.with_suffix('.json').read_text(encoding='utf-8'))
    with wave.open(str(reference)) as audio:
        samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype='<i2')
    lanes = {}
    for lane, person in [('mic', 'person-1'), ('system', 'person-2')]:
        result = np.zeros_like(samples)
        for turn in plan['turns']:
            if turn['person'] == person:
                start, end = int(turn['start'] * 16000), int(turn['end'] * 16000)
                result[start:end] = samples[start:end]
        lanes[lane] = result
    # The remote person interrupts during the local person's final long turn.
    lanes['system'][44 * 16000:48 * 16000] = samples[20 * 16000:24 * 16000]
    plan['overlap'] = {'start':44, 'end':48, 'mic':'講者 A', 'system':'講者 B'}
    for lane, data in lanes.items():
        with wave.open(str(destination / f'teams-{lane}.wav'), 'wb') as audio:
            audio.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            audio.writeframes(data.tobytes())
    (destination / 'plan.json').write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--output-dir', required=True)
    args = parser.parse_args()
    create(args.source, args.output_dir)
