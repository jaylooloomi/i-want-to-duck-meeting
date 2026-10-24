"""Offline Paraformer evidence from one immutable PCM16 WAV snapshot. No prompts."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import sys
import wave

import numpy as np

from paraformer import Paraformer, normalize_digits
from transcribe import make_converter


def read_snapshot(audio_path):
    raw = Path(audio_path).read_bytes()
    with wave.open(io.BytesIO(raw), 'rb') as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getcomptype()) != (1, 2, 16000, 'NONE'):
            raise ValueError('Expected mono PCM16 WAV at 16000 Hz')
        expected = audio.getnframes() * 2
        pcm = audio.readframes(audio.getnframes())
        if len(pcm) != expected:
            raise ValueError('Truncated PCM data')
    return raw, np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768


def verify_audio(audio_path, model_dir, recognizer=None, converter=None):
    raw, samples = read_snapshot(audio_path)
    if not len(samples):
        raise ValueError('Empty audio')
    engine = recognizer if recognizer is not None else Paraformer(str(model_dir))
    cc = converter if converter is not None else make_converter('s2t')
    segments, _ = engine.transcribe(samples)
    text = cc.convert(' '.join(normalize_digits(s.text) for s in segments))
    return {
        'source': 'offline-paraformer',
        'audioSha256': hashlib.sha256(raw).hexdigest(),
        'decodedText': text,
        'sampleRate': 16000,
        'seconds': len(samples) / 16000,
        'peak': int(np.max(np.abs(samples)) * 32768),
        'provenance': 'Decoded local WAV; meeting route and speaker identity are not inferred',
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audio', required=True)
    parser.add_argument('--model-dir', required=True)
    parser.add_argument('--out', help='New JSON file; never overwrites an existing result')
    args = parser.parse_args(argv)
    try:
        if args.out and Path(args.out).exists():
            raise ValueError('Output already exists; choose a new path')
        report = verify_audio(args.audio, args.model_dir)
        encoded = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
        if args.out:
            with open(args.out, 'x', encoding='utf8') as target:
                target.write(encoded)
        print(encoded, end='')
        return 0
    except (OSError, ValueError, RuntimeError, wave.Error) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    for output in (sys.stdout, sys.stderr):
        if hasattr(output, 'reconfigure'):
            output.reconfigure(encoding='utf8')
    raise SystemExit(main())
