# German, Japanese and Korean original-text views — 2026-10-31

Added de/ja/ko display choices with existing four-language UI labels, independent of translation targets and platform spoken-language configuration. Explicit per-record language/lang tags (including regional forms) filter correctly. Untagged/und/unknown legacy records remain visible instead of silently disappearing. An accessible localized notice explains this limitation; no Latin-script language guessing is introduced.

Validation: `node --test --test-concurrency=1 test/qa/language-presets.test.js test/qa/integrity.test.js` — 9 passed, 0 failed, 0 skipped. Three new browser cases verify tagged language separation, retained Latin/Han unknown originals, notice visibility, query/reload restoration and strict console guards. Existing default and bilingual preset behavior was replayed.

Official product research confirms German/Japanese/Korean caption support in Google Meet and Teams meetings. This is documentation evidence, not a new live meeting/ASR validation. Teams personal/free and account-dependent options must be checked separately.

Sources:
- https://support.google.com/meet/answer/15077804?hl=en
- https://support.microsoft.com/en-us/teams/meetings/use-live-captions-in-microsoft-teams-meetings
