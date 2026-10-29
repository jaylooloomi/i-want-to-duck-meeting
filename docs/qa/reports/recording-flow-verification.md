# Recording UI verification — 2026-10-30

The duplicate meeting dropdown was removed. Sidebar selection and the explicit follow-latest checkbox now own navigation. New recording setup only appears after the new-record action (or the existing Teams setup query), with device configuration collapsed by default. The selected session owns its stop action; history instead offers return-to-active navigation.

## Results

- Unit suite: **516 passed, 0 failures, 0 skips** (`test-ui-unit-final.log`).
- Browser / HTTP / integrity / microphone UI regression: **41 passed, 0 failures, 16 pre-existing BUG-004 skips** out of 57 cases (`test-flow-complete.log`). Skips are not acceptance passes.
- New recording journeys were repeated after UI refinements; desktop 1920×1080 and mobile 390×844 use real headless Chrome and AudioWorklet PCM sent to an isolated HTTP service.
- Exact-session stop contract, same-origin rejection, terminal/finalizing rejection, duplicate capture prevention, follow-latest, history switching and retry feedback are covered.
- New browser tests use semantic locators, event-based waits and strict console/pageerror guards. Failure evidence and screenshots are under `test/.tmp/qa/manual`.
- README.md / README.zh-TW.md and docs/qa/RECORDING_FLOW.md describe the revised workflow. The standalone local viewer was restarted with the updated server.

## Reproduce

```powershell
$env:PATH = "C:/Windows/System32;C:/Users/User/AppData/Local/Volta/tools/image/node/24.13.0;" + $env:PATH
node --test --test-concurrency=1 "test/unit/**/*.test.js"
node --test --test-concurrency=1 test/qa/record-api.test.js test/qa/record-flow.test.js test/qa/sidebar.test.js test/qa/agent-summary.test.js test/qa/frontend.test.js test/qa/e2e.test.js test/qa/integrity.test.js test/unit/microphone-ui.test.js
```

This verification does not certify physical device speech quality, real-service admission, or immediate translation. No private meeting recordings were used and no dependencies were added. Browser network/HTTP console-error cases tracked as BUG-004 remain outside this UI fix.
