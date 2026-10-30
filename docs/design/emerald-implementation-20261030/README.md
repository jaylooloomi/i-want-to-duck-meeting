# Emerald workspace implementation

The selected [reference](target-emerald.jpg) is implemented as real HTML/CSS/SVG. [Actual 1280×800 capture](iteration-02/actual.png) uses isolated synthetic fixtures and real local HTTP/media/Markdown controls; no reference pixels are embedded into the app. Browser console evidence is `iteration-02/console.json` (empty).

## Scope

Three truthful evidence cards; compact metadata and visible recording activity; real grouped/searchable history with platform markers; always-visible bilingual transcript search; speech stars and paragraph menu; PCM waveform/range playback/rate/volume/tracks/expanded player; notes cards and tabs; persistent completion checkboxes; source review and TXT download; actual file usage and disk availability. Settings, help, rename, archive, export, local recording, live translation and thread-owned Agent summary handoff remain intact. No Ollama.

The production UI never fabricates example people, attendance totals, accuracy, MP3 files or quota. It displays known speaker initials, real formats and real storage measurements. The test scene's people, text, sound and durations are synthetic; it does not prove live ASR/provider accuracy.

## Replay

```powershell
node test/qa/capture-emerald.mjs test/.tmp/emerald-replay
node --test --test-concurrency=1 test/unit/workspace-actions.test.js test/qa/emerald.test.js test/qa/workspace.test.js
node --test --test-concurrency=1 "test/unit/**/*.test.js" "test/qa/*.test.js"
```

Use [the current verification report](../../qa/reports/emerald-20261030.md) for final counts and limits. The previous reference's numeric 90.16% result is archived separately; it is not claimed for this new image.
