"""Download model assets once; recognition itself always uses offline/local files."""
import argparse
import hashlib
from pathlib import Path
from urllib.request import urlopen

ASSETS = [
    ('speaker-embedding.onnx',
     'https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/0743f30/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
     'aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2'),
    ('silero_vad.onnx',
     'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx',
     '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6'),
]


def setup(directory):
    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    for name, url, checksum in ASSETS:
        target = directory / name
        if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == checksum:
            continue
        temporary = directory / (name + '.download')
        print(f'Downloading {name}', flush=True)
        with urlopen(url, timeout=120) as response, temporary.open('wb') as output:
            while block := response.read(1024 * 1024):
                output.write(block)
        if hashlib.sha256(temporary.read_bytes()).hexdigest() != checksum:
            temporary.unlink()
            raise RuntimeError(f'Checksum mismatch: {name}')
        temporary.replace(target)
    from faster_whisper import WhisperModel
    WhisperModel('small', device='cpu', compute_type='int8', download_root=str(directory))
    print('Local microphone models ready', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-dir', default=str(Path(__file__).resolve().parent.parent / 'models'))
    setup(parser.parse_args().model_dir)
