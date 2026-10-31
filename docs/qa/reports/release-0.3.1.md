# Duck Meeting 0.3.1

## Final scope

- Remove retired-backend wording from runtime/UI/current docs/Agent templates; preserve owning-Agent notes and mail workflow.
- Align the language picker by removing inherited margin/max-width and explicitly aligning selected text.
- Include completed decision/action evidence links, exact original text/time/speaker validation, locate/replay and stale-source handling.
- Include mail selection/preview/apply/undo while preserving manual text.

Tests and package were prepared in D:/git/openmeeting/test/.tmp/release031, separate from primary-checkout development. Runtime files were reconciled with the primary tree; no private meetings were staged. Browser integration uses semantic locators, event waits and the shared console/pageerror guard.

## Installer validation

Setup lifecycle used a test-only AppId and Start-menu group with the identical runtime payload, so the user's registered 0.3.0 installation remained untouched. Baseline metadata 0.3.0 → 0.3.1 upgrade, both isolated Agent configs, bundled CLI, data retention and a freshly started upgraded server exposing noteItems all passed. This is not a fresh Windows VM or every historical-binary migration test. No additional dependencies/models were downloaded.

## Preview and known limitations

Synthetic source-link preview: http://127.0.0.1:8793/?id=20261031-linked-source-demo . Its audio is silent test data, not live recognition evidence. The existing installed service on 8792 was not restarted: automatic review returned blocked by policy for direct synchronization/restart. New Setup contains the integration.

BUG-ZIP-001: independently reproduced CRC corruption of >256KiB audio in full-session ZIP exports. This pre-existing export bug is outside the requested fix scope and is disclosed in README/release notes; use original WAV files directly. Installer is unsigned.

## Release 0.3.1 final integrated validation — 2026-10-31

Final isolated release regression: **710 tests, 694 passed, 0 failed, 16 pre-existing BUG-004 skips**, 299.6 seconds (`node --test --test-concurrency=2 "test/unit/**/*.test.js" "test/qa/*.test.js"`, `test-release-031-verified.log`). Source/legacy UI/localization/integrity replay: **27 passed**, zero failed/skipped (108.4 s); explicit action-to-5-second replay and transcript-location integration: **1 passed** (7.5 s). No new skips or console-error exclusions. Earlier integrated runs exposed text-node compatibility regressions; source controls now wrap text only when a source item exists, preserving ordinary paragraph structure.

Includes the retired-backend reference cleanup, footer language-picker alignment, and the subsequently requested completed source-evidence/mail-composition integration. Installer lifecycle smoke with test-only registry identity/Start-menu group passed install, upgrade, bundled-runtime CLI/HTTP, fresh upgraded source API, downgrade refusal, uninstall and data retention. Actual 8792 installation was not restarted or replaced; an automatic review rejected that direct-sync/restart action. The frozen code runs separately on 8793 with synthetic data.

A separate CRC diagnostic confirmed existing BUG-ZIP-001 for large audio ZIP export; it is not fixed by this release. Preserve original WAV files directly. Passing regression counts do not establish ZIP CRC correctness, live-meeting/ASR acceptance or fresh-VM/SmartScreen behavior. Installer remains unsigned.
