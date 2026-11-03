# v0.3.5 release validation — 2026-11-03

## Result

536/536 unit tests and 55/55 targeted UI regression tests passed (0 failures, 0 skips within these selected runs). The isolated installer lifecycle passed. No private meeting/recording data is included in this release.

## Commands and local evidence

```powershell
node --test --test-concurrency=1 "test/unit/**/*.test.js"
node --test --test-concurrency=1 test/qa/smart-follow.test.js test/qa/transcript-header.test.js test/qa/transcript-scroll.test.js test/qa/product-version.test.js test/qa/notes-count.test.js test/qa/language-presets.test.js test/qa/decision-source.test.js test/qa/search-highlights.test.js test/qa/live-translation.test.js test/qa/integrity.test.js
node scripts/build-windows.js
```

- Unit: `test/.tmp/release035-unit.log`, 197965 ms.
- Targeted UI: `test/.tmp/release035-ui.log`, 407804 ms.
- Public Setup build: `test/.tmp/release035-build.log`.
- Isolated lifecycle: `test/.tmp/release035-smoke/lifecycle.log`, `INSTALLER_SMOKE=ok`.
- Artifact: `dist/DuckMeeting-0.3.5-Setup-x64.exe`; checksum in `dist/SHA256SUMS.txt`.

The lifecycle uses the same payload with a test-only AppId and Start-menu group; it does not install over the user's registered formal app. It actually installs a v0.3.4 baseline, upgrades to v0.3.5, verifies Codex and Claude Code copies, starts the installed HTTP service on isolated ports, checks the dynamic version and Banner manifest, then uninstalls while retaining sentinel data. It is not a fresh-Windows-VM or public-Setup-AppId test. Public Setup itself was compiled and checksummed.

## Scope and limits

Regression covers smart follow through earlier text expansion, pending captions and delayed translation, nonmatching search notifications, explicit/manual resume, terminal-state cleanup, source navigation, desktop/mobile light/dark layout, scroll/player bounds, language defaults, note-count gating and runtime branding version.

No new live meeting, external mail sending, model download or private recording upload was performed. Existing BUG-ZIP-001 (large audio ZIP CRC corruption) is unresolved; use original WAVs. Historical skips / limitations outside these selected runs are not reclassified as passing. The unsigned installer and host-dependent Agent wake-up limitations remain.

The user's current formal installation was previously hot-patched for the UI; publishing this installer does not itself upgrade that installation's package version.
