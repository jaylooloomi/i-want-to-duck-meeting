> Historical audit: the app now follows the separately selected Emerald design. Saved PNGs and scores remain valid for the previous layout. Re-running its old capture against the current source is not a current acceptance gate; use `test/qa/capture-emerald.mjs` for the new UI.

# Reference comparison audit — 2026-10-30

Reference: [supplied design](../workspace-reference-target-20261030.png). Actual screenshots are unmodified headless Chrome output from the real local viewer and isolated HTTP fixture. Production UI never embeds the reference, its sample people, or sample notes.

## Fixed acceptance protocol

[protocol.json](protocol.json) was frozen before the first capture. Its reference SHA, viewport, ten regions, regional weights and thresholds were not changed to reach the threshold.

- Composite: 70% regional grayscale SSIM + 20% component rectangle IoU + 10% mean RGB agreement.
- SSIM uses 1×, 2×, 4× box scales weighted 20/30/50%. Every pixel of each declared region is included, with no text/controls masked out.
- Acceptance: composite ≥90; each regional structure score ≥80; zero browser console/page errors.
- This is a project-specific reproducible UI metric, not a universal measure of human-perceived similarity or a claim of identical pixels.

Iterations 21 and 22: **90.1619245994** in both independent captures, with identical PNG SHA-256 `33e483717e96609b77d3e50491a5621f6bc468d62b840cd7803e0b35a4bf9390`, all ten regions ≥80, empty console evidence. Numerical component scores: structure 86.5667721, geometry 99.4304390, color 96.7909630.

## Canonical scene and evidence limits

The fixture has 24 utterances, 3 recorded speakers, four synthetic meetings, the reference Markdown structure and two advisory comparison differences. A generated PCM WAV has a real duration of 42:18; playback is paused at 12:08, volume 75%. Text translations are supplied by a deterministic boundary stub. Controls, local HTTP API, range streaming, Markdown renderer, media engine and UI state are real.

This scene proves rendering/interaction, not Google Meet admission, speaker identity, live ASR accuracy, Google translation availability or live Agent wake-up latency. The production count says recorded speakers, not an invented total participant count. Single-track selection is hidden; multiple real tracks remain selectable. No private recording or active meeting was used.

The same reference content is retained throughout. State corrections are explicit: iteration 09 temporarily changed synthetic WAV amplitudes and is a diagnostic variant; iteration 10 reverted to the original PCM envelope. Iteration 15 set the reference volume to 75%; iteration 16 removed focus from that slider after adjustment. Iteration 16 failed the strict console guard because a data-URI arrow violated CSP; its numeric score is diagnostic only. Iteration 17 moved the arrow to a local SVG without relaxing CSP. No screenshot pixels were edited.

## Reproduce

From the repository root with Node, installed playwright-core/Chrome, and the local Python speech environment containing NumPy:

```powershell
node test/qa/capture-reference.mjs test/.tmp/visual-replay
.venv-stt/Scripts/python.exe test/qa/visual-score.py test/.tmp/visual-replay
.venv-stt/Scripts/python.exe test/qa/visual_score_test.py
node --test --test-concurrency=1 "test/unit/**/*.test.js" "test/qa/*.test.js"
```

The scorer verifies the reference SHA. It falls back to the committed reference when the original clipboard file is absent. PNG decoding, alpha composition, all five PNG filters, SSIM identity/difference, downsampling, IoU and blank-page rejection have executable tests; a console-error probe also verifies that the CLI fails even for an identical image. Console evidence is required for acceptance. Fonts are local licensed assets; see [asset provenance](asset-provenance.json). CJK uses the installed Windows Noto Sans TC fallback; platform/font/browser differences may alter the metric outside this environment.

## Functional checklist

The actual browser suites cover: grouped/searchable history; new recording and lifecycle guards; archive/rename/export; bilingual presets and pending translation; transcript search; live and utterance highlights; saved audio play/pause/seek/rate/volume/multiple tracks; notes overview/decisions/actions and ordered lists; copy/download; source mismatch review and audio seeking; settings/help, persistence, empty states, hostile text, and visible permission/provider failures.

Full regression counts and retained acceptance limits are recorded in [the current report](../../qa/reports/visual-reference-20261030.md). Historical BUG-004 cases stay explicitly skipped; they are not counted as passes.

## Retained iteration history

| Iteration | Composite | Console clean | Notes |
| --- | ---: | --- | --- |
| iteration-01 | 70.5362 | yes |  |
| iteration-02 | 75.5584 | yes |  |
| iteration-03 | 77.6520 | yes |  |
| iteration-04 | 80.2713 | yes |  |
| iteration-05 | 80.7558 | yes |  |
| iteration-06 | 77.4908 | yes |  |
| iteration-07 | 83.7337 | yes |  |
| iteration-08 | 84.6856 | yes |  |
| iteration-09 | 87.5142 | yes | Diagnostic PCM-amplitude variant; original restored in 10 |
| iteration-10 | 87.6377 | yes |  |
| iteration-11 | 87.9164 | yes |  |
| iteration-12 | 86.9425 | yes |  |
| iteration-13 | 87.6434 | yes |  |
| iteration-14 | 87.9423 | yes |  |
| iteration-15 | 88.3724 | yes | Canonical volume/focus corrected; see method |
| iteration-16 | 88.7037 | no | Rejected: CSP console error |
| iteration-17 | 89.1116 | yes | Canonical volume/focus corrected; see method |
| iteration-18 | 89.5232 | yes |  |
| iteration-19 | 89.4003 | yes |  |
| iteration-20 | 89.6271 | yes |  |
| iteration-21 | 90.1619 | yes |  |
| iteration-22 | 90.1619 | yes |  |

The accepted iterations use the same frozen production source. Browser/font metadata is saved in `iteration-22/environment.json`. Console failures cannot pass the gate, even if their numeric image score were high.
