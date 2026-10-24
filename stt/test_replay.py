"""Opt-in private WAV regression. Audio and expected text are never sent to ASR.

Set OPENMEETING_REPLAY_SYSTEM_WAV and OPENMEETING_REPLAY_EXPECTED_SYSTEM to
exercise the real live protocol; fixtures and output remain local.
"""
import contextlib
import io
import json
import os
from pathlib import Path
import re
import tempfile
import unittest
from replay_live import replay


def comparison_text(text):
    return re.sub(r'[\W_]+', '', text).casefold()


class SavedAudioTests(unittest.TestCase):
    @unittest.skipUnless(os.environ.get('OPENMEETING_REPLAY_SYSTEM_WAV') and
                         os.environ.get('OPENMEETING_REPLAY_EXPECTED_SYSTEM'),
                         'optional private recording regression')
    def test_complete_system_sentence_through_real_live_pipeline(self):
        with tempfile.TemporaryDirectory(prefix='openmeeting-replay-') as directory:
            output = Path(directory) / 'events.jsonl'
            with contextlib.redirect_stdout(io.StringIO()):
                replay(os.environ.get('OPENMEETING_REPLAY_MODELS', 'models'), output,
                       os.environ.get('OPENMEETING_REPLAY_MIC_WAV'),
                       os.environ['OPENMEETING_REPLAY_SYSTEM_WAV'])
            events = [json.loads(line) for line in output.read_text(encoding='utf-8').splitlines()]
            text = ''.join(e['text'] for e in events if e.get('type') == 'record' and e.get('lane') == 'system')
            self.assertEqual(comparison_text(text), comparison_text(os.environ['OPENMEETING_REPLAY_EXPECTED_SYSTEM']))


if __name__ == '__main__':
    unittest.main()
