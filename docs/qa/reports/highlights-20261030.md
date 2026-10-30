# Important speech markers — 2026-10-30

## Behavior

- During recording, ★ 標記此刻重點 saves wall time, approximate recording offset, and a recent server-side caption snapshot when available. Missing/stale captions produce time-only markers.
- Each transcript row supports a whole-utterance star. The highlight list and only-highlights filter work across refresh and finalization; provisional speaker revisions use a unique timestamp fallback without rewriting the original snapshot.
- After finalization, the list seeks the mixed recording to the marker offset. Pending snapshot labels remain explicit. Cancelling a marker removes it from the effective list, while append-only local history remains.
- `highlights.jsonl` stores mark/unmark events; `highlights.md` is the effective Agent-readable view. Custom-AI export includes effective markers; full ZIP includes local artifacts. Original transcripts/audio are untouched by marker operations.
- Installed Codex and Claude Code instructions require reviewing marked context without inventing decisions, responsible people or deadlines. No automatic rewrite of existing summaries is triggered by later annotations.

## Executed tests

- Full unit/QA suite: **610 passed, 0 failed, 16 existing BUG-004 skips**, 626 cases (`test-highlights-full-regression.log`).
- Final targeted desktop/mobile replay including actual PCM seek: **8 passed, 0 failed** (`test-highlights-final.log`).
- Security and integrity: exact session IDs, same-origin writes, idempotent whole-utterance marks and server-owned quote selection; forged client text is ignored.
- Recording positions are estimates, not word-accurate alignment. Synthetic/silent PCM is used only to verify playback mechanics, not speech quality. No real meeting or private recording was used.
- Local viewer restarted only after confirming no active recording. Codex skill hash matches the repository and Claude's installed skill contains the new highlight instructions.

```powershell
node --test --test-concurrency=1 "test/unit/**/*.test.js" "test/qa/*.test.js"
node --test --test-concurrency=1 test/unit/highlights.test.js test/qa/highlights.test.js test/qa/integrity.test.js
```
