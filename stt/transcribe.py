"""openmeeting Whisper fallback (spec 5.16).

Transcribes a meeting WAV on CPU with faster-whisper (int8) and converts the text to
Traditional Chinese (Taiwan phrasing) with OpenCC s2twp.

Usage:
  python transcribe.py --audio <wav> --out-dir <dir> [--model large-v3-turbo] [--threads 14]
                       [--lang zh] [--model-dir <dir>]

Writes <out-dir>/transcript-whisper.json and <out-dir>/transcript-whisper.md and prints
SEGMENTS=<n> on stdout on success. Progress/diagnostics go to stderr.
Exit codes: 0 ok, 1 unexpected error, 2 bad arguments / missing audio.
"""

import argparse
import json
import os
import re
import sys
import time

INITIAL_PROMPT = '以下是台灣會議的逐字稿，使用繁體中文，專有名詞保留English。'
MD_HEADER = '# 逐字稿（Whisper 備援）'
MD_EMPTY = '（沒有辨識出任何語音）'
JSON_NAME = 'transcript-whisper.json'
MD_NAME = 'transcript-whisper.md'


def _utf8_stdio():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
        except (AttributeError, ValueError):
            pass


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def parse_args(argv=None):
    p = argparse.ArgumentParser(description='openmeeting Whisper fallback transcriber')
    p.add_argument('--audio', required=True, help='input audio file (16 kHz mono WAV recommended)')
    p.add_argument('--out-dir', required=True, help='directory for transcript-whisper.{json,md}')
    p.add_argument('--model', default='large-v3-turbo', help='faster-whisper model name or path')
    p.add_argument('--threads', type=int, default=14, help='CPU threads for CTranslate2')
    p.add_argument('--lang', default='zh', help='spoken language code (default zh)')
    p.add_argument('--model-dir', default=None, help='download/cache directory for models')
    return p.parse_args(argv)


def make_converter(config='s2twp'):
    """OpenCC s2twp converter; accepts both config spellings used by different bindings."""
    from opencc import OpenCC

    last_err = None
    for name in (config, config + '.json'):
        try:
            cc = OpenCC(name)
            cc.convert('测试')
            return cc
        except Exception as err:  # noqa: BLE001 - try the next spelling
            last_err = err
    raise RuntimeError(f'OpenCC {config} config not available: {last_err}')


_FULLWIDTH = {',': '，', '?': '？', '!': '！', ';': '；', ':': '：'}
_CJK = r'[㐀-鿿豈-﫿]'
_CJK_PUNCT_RE = re.compile(rf'(?<={_CJK})\s*([,?!;:])\s*|\s*([,?!;:])\s*(?={_CJK})')


def normalize_punct(text):
    """Whisper emits ASCII punctuation in Chinese; use full-width next to CJK characters (zh-TW style)."""
    return _CJK_PUNCT_RE.sub(lambda m: _FULLWIDTH[m.group(1) or m.group(2)], text)


def fmt_mmss(seconds):
    total = int(max(0.0, seconds))
    return f'{total // 60:02d}:{total % 60:02d}'


def load_model(whisper_model_cls, name, threads, model_dir):
    """Prefer the already-downloaded copy (works offline, no Hub round-trip); download if missing."""
    kwargs = dict(device='cpu', compute_type='int8', cpu_threads=threads, download_root=model_dir)
    if not os.path.isdir(name):
        try:
            return whisper_model_cls(name, local_files_only=True, **kwargs)
        except Exception:  # noqa: BLE001 - not cached yet (or incomplete): fetch it
            log(f'model {name} not cached in {model_dir or "default cache"}; downloading (first run only)')
    return whisper_model_cls(name, **kwargs)


def render_md(segments):
    lines = [MD_HEADER, '']
    if not segments:
        lines.append(MD_EMPTY)
    for seg in segments:
        lines.append(f"[{fmt_mmss(seg['start'])}] {seg['text']}")
    return '\n'.join(lines) + '\n'


def write_text(path, text):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    os.replace(tmp, path)


def main(argv=None):
    _utf8_stdio()
    args = parse_args(argv)

    audio = os.path.abspath(args.audio)
    out_dir = os.path.abspath(args.out_dir)
    if not os.path.isfile(audio):
        log(f'error: audio file not found: {audio}')
        return 2
    os.makedirs(out_dir, exist_ok=True)
    model_dir = os.path.abspath(args.model_dir) if args.model_dir else None
    if model_dir:
        os.makedirs(model_dir, exist_ok=True)

    cc = make_converter()

    from faster_whisper import WhisperModel

    t0 = time.time()
    log(f'loading model {args.model} (cpu/int8, threads={args.threads}, dir={model_dir or "default"})')
    model = load_model(WhisperModel, args.model, args.threads, model_dir)
    log(f'model ready in {time.time() - t0:.1f}s; transcribing {audio}')

    t1 = time.time()
    seg_iter, info = model.transcribe(
        audio,
        language=args.lang,
        vad_filter=True,
        condition_on_previous_text=False,
        beam_size=5,
        initial_prompt=INITIAL_PROMPT,
    )

    segments = []
    for seg in seg_iter:
        text = normalize_punct(cc.convert(seg.text or '').strip())
        if not text:
            continue
        item = {'start': round(float(seg.start), 2), 'end': round(float(seg.end), 2), 'text': text}
        segments.append(item)
        log(f"[{fmt_mmss(item['start'])}] {text}")

    duration = float(getattr(info, 'duration', 0.0) or 0.0)
    log(f'transcribed {duration:.1f}s of audio in {time.time() - t1:.1f}s')

    doc = {
        'model': args.model,
        'language': getattr(info, 'language', None) or args.lang,
        'duration': round(duration, 2),
        'segments': segments,
    }
    json_path = os.path.join(out_dir, JSON_NAME)
    md_path = os.path.join(out_dir, MD_NAME)
    write_text(json_path, json.dumps(doc, ensure_ascii=False, indent=2) + '\n')
    write_text(md_path, render_md(segments))

    print(f'JSON={json_path}', flush=True)
    print(f'MD={md_path}', flush=True)
    print(f'SEGMENTS={len(segments)}', flush=True)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log('interrupted')
        sys.exit(130)
