# Duck Meeting 0.3.2 QA

## Scope

Recording timeline highlight pins, bounded scrolling meeting notes/mail, and literal transcript search highlighting. No speech model, backend, or dependency changes.

## Test execution

The release suite enumerates tracked `test/unit/*.test.js` and `test/qa/*.test.js` using Git plus the new `test/qa/search-highlights.test.js`. Existing untracked synthetic/ZIP diagnostic scripts are retained locally and excluded from this release suite and commit. Logs are kept under `test/.tmp/release032-*.log`.

New browser cases use semantic locators, event-based readiness and the shared guard for console/page errors. Timeline tests use a synthetic silent 20-second WAV with a highlight at 8 seconds; this does not establish real speech quality. Search tests cover repeated Chinese/speaker matches, English case, literal `[a+b]`/`<script>` and clearing, in both themes. Mail tests expand 20 decision choices and reach the bottom controls at 1280 and 390 widths. Prior mail edit/save/copy/download/conflict/locale tests remain enabled; the previous no-inner-scroll expectation is updated to the user's requested scrollable panel contract.

## Installer

An isolated test-only Inno AppId and Start-menu group use the same runtime payload. The registered user app is not redirected to the test folder. Version 0.3.1 baseline → 0.3.2, bundled runtime without global Node, isolated Codex and Claude setup, HTTP workspace, upgrade, downgrade refusal, uninstall and data retention passed. A freshly started upgraded server was checked for timeline DOM plus the new JS/CSS. The first test draft checked new DOM before the upgrade; this test-order mistake was corrected and the complete lifecycle rerun passed.

This is an actual Windows per-user installer lifecycle test, not a fresh VM or SmartScreen/signature acceptance. Production installer remains unsigned. Meeting data, browser profiles, models and credentials are excluded from the payload.

## Known limits

- BUG-ZIP-001: existing full-session ZIP audio corruption remains; preserve original WAVs separately.
- 16 existing BUG-004 skips remain; zero failures does not imply those paths are accepted.
- Source-less or out-of-duration highlights do not produce recording pins. Overlapping timestamps can share a location.
- No fresh live meeting, external translation service, or speech recognition acceptance is claimed by these synthetic tests.

The initial Git glob `test/unit/**/*.test.js` did not match root-level unit files; the 180-case QA run is reported separately. Unit tests were then run explicitly, followed by a combined run using the corrected complete list.

## Verified results

First coverage pass: QA/browser/API 180 tests (164 passed, 16 existing skips, 0 failed; 268232.5009 ms) plus unit 536 tests (536 passed, 0 skipped/failed; 53508.2891 ms). Combined: 716 tests, 700 passed, 16 skipped, 0 failed.

Final installer runtime feature files match the tested source byte-for-byte (app.js, workspace.js, index.html, emerald.css). The isolated installer lifecycle used the same runtime; the final rebuild additionally includes the completed README text.

Reproduce from the committed release checkout (PowerShell; Node and Chrome installed):

```powershell
$files = @(git ls-files 'test/unit/*.test.js' 'test/qa/*.test.js')
node --test --test-concurrency=2 @files
```

Installer build: set `ISCC_PATH` to the Inno Setup compiler, then `npm run build:windows`. Output: `dist/DuckMeeting-0.3.2-Setup-x64.exe` and `dist/SHA256SUMS.txt`.

Second combined run: **716 tests, 700 passed, 16 existing skips, 0 failed**, 394790.482 ms. No runtime changes occurred between the two coverage passes.
