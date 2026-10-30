# Duck Meeting workspace implementation contract

Reference: meeting-workspace-concept-20261030.png. All content must reflect local session data, never the concept's example names/counts.

- [x] Workspace navigation: readable grouped history, meeting search, explicit follow-latest, archived filter, new recording, rename, export, settings/help.
- [x] Selected meeting title/time/platform, known speaker count, duration, truthful recording/transcript/summary states.
- [x] Transcript text search, bilingual display presets, additional translation languages including Japanese/German, original text retained, error/loading translation feedback.
- [x] Local audio playback, seek, playback speed, volume, actual PCM waveform, track selection, timestamp seek; no recording/existing files remains a clear empty state.
- [x] Agent notes overview/decisions/actions tabs, copy Markdown, download Markdown, full ZIP export, existing custom-AI export and queue controls.
- [x] Read-only comparison of native text and existing recording transcription, estimated temporal alignment, exact original differences and digit mismatches. No automatic model calls, no invented transcript, no automatic correction of originals.
- [x] Desktop/mobile UI, keyboard accessible controls, no unexpected horizontal overflow, clipboard/permission/network failures recover visibly.
- [x] Meaningful API/unit/browser tests, strict console/pageerror guard, full regression and screenshots. No real meeting joins until controlled verification completes.

Audio streaming only allows known WAV filenames beneath the selected meeting directory; Range requests support seeking. Existing session lifecycle and no-Ollama policy remain in effect. Private recordings stay outside Git.


## Verification outcome

2026-10-30: Full unit/QA regression: 617 cases, 601 passed, zero failures, 16 pre-existing BUG-004 skips. Final targeted replay after mixed-track seek and native Agent notes parsing refinements: 11/11 passed. Desktop/mobile screenshots use synthetic fixtures and are saved beside this document. No real meeting was joined for this implementation.

One control was moved out of the transcript pane so summary-only view cannot trap the user without a way back. More-menu placement, retry button timing, decimal-number comparisons, and archive/delete guards were corrected during implementation. The UI remains conditional on available evidence: no transcript, no saved audio, no notes, or no independent recording transcription each produces a clear empty/waiting state.


## Formal visual acceptance follow-up

The supplied 1586×992 reference is now tracked under `visual-audit/` with a frozen protocol, unmodified real-app screenshots, per-region scores, source/asset hashes, console evidence and executable decoder/metric tests. Iteration 21 reached **90.1619245994**, all regions ≥80, no console/page errors. This is controlled synthetic UI evidence, not a new live-speech claim. See `visual-audit/README.md` and `../qa/reports/visual-reference-20261030.md` for reproduction, canonical fixture corrections, functional coverage and acceptance limits.
