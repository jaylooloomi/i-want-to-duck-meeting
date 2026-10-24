"""Offline Chinese ASR. No prompts, expected phrases, or network calls at runtime."""
import os
import re
from types import SimpleNamespace

_DIGITS = str.maketrans('零〇一二三四五六七八九', '00123456789')


def normalize_digits(text):
    # Only literal digit sequences; never infer missing digits or rewrite quantities.
    return re.sub(r'[零〇一二三四五六七八九]{3,}',
                  lambda match: match.group().translate(_DIGITS), text)


class Paraformer:
    def __init__(self, model_dir):
        import sherpa_onnx
        self.recognizer = sherpa_onnx.OfflineRecognizer.from_paraformer(
            paraformer=os.path.join(model_dir, 'paraformer.int8.onnx'),
            tokens=os.path.join(model_dir, 'paraformer-tokens.txt'),
            num_threads=8, sample_rate=16000, feature_dim=80,
            decoding_method='greedy_search', provider='cpu')

    def transcribe(self, audio):
        stream = self.recognizer.create_stream()
        stream.accept_waveform(16000, audio)
        self.recognizer.decode_stream(stream)
        text = stream.result.text.strip()
        # Tokens contain BPE fragments. Keep the decoder's authoritative text rather
        # than guessing word alignment; mixed-speaker regions remain unidentified.
        return ([SimpleNamespace(start=0, end=len(audio) / 16000, text=text,
                                 no_speech_prob=0, words=None)] if text else []), None
