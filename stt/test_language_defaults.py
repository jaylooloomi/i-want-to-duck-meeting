"""Language routing contracts; no microphone, network or model download."""
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from live import LocalMultilingualASR, Engine
import numpy as np


class LanguageDefaultsTests(unittest.TestCase):
    def test_multilingual_model_is_local_only_and_receives_language(self):
        calls = {}
        class Model:
            def __init__(self, name, **kwargs):
                calls.update(name=name, **kwargs)
            def transcribe(self, audio, **kwargs):
                calls.update(kwargs)
                return [], None
        with patch.dict(sys.modules, {'faster_whisper': SimpleNamespace(WhisperModel=Model)}):
            asr = LocalMultilingualASR('/synthetic-model-cache', 'de')
            asr.transcribe(np.zeros(16000, dtype=np.float32))
        self.assertTrue(calls['local_files_only'])
        self.assertEqual(calls['language'], 'de')
        self.assertNotIn('initial_prompt', calls)

    def test_missing_multilingual_model_does_not_instantiate_chinese_asr(self):
        def missing(*args, **kwargs):
            raise RuntimeError('No local model')
        with patch.dict(sys.modules, {'faster_whisper': SimpleNamespace(WhisperModel=missing)}):
            asr = LocalMultilingualASR('/missing', 'ja')
        self.assertIsNone(asr.model)
        self.assertEqual(asr.transcribe(np.zeros(100)), ([], None))

    def test_japanese_output_bypasses_chinese_conversion(self):
        engine = Engine.__new__(Engine)
        engine.language = 'ja'
        engine.mode = 'teams'
        engine.asr = SimpleNamespace(transcribe=lambda _: ([SimpleNamespace(start=0, end=1, text='会議の準備', no_speech_prob=0)], None))
        engine.converter = SimpleNamespace(convert=lambda _: self.fail('Chinese conversion must not run'))
        events = []
        with patch('live.send', side_effect=lambda **event: events.append(event)):
            engine.recognize(np.zeros(16000, dtype=np.float32), 0, 'mic')
        self.assertEqual(next(event['text'] for event in events if event['type']=='record'), '会議の準備')


if __name__ == '__main__':
    unittest.main()
