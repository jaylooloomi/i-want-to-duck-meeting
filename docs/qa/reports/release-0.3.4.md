# Duck Meeting 0.3.4 QA

## Scope

Direct decision/action source navigation; full-width temporary source highlight; prevent outer-workspace scroll/header clipping; independent checkbox completion; explicit original-quote/time instructions for both Agent integrations. README and matrix updated, no dependencies/models added.

## Behavior and evidence

`decision-source.test.js` covers decision/action at 1920 and 390 viewports, direct click and Enter, clearing search filters, exact source record, actual transcript scroll offset, highlighted row bounds spanning the content width without horizontal overflow, and workspace shell scrollTop staying zero. Unlinked action text does not toggle completion; checkbox operations remain independent. Existing source-review controls are retained.

`summary-items.test.js` and `summary-source-api.test.js` already verify declared source columns, unknown time, exact-source validation and export prompt requirements. Both Agent instructions now explicitly require complete verbatim source text and original ISO t0, do not invent links, and do not rewrite historical meetings without authorization. This validates instructions and parser contracts; it does not claim a fresh live Agent/meeting acceptance or guarantee an Agent will produce correct evidence every time.

Browser tests use the shared console/pageerror guard, semantic locators and event-based readiness. Original source UI integration and earlier focused tests remain preserved; the final complete release result is recorded below.

## Reproduce

PowerShell, from a clean committed checkout with Node and Chrome available:

```powershell
$files = @(git ls-files 'test/unit/*.test.js' 'test/qa/*.test.js')
node --test --test-concurrency=2 @files
node --test test/integration/notes-composition.test.js
```

The new QA file was explicitly included before staging. Unrelated untracked synthetic/ZIP diagnostic files are retained locally and excluded from this release and commit. Full logs: `test/.tmp/release034-*.log`.

## Installer validation method

Production Setup is built with bundled Node 24.13.0. An isolated test-only AppId/Start-menu group uses the identical runtime payload for actual 0.3.3 → 0.3.4 install/upgrade/uninstall. Data, Codex and Claude config roots are isolated. Verify both upgraded Agent versions/source instructions, bundled CLI, HTTP assets, downgrade refusal and data preservation. No production-user app update is part of this release test.

Build command: set `ISCC_PATH` to the Inno compiler, then run `npm run build:windows`. Artifacts: `dist/DuckMeeting-0.3.4-Setup-x64.exe` and `dist/SHA256SUMS.txt`.

## Known limits

Installer remains unsigned; checksums are not publisher signatures. No fresh Windows VM or live meeting/ASR acceptance. Existing BUG-004 skipped paths remain unaccepted. BUG-ZIP-001 remains: preserve original WAVs directly, not only full-session ZIPs. Sources without a unique exact match remain unlinked; no historical backfill is automatic.

## Additional verification

The existing end-to-end source-review/replay/mail integration passed (1 test, 36703.1237 ms). The isolated installer lifecycle passed; both upgraded Codex and Claude skill files contain the original-source requirements and the Claude plugin version matches 0.3.4. Runtime/skill payload hashes match the tested source.

During the complete run, the existing `HL-UI ... 390` case hit its 20000 ms case limit. Other browser cases on this machine also ran substantially slower than earlier release runs. This is retained as an initial non-passing result; a targeted rerun is required before sign-off, rather than treating it as a product pass or skipping the case.

## Full run and test synchronization correction

The full run completed with **726 tests: 708 passed, 1 failed, 1 cancelled, 16 existing skips** (966889.4851 ms). The cancelled HL-UI mobile case hit its 20-second cap; an unchanged sequential rerun passed. The audio-capture failure reproduced: its 800ms fixture timer could create the audio before installation completed, invalidating the initial zero-track expectation on a slower run.

Only test infrastructure was corrected: the tone fixture adds an opt-in manual release gate; other fixture modes are unchanged. The case asserts zero tracks before release and waits on actual Node-side PCM/status callback observations afterwards, retaining sample-rate, sample-length, amplitude and track-status assertions. An intermediate browser polling attempt was not accepted; the final callback-gated single case passed (12863.5186 ms). No production audio code or case time budget was changed. The whole affected files are rerun below.

A subsequent affected-file rerun exposed another fixed-delay assumption in the first tone case: after 3300ms it had 1.92s rather than the required 2s of samples. This case now waits on actual capture callback observations (at least two chunks and two seconds of samples with a captured track), retaining its amplitude/frequency/WAV assertions. Its focused case passed. These are test/fixture-only changes and do not alter the packaged runtime; a final complete audio-file rerun follows.

## Final disposition

The final audio-file + integrity run passed **14/14**, with 0 failed/cancelled/skipped (49064.2073 ms; `release034-audio-final.log`). Both sequential highlight-file runs passed all five highlight cases without changing their timeout/assertions. Together with the unchanged cases from the complete suite, the final disposition is **710 verified passing cases and 16 existing skips** across 726 unique cases; no unresolved test failures. This is combined full-suite plus targeted-rerun evidence, not a claim of a fresh single all-green 726-case run after the test-only synchronization fixes. Installer lifecycle and the separate original source/mail integration also passed.
