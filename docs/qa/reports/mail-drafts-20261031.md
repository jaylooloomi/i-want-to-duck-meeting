# Local meeting email drafts — 2026-10-31

## Implemented scope

The fourth notes tab, Email, stores a locally editable subject, To/Cc/Bcc and plain-text body. It offers save, copy and TXT download; there is no mailbox-create or send button. Agent-authored content is read from the exact meeting through the mail-draft CLI and handed to independently connected mailbox tools only under user instruction. No Ollama, additional model API, mailbox request or real email delivery was used.

Canonical storage is mail-draft.json, with a readable mail-draft.md companion. Existing summary.md and transcripts are immutable to this feature. Explicit expectedRevision/sourceRevision checks and an exclusive write lock prevent silent concurrent overwrites. Changed notes mark the draft stale. Dirty edits survive polling and meeting switching in the current page; reload/navigation warns before unsaved work is lost. This is not durable autosave.

## Validation commands

```powershell
node --test --test-concurrency=1 "test/unit/**/*.test.js" "test/qa/*.test.js"
node --test --test-concurrency=1 test/unit/mail-draft.test.js test/qa/mail-draft.test.js test/qa/integrity.test.js
node test/qa/capture-mail.mjs
node scripts/install.js --target both --skip-audio
```

Browser cases use semantic locators, event-based waits and the shared console/pageerror failure guard. No new skips or console exclusions were added. Expected write conflicts use HTTP 200 with ok:false and an explicit domain error, so handled concurrency errors do not generate browser resource-console errors. Invalid payloads and cross-origin writes still return HTTP errors.

## Evidence and limitations

- Synthetic screenshots: docs/design/mail-implementation-20261031 (four theme/viewport/locale captures).
- mail-draft unit/CLI tests cover malformed fields, header injection, exact-ID isolation, ownership, source changes and lock contention.
- Browser/API tests cover save/reload/copy/download, mobile and desktop, light/dark, concurrent Agent writes, old responses and three translated interfaces.
- The first broad development run found an isolated-page uiText dependency; mail.js now uses its own localization helper. A focused authored-markup replay passed afterward.
- A demo-only local Teams meeting was given a fictional draft with empty recipients via the real CLI; no private meeting was altered.
- Codex and Claude Code local skill copies were checked for the draft-field and stale-source instructions after installation. Existing Claude sessions need plugin reload or restart to consume changed skill text.
- Real provider draft creation/sending, recipient lookup, attachments and delivery tracking are outside this App feature and were not tested. The local draft status never claims provider delivery.
- A crashed writer may leave a lock; automatic stale-lock deletion is intentionally absent. Investigate the owning process before recovery.

Final regression results are recorded in TEST_SUMMARY.md.


## Final results

Full unit + QA: 692 tests, 676 passed, 0 failed, 16 existing BUG-004 skips (488.8 s). Final mail/integrity replay: 17 passed, zero failed/skipped (31.4 s). Doctor: ok. No dependency changes. These are automated local/fixture results, not a real email-provider integration claim.


## Default generation follow-up

Both skill templates now direct the Agent to prepare local mail content after every authorized notes task, unless the user opts out. This does not authorize mailbox creation or sending. Existing fresh drafts and user revisions are retained; failures are reported separately from successful notes. All seven synthetic meetings now contain subject/body drafts (six newly written, one preserved), with empty recipients and unchanged source notes. Unit/CLI plus integrity replay: 7 passed, zero failed/skipped.


## Consolidated mail release verification — 2026-10-31

Two unit + QA runs passed: 692 tests / 676 passed / 0 failed / 16 existing BUG-004 skips, in 488.8 s and 556.9 s (`test-mail-full-verified.log`, `test-mail-release.log`). The latter includes the final default-generation skill instructions. Mail/integrity replay: 17 passed; default-generation unit/integrity follow-up: 7 passed. No new skips.

Additional integration run: 81 tests, 72 passed, 4 failed, 5 existing environment/opt-in skips. All four failures were `spawnSync powershell.exe ENOENT` caused by the invocation PATH, not changed product logic. With Windows PowerShell on PATH, the entire Chrome-launch file passed 7/7 and the TTS/STT file passed 1/1 (`test-mail-release-chrome.log`, `test-mail-release-stt.log`). All failed cases therefore passed targeted replay; the full integration suite was not rerun afterward. Use the normal Windows shell PATH (including WindowsPowerShell/v1.0) when running it.

Included earlier UI changes: vertically centered notes tabs, plain utterance overflow button, and wider highlighted utterance background. Design evidence uses synthetic content. Private meeting folders, recordings, local mail drafts, browser profiles and model files are excluded from this commit. No real mailbox creation or sending was tested.


## Stable tab controls follow-up

Mail keeps the shared header copy/download toolbar in place and delegates these actions to the current mail draft. Switching overview/decisions/actions/mail retains exact control rectangles in desktop/mobile and both themes. Mail button text is flex-centered. Browser/API/integrity replay: 13 passed, zero failures/skips (29.7 s).


## Single-scroll notes layout

The workspace owns vertical scrolling; notes/mail panels expand naturally without independent overflow. Mail body height follows its text and viewport width. An 80-line input was verified without textarea or mail-panel overflow at 1280/390 in light/dark; existing control-position and mail functionality checks still pass. Browser/API/integrity replay: 13 passed, zero failures/skips (29.8 s).
