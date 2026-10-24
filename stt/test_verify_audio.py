import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
import wave

import numpy as np

from verify_audio import read_snapshot, verify_audio, main


class EvidenceTest(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.audio = Path(self.temp.name) / 'input.wav'
        self.write_wave()

    def write_wave(self, rate=16000, frames=b'\x00\x10' * 16000):
        with wave.open(str(self.audio), 'wb') as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(rate)
            output.writeframes(frames)

    def test_transcript_binds_to_bytes_actually_decoded_even_if_source_changes(self):
        original = self.audio.read_bytes()
        test = self

        class Engine:
            def transcribe(self, samples):
                test.assertEqual(len(samples), 16000)
                test.assertTrue(np.allclose(samples, 0.125))
                test.audio.write_bytes(b'changed during decoding')
                return [SimpleNamespace(text='测试代码一三五七')], None

        converter = SimpleNamespace(convert=lambda value: value.replace('测试代码', '測試代碼'))
        report = verify_audio(self.audio, 'unused', Engine(), converter)
        self.assertEqual(report['audioSha256'], hashlib.sha256(original).hexdigest())
        self.assertEqual(report['decodedText'], '測試代碼1357')
        self.assertEqual(report['seconds'], 1)

    def test_rejects_wrong_rate_truncation_and_empty_audio(self):
        self.write_wave(rate=8000)
        with self.assertRaises(ValueError):
            read_snapshot(self.audio)
        self.write_wave()
        self.audio.write_bytes(self.audio.read_bytes()[:-4])
        with self.assertRaises(ValueError):
            read_snapshot(self.audio)
        self.write_wave(frames=b'')
        with self.assertRaises(ValueError):
            verify_audio(self.audio, 'unused')

    def test_existing_evidence_cannot_be_overwritten(self):
        output = Path(self.temp.name) / 'evidence.json'
        output.write_text('keep', encoding='utf8')
        self.assertEqual(main(['--audio', str(self.audio), '--model-dir', 'unused', '--out', str(output)]), 1)
        self.assertEqual(output.read_text(), 'keep')


if __name__ == '__main__':
    unittest.main()
