# Windows installer 0.3.0

## Artifact and runtime

DuckMeeting-0.3.0-Setup-x64.exe is a per-user Inno Setup installer for Windows 10/11 x64. It bundles Node.js 24.13.0 (official archive checked against Node's SHA256 manifest), the locked Playwright-core package, application sources and upstream licenses. No repository clone, npm or global Node installation is needed to use it. The compiler download was Authenticode-verified as Pyrsys B.V.; the resulting application installer itself is unsigned. No signing certificate was available.

Only allowlisted runtime trees are staged. Recordings, meeting notes/mail drafts, browser profiles, tokens, models, virtual environments and the local developer setup are not packaged. Runtime data is separated into LOCALAPPDATA/DuckMeeting/data; program files live in LOCALAPPDATA/Programs/DuckMeeting. Source-checkout data is preserved in place, not automatically migrated. The installed edition uses port 8792 and renders skill links accordingly.

## Lifecycle

Setup tasks select Codex, Claude or both. Codex points to the bundled absolute Node path; Claude commands also use it. Claude itself must already be installed. Models/Python are prepared online by the existing first-use setup or Start-menu speech-recognition action; they are not bundled. Source files are never replaced by a model download.

The update shortcut checks stable GitHub releases, obtains consent, validates asset host/name and SHA256 before opening Setup. Private-repo/API failures direct the user to browser login/manual download; no token is embedded. Unit tests cover version ordering, missing/hostile assets and checksum tampering. A live future-version download/prompt was not exercised before publication.

Upgrade/repair preserves data and skill state. Active recording PIDs block upgrade/uninstall; downgrade is refused. The standalone desktop service is closed only when its PID, executable and command line match this installation. Uninstall removes only still-owned integrations. User-added skill files and another checkout's integration are preserved. Interactive uninstall defaults to keeping data, with an optional second-confirmed delete; silent uninstall always keeps data. The destructive deletion choice was reviewed, not executed against user data.

## Executed verification

- `node --test test/unit/windows-installer.test.js test/qa/integrity.test.js`: 6 passed, zero failed/skipped.
- `node scripts/test-windows-installer.js`: real silent Setup, isolated Codex skill, bundled CLI, HTTP workspace, repair/reinstall, uninstaller and data preservation passed with no Node directory on the child PATH.
- The same smoke test with DUCK_TEST_CLAUDE=1 used an isolated CLAUDE_CONFIG_DIR, installed/enabled the real Claude plugin, and uninstalled it. Isolated marketplace and installed-plugin registries were empty afterward. The developer's own Agent configs were not used for these tests.
- Test-only baseline 0.2.99 installer supports a real installer-version upgrade to 0.3.0 while preserving a sentinel and meeting record. This baseline is synthetic packaging evidence, not a previously published release.

The test host is the existing Windows computer with isolated app/data/config paths, not a pristine Windows VM. No real meeting was joined and no real microphone/remote ASR was accepted by installer smoke tests. Chrome and Agents remain separate prerequisites. SmartScreen reputation, Windows ARM64, fresh-VM first model download and interactive data deletion are not established by these tests. Existing BUG-004 console-error skips remain documented separately.

## Rebuild

Set ISCC_PATH to the verified official Inno Setup compiler, run npm ci then npm run build:windows. Outputs are under ignored dist/. The workflow_dispatch Windows installer workflow repeats build, unit and actual installer smoke validation and uploads artifacts; it does not silently publish a release. SHA256SUMS.txt accompanies the EXE.


## Release 0.3.0 final validation — 2026-10-31

Final unit + QA regression: **704 tests, 688 passed, 0 failed, 16 pre-existing BUG-004 skips**, 546.4 seconds (`test-release-030-final.log`). Focused installer/integrity/Korean replay: **8 passed, zero failed/skipped** (`test-release-030-focused.log`). The initial development runs exposed a duplicate Korean archived-label dictionary entry and an integrity snapshot taken during edits; both were corrected before the final full run. No new skips or console-error exclusions were introduced.

Actual installer evidence: `test-windows-release-smoke.log` passed bundled runtime without a global Node path, isolated Codex/Claude integration, HTTP workspace, synthetic previous-version upgrade, downgrade refusal, uninstall and data preservation. The final EXE was the one exercised. Payload audit: 217 files, no meeting/profile/model/token/runtime-marker directories. SHA256SUMS.txt accompanies the release asset. Local host isolation does not substitute for a fresh Windows VM; unsigned-installer/SmartScreen and first-model-download limits are documented in [Windows installer QA](docs/qa/reports/windows-installer-030.md).
