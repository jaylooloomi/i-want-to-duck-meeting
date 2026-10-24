"""No audio/model needed: clustering invariants and labels."""
import unittest
import json
import os
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np
from live import Speakers, Engine, SpeechContext, label


class ContextTests(unittest.TestCase):
    def test_padding_preserves_samples_offsets_and_does_not_share_mutable_storage(self):
        history = SpeechContext(padding=0.1)
        source = np.arange(16000, dtype=np.float32)
        history.append(source)
        samples, start = history.region(4000, source[4000:8000])
        self.assertEqual(start, 2400)
        np.testing.assert_array_equal(samples, source[2400:9600])
        samples[:] = 0
        self.assertEqual(history.audio[4000], 4000)

    def test_adjacent_regions_do_not_repeat_silent_padding(self):
        history = SpeechContext(padding=0.1)
        history.append(np.arange(32000, dtype=np.float32))
        first, start = history.region(4000, np.zeros(4000))
        second, next_start = history.region(12000, np.zeros(4000))
        self.assertGreaterEqual(next_start, start + len(first))
        self.assertEqual(next_start, 10400)

    def test_history_is_bounded_and_missing_speech_fails_explicitly(self):
        history = SpeechContext(capacity=1)
        history.append(np.zeros(32000))
        self.assertEqual(len(history.audio), 16000)
        with self.assertRaises(RuntimeError):
            history.region(0, np.zeros(100))
        samples, start = history.region(16000, np.zeros(1000))
        self.assertEqual(start, 16000)
        self.assertGreaterEqual(len(samples), 1000)

    def test_forced_cut_does_not_duplicate_the_next_regions_audio(self):
        history = SpeechContext(padding=0.1)
        history.append(np.arange(8200, dtype=np.float32))
        first, begin = history.region(4000, np.zeros(4000))
        self.assertEqual(begin + len(first), 8000)
        history.append(np.arange(8200, 16000, dtype=np.float32))
        second, begin = history.region(8000, np.zeros(4000))
        self.assertEqual(begin, 8000)
        np.testing.assert_array_equal(second[:4000], np.arange(8000, 12000))


class SpeakerTests(unittest.TestCase):
    def confirm(self, speakers, vector):
        self.assertEqual(speakers.assign(vector)[0], '講者未確認')
        return speakers.assign(vector)[0]

    def test_stable_labels_and_new_voice(self):
        speakers = Speakers()
        self.assertEqual(self.confirm(speakers, [1, 0, 0]), '講者 A')
        self.assertEqual(speakers.assign([0.99, 0.1, 0])[0], '講者 A')
        self.assertEqual(self.confirm(speakers, [0, 1, 0]), '講者 B')
        self.assertEqual(speakers.assign([1, 0, 0])[0], '講者 A')

    def test_ambiguous_and_invalid_voice(self):
        speakers = Speakers()
        self.confirm(speakers, [1, 0]); self.confirm(speakers, [0, 1])
        self.assertEqual(speakers.assign([1, 1])[0], '講者未確認')
        self.assertEqual(speakers.assign([0, 0])[0], '講者未確認')
        self.assertEqual(len(speakers.centers), 2)

    def test_single_outlier_does_not_create_a_speaker(self):
        speakers = Speakers()
        self.confirm(speakers, [1, 0, 0])
        self.assertEqual(speakers.assign([0, 1, 0])[0], '講者未確認')
        self.assertEqual(speakers.assign([1, 0, 0])[0], '講者 A')
        self.assertEqual(len(speakers.centers), 1)

    def test_gray_zone_never_creates_or_adapts_identity(self):
        speakers = Speakers()
        self.confirm(speakers, [1, 0, 0])
        center = speakers.centers[0].copy()
        # Similar enough to be the same person in different conditions, but not certain.
        for _ in range(5):
            self.assertEqual(speakers.assign([0.5, np.sqrt(0.75), 0])[0], '講者未確認')
        self.assertEqual(len(speakers.centers), 1)
        np.testing.assert_array_equal(speakers.centers[0], center)

    def test_short_clips_cannot_establish_or_match_identity(self):
        speakers = Speakers()
        for _ in range(5):
            self.assertEqual(speakers.assign([1, 0], duration=0.8)[0], '講者未確認')
        self.assertEqual(len(speakers.centers), 0)
        self.confirm(speakers, [1, 0])
        self.assertEqual(speakers.assign([1, 0], duration=1.0)[0], '講者未確認')

    def test_old_or_replayed_evidence_cannot_confirm_new_identity(self):
        speakers = Speakers()
        speakers.assign([1, 0], start=0)
        self.assertEqual(speakers.assign([1, 0], start=0)[0], '講者未確認')
        self.assertEqual(len(speakers.centers), 0)
        self.assertEqual(speakers.assign([1, 0], start=20)[0], '講者未確認')
        self.assertEqual(speakers.assign([1, 0], start=22)[0], '講者 A')

    def test_invalid_embeddings_do_not_change_state_or_mutate_input(self):
        speakers = Speakers()
        for vector in ([0, 0], [float('nan'), 0], [float('inf'), 0], [], [[1, 0]]):
            self.assertEqual(speakers.assign(vector)[0], '講者未確認')
        original = np.array([3.0, 4.0], dtype=np.float32)
        speakers.assign(original)
        np.testing.assert_array_equal(original, [3, 4])
        self.assertEqual(len(speakers.centers), 0)

    def test_candidates_are_bounded(self):
        speakers = Speakers()
        for vector in np.eye(20):
            self.assertEqual(speakers.assign(vector)[0], '講者未確認')
        self.assertLessEqual(len(speakers.candidates), 8)
        self.assertEqual(len(speakers.centers), 0)

    def test_session_reset_and_extended_labels(self):
        self.assertEqual(self.confirm(Speakers(), [0, 1]), '講者 A')
        self.assertEqual(label(25), '講者 Z')
        self.assertEqual(label(26), '講者 AA')

    def test_teams_remote_speaker_never_uses_reserved_local_a(self):
        speakers = Speakers(label_offset=1)
        self.assertEqual(self.confirm(speakers, [1, 0]), '講者 B')
        self.assertEqual(self.confirm(speakers, [0, 1]), '講者 C')
        self.assertEqual(speakers.assign([1, 0])[0], '講者 B')

    @unittest.skipUnless(os.environ.get('OPENMEETING_SPEAKER_TEST_EMBEDDINGS'), 'optional public four-speaker fixture')
    def test_four_speaker_sample_reduces_splits_without_collapsing_all_speakers(self):
        with open(os.environ['OPENMEETING_SPEAKER_TEST_EMBEDDINGS'], encoding='utf-8') as file:
            observations = json.load(file)
        speakers = Speakers()
        assigned = [speakers.assign(o['vector'], duration=o['duration'], start=o['start'])[0] for o in observations]
        self.assertEqual(len(set(o['baseline'] for o in observations)), 5)
        self.assertEqual(len(speakers.centers), 4)
        self.assertEqual(set(assigned), {'講者 A', '講者 B', '講者 C', '講者 D', '講者未確認'})
        self.assertEqual(assigned[0], '講者未確認')
        self.assertEqual(assigned[-1], '講者 A')
        # The narrator's final short window previously created a fifth identity.
        self.assertTrue(all(name == '講者 A' for o, name in zip(observations, assigned) if o['baseline'] == '講者 D'))


class RecognitionTests(unittest.TestCase):
    def engine(self, words):
        engine = Engine.__new__(Engine)
        engine.converter = SimpleNamespace(convert=lambda text: text)
        engine.turns = lambda audio, offset: [[0, 32000, '講者未確認', 0.0], [32000, 64000, '講者 A', 0.8]]
        calls = []
        segment = SimpleNamespace(start=0.2, end=3.8, text='這是測試第二句子', no_speech_prob=0.1, words=words)

        def transcribe(audio, **options):
            calls.append((len(audio), options))
            return iter([segment]), None
        engine.asr = SimpleNamespace(transcribe=transcribe)
        return engine, calls

    def test_uncertain_speaker_boundary_does_not_cut_or_drop_asr_words(self):
        words = [SimpleNamespace(start=a, end=b, word=text) for a, b, text in
                 [(0.2, 0.9, '這是'), (1.2, 1.7, '測試'), (2.2, 2.7, '第二'), (3.2, 3.8, '句子')]]
        engine, calls = self.engine(words)
        events = []
        with patch('live.send', side_effect=lambda **event: events.append(event)):
            engine.recognize(np.zeros(64000, dtype=np.float32), 16000)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], 64000, 'full 4-second audio sent to ASR, not speaker fragments')
        records = [e for e in events if e['type'] == 'record']
        self.assertEqual(''.join(r['text'] for r in records), '這是測試第二句子')
        self.assertEqual([r['speaker'] for r in records], ['講者未確認', '講者 A'])
        self.assertAlmostEqual(records[0]['start'], 1.2)
        self.assertEqual(events[-1]['type'], 'clear')

    def test_missing_word_alignment_never_guesses_a_mixed_sentence_speaker(self):
        engine, _ = self.engine(None)
        events = []
        with patch('live.send', side_effect=lambda **event: events.append(event)):
            engine.recognize(np.zeros(64000, dtype=np.float32), 0)
        records = [e for e in events if e['type'] == 'record']
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]['speaker'], '講者未確認')
        self.assertEqual(records[0]['text'], '這是測試第二句子')

    def test_teams_microphone_identity_does_not_depend_on_remote_embeddings(self):
        engine, _ = self.engine(None)
        engine.mode = 'teams'
        engine.turns = lambda *args: self.fail('Teams microphone must not enter remote voice clustering')
        events = []
        with patch('live.send', side_effect=lambda **event: events.append(event)):
            engine.recognize(np.zeros(64000, dtype=np.float32), 0, 'mic')
        records = [e for e in events if e['type'] == 'record']
        self.assertEqual(records[0]['speaker'], '講者 A')
        self.assertEqual(records[0]['lane'], 'mic')


if __name__ == '__main__':
    unittest.main()
