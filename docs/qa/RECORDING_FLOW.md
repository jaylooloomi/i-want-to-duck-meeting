# Recording panel interaction contract

Updated: 2026-10-30 (Asia/Taipei).

## Scenarios and necessary operations

| Scenario | Entry | Visible operation | Completion |
|---|---|---|---|
| Agent-managed Meet/Teams | Existing Agent join workflow | View selected meeting status; stop that exact session | Worker finalizes recordings, then existing Agent summary flow |
| New local microphone recording | Sidebar: ＋ 新增記錄 | Select capture mode; optionally expand device settings; start and allow microphone access | Stop flushes PCM, releases tracks, then awaits transcription |
| New computer audio plus microphone | Same sidebar entry | Select dual capture mode; optionally adjust Windows devices | Only start after device enumeration completes; stop both lanes |
| Historical meeting | Sidebar meeting card | Read transcript and notes; return to active session if present | No stop button for a different session |
| Another recording or finalization exists | New-record entry | Return to the active session | Setup remains closed; backend rejects a concurrent capture |

## Review decisions

- The sidebar is the only meeting selector. No duplicate meeting dropdown.
- Follow-latest is an explicit checkbox; manually selecting a card disables it.
- New capture is a deliberate action. Browsing completed meetings never opens microphone setup automatically.
- Existing `?source=teams` links preserve their setup entry behavior. The backend still checks active recordings before starting.
- Stop uses an exact meeting ID with same-origin checks. It never terminates another meeting's process. Browser-owned capture flushes its own PCM before stopping; workers receive their existing STOP signal.
- Stop is disabled while requested; terminal/finalizing records cannot be stopped again through the API.
- Device settings and long explanations are collapsed by default. Setup can be canceled without requesting microphone access.
- Browser microphone recording requires keeping its recording tab open. Closing it sends the existing stop beacon. Signal meters do not certify recognized speech.
- Translation behavior is unchanged by this UI task.

## Executable acceptance tests

- FLOW-01: desktop/mobile new capture, real browser AudioWorklet PCM over HTTP, historical navigation, return and stop only own capture.
- FLOW-02: existing Meet context, duplicate capture rejection, exact-ID STOP file without touching history.
- FLOW-03: stop failure is visible and retry remains available.
- FLOW-04: explicit follow-latest behavior and manual selection.
- FLOW-API: same-origin enforcement, missing/terminal/finalizing rejection, exact-ID stop.
- SIDEBAR-01: 41 cards retain content height on desktop/mobile and remain selectable.

All new browser cases use semantic locators, event-driven waits and a shared strict console/pageerror guard. They use synthetic test data, not private meeting recordings. This does not certify real-service Google/Teams admission, physical microphones, ASR accuracy or immediate translation.


## Language shortcuts

- 英中: English transcript filter + Traditional Chinese translation.
- 中英: Chinese/CJK (including mixed-language utterances) filter + English translation.
- Both dropdowns and URL query parameters change together. Reload preserves settings; manual changes update the pressed state.
- These controls do not change Google/Teams recognition language. Pending captions are provisionally translated with throttled requests and corrected after finalization. English display excludes CJK-containing utterances; this is a simple display filter rather than language identification.
- LANG-01 verifies both directions, native Teams records, reload, manual override and mobile overflow with deterministic translation responses. Live third-party translation service quality is not certified by this controlled test.

Follow-latest, view mode, auto-scroll and advanced notes actions are available from Settings. Transcript search expands from the magnifying-glass button.
