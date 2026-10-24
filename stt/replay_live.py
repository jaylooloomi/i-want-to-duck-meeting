"""Replay saved 16 kHz mono PCM16 WAVs through the actual live JSON protocol.

No transcription targets are supplied. JSONL output is suitable for comparison
with the original recording; files stay local.
"""
import argparse
import base64
import json
from pathlib import Path
import subprocess
import sys
import wave


def replay(model_dir, output, microphone=None, system=None):
    packets = []
    for lane, filename in [('mic', microphone), ('system', system)]:
        if not filename:
            continue
        with wave.open(str(filename), 'rb') as audio:
            if (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) != (16000, 1, 2):
                raise ValueError('Replay requires 16 kHz mono PCM16 WAV')
            offset = 0
            while pcm := audio.readframes(1600):
                packets.append((offset, lane, pcm))
                offset += len(pcm) // 2
    packets.sort(key=lambda item: item[0])
    payload = ''.join(json.dumps(dict(lane=lane, offset=offset,
                       pcm=base64.b64encode(pcm).decode('ascii'))) + '\n'
                      for offset, lane, pcm in packets)
    result = subprocess.run([sys.executable, str(Path(__file__).with_name('live.py')),
                             '--model-dir', str(model_dir), '--mode', 'teams'],
                            input=payload, capture_output=True, encoding='utf-8', timeout=300)
    Path(output).write_text(result.stdout, encoding='utf-8')
    if result.returncode:
        raise RuntimeError(result.stderr + '\n' + result.stdout)
    events = [json.loads(line) for line in result.stdout.splitlines()]
    if not events or events[-1].get('type') != 'done' or any(e.get('type') == 'error' for e in events):
        raise RuntimeError('Replay did not finish successfully')
    for event in events:
        if event.get('type') == 'record':
            print(json.dumps(event, ensure_ascii=False))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model-dir', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--microphone')
    parser.add_argument('--system')
    args = parser.parse_args()
    if not args.microphone and not args.system:
        parser.error('Provide --microphone and/or --system')
    replay(args.model_dir, args.output, args.microphone, args.system)
