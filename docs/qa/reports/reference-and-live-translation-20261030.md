# Reference alignment and live translation — 2026-10-30

## Results

- Full unit/QA run: **605 passed, 0 failed, 16 pre-existing BUG-004 skips**, 621 total. Log: `test-reference-full-regression.log`.
- Final exact-size visual/live replay: **3 passed, 0 failed** (`test-reference-precision.log`).
- Reference viewport: 1586×992. Measured transcript pane: x=308, y=228, width=725.8125, height=746.
- Screenshot: `docs/design/workspace-reference-aligned-20261030.png` (synthetic fixture). The visual test asserts sidebar-relative column origin, top position, width and readable text size; it does not claim that different real meeting text is pixel-identical to a generated concept.

## Live translation

The pending-caption pipeline sends throttled requests approximately every 1400ms plus polling/provider latency. Draft results are labelled 暫譯 · 持續更新; newer text supersedes pending snapshots, final text receives a new translation, disabled/other-session responses cannot overwrite the active view, and errors back off 5 seconds. The draft cache is bounded. The browser test verifies a visible translation while state=in_call and transcript.jsonl is still empty, then verifies replacement after finalization. Screenshot: `docs/design/live-translation-before-finalization-20261030.png`.

The HTTP translation service is the existing Google endpoint, not Ollama. Automated tests mock its replies; no new live Meet after this fix has yet been certified. Caption delivery, external connectivity and service response time remain dependencies. This is incremental translation, not a promise of zero latency word-for-word translation.

## Layout

Branding moved to the sidebar and the duplicate global header was removed. Title/column/body font hierarchy, horizontal language controls, expandable search, actual PCM waveform, circular play/pause, source check indicators and owner/date chips follow the reference. Follow-latest, view/scroll preferences and advanced notes actions remain functional in Settings. Help provides access to issue reporting. Desktop/mobile capture, playback, clipboard, downloads, search, rename and existing meeting flows pass regression.

```powershell
node --test --test-concurrency=1 "test/unit/**/*.test.js" "test/qa/*.test.js"
node --test --test-concurrency=1 --test-name-pattern="REFERENCE|LIVE-TRANSLATE" test/qa/workspace.test.js test/qa/live-translation.test.js
```
