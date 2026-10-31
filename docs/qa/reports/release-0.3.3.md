# Duck Meeting 0.3.3 QA

## Scope

Long transcripts scroll independently in a bounded card, preserving their controls and player. Notes content retains a fixed tab header and explicit vertical scrollbar rail in both themes. The CSS URL has a cache version to request the updated rules after reload. No backend, dependencies or model changes.

## Reproduction

From the committed checkout, in PowerShell with Node and Chrome available:

```powershell
$files = @(git ls-files 'test/unit/*.test.js' 'test/qa/*.test.js')
node --test --test-concurrency=2 @files
```

Build: set `ISCC_PATH` to the Inno Setup compiler, then run `npm run build:windows`. Output is `dist/DuckMeeting-0.3.3-Setup-x64.exe` and `dist/SHA256SUMS.txt`.

The new `transcript-scroll.test.js` was explicitly included before staging. Untracked older synthetic/ZIP diagnostic scripts remain locally and are excluded from this release suite/commit. The browser harness fails on console/page errors. Tests use semantic locators, actual mouse-wheel events, event-based waits and geometry checks, with no fixed sleeps.

## New behavior evidence

- Four transcript cases: 60 paragraphs; actual wheel scroll changes scrollTop; last paragraph lies inside its viewport. 1920/390 widths, light/dark themes.
- Two notes cases: 60 summary paragraphs; visible scrollbar color/overflow; actual wheel scroll; bottom paragraph reachable; tab stays visible. Light/dark themes.
- Pre-release focused checks: 9/9 scroll/integrity cases and 11/11 workspace/integrity cases passed. They are historical focused runs; the full release regression is recorded below.

## Installer method and limitations

Use an isolated test-only AppId and Start-menu group, with the same production runtime payload. The user's registered app is not redirected or upgraded. The baseline is the 0.3.2 test installer, then the new 0.3.3 test installer. Config/data/Agent roots are isolated. Verify bundled Node, Codex and Claude configuration, HTTP workspace, fresh upgraded CSS/HTML, downgrade refusal, uninstall and data preservation.

The installer is unsigned. No fresh Windows VM, publisher-signature acceptance, or live meeting/ASR quality acceptance is claimed. Existing BUG-004 skips remain unaccepted. BUG-ZIP-001 (audio corruption in full-session ZIP exports) remains; preserve original WAVs separately.

Installer lifecycle result: **passed** (`test/.tmp/release033-smoke/lifecycle.log`, `INSTALLER_SMOKE=ok`). Both Agent installation tasks were enabled. The production payload index.html/emerald.css match the tested source byte-for-byte.

Initial full run: 722 tests, 705 passed, 1 failed, 16 existing skips. The mobile mail test asserted immediate screen bounds for a disabled Save button in an empty draft. It now fills required subject/body first and uses a non-mutating Playwright trial click to check enabled/stable/reachable action before the unchanged viewport bounds assertion. The focused mobile case passed. Exploratory outer-container CSS changes were reverted; release runtime remains the same tested/built payload. A final complete run follows.

## Final regression result

**722 tests: 706 passed, 0 failed, 16 existing skips**, 303466.483 ms (`test/.tmp/release033-regression-final.log`). No cancelled or TODO tests. The failed initial run is not counted as passing evidence.
