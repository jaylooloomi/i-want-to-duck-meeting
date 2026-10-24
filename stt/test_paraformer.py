import unittest
from types import SimpleNamespace
from unittest.mock import Mock
import numpy as np
from paraformer import Paraformer, normalize_digits


class ParaformerTests(unittest.TestCase):
    def test_live_traditional_conversion_preserves_spoken_vocabulary(self):
        from transcribe import make_converter
        self.assertEqual(make_converter('s2t').convert('确认代码是一三五七'), '確認代碼是一三五七')

    def test_only_literal_digit_runs_are_converted(self):
        self.assertEqual(normalize_digits('代碼是一三五七'), '代碼是1357')
        self.assertEqual(normalize_digits('〇零二四'), '0024')
        self.assertEqual(normalize_digits('一三七'), '137')  # never insert a missing 5
        self.assertEqual(normalize_digits('一百三十五元，二十三人，一三'), '一百三十五元，二十三人，一三')
        self.assertEqual(normalize_digits('Teams 傳送區域內容'), 'Teams 傳送區域內容')

    def test_decoder_text_is_preserved_without_fabricated_alignment(self):
        asr = Paraformer.__new__(Paraformer)
        stream = SimpleNamespace(result=SimpleNamespace(text=' 我是手机端 tips 一三五七 '),
                                 accept_waveform=Mock())
        asr.recognizer = SimpleNamespace(create_stream=lambda: stream, decode_stream=Mock())
        segments, _ = asr.transcribe(np.zeros(32000, dtype=np.float32))
        self.assertEqual(segments[0].text, '我是手机端 tips 一三五七')
        self.assertIsNone(segments[0].words)
        self.assertEqual(segments[0].end, 2)
        stream.result.text = ''
        self.assertEqual(asr.transcribe(np.zeros(16000))[0], [])


if __name__ == '__main__':
    unittest.main()
