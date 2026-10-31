# Workspace UI regression — 2026-11-01

## Scope

Source checkout after v0.3.4: independent panel scrolling and bottom visibility, equal language selector widths, mail selection preservation/deduplication, fixed action/decision tables, shared inline source controls across Overview/Decisions/Actions, and vertical centering of all table cells. No new installer was built for this change.

## Verification

| Suite | Result | Local evidence |
| --- | --- | --- |
| Source/table geometry and integrity | 19 passed, 0 failed | `test/.tmp/source-centered.log` |
| Language width/presets and integrity | 17 passed | `test/.tmp/language-equal-width.log` |
| Workspace bottom/player bounds | 10 passed | `test/.tmp/workspace-bottom-verified.log` |
| Source navigation and integrity | 7 passed | `test/.tmp/workspace-bottom-source-verified.log` |
| Mail preservation | 23 passed | `test/.tmp/mail-preserve-verified.log` |
| Supplied duplicate-mail regression, desktop/mobile | 2 passed after fixing reload setup to reopen the selection disclosure | `test/.tmp/mail-deduplicate-supplied-final.log` |
| Decision rendering / mail integration | 2 passed | `test/.tmp/decision-table-integration.log` |

Browser tests use isolated synthetic meetings and a shared guard for console errors and uncaught page errors. Geometry covers desktop/tablet/mobile; action table widths cover both themes. Source tests cover linked and unlinked entries, list and Markdown table formats. No private meeting data is committed.

A broader combined run (`test/.tmp/master-ui-regression.log`) was interrupted when the execution session ended. Its partial output contains unfinished/browser setup failures and has no final totals; it is **not** claimed as a completed passing regression. The individual completed results above remain the verified evidence. No new live meeting or real mailbox acceptance was performed.

## Reproduce

Run from the project root with Node.js 22+ and Google Chrome installed:

```powershell
node --test --test-concurrency=1 test/qa/action-columns.test.js test/qa/mail-draft.test.js test/qa/transcript-scroll.test.js test/qa/language-presets.test.js test/qa/i18n.test.js test/qa/visual-audit.test.js test/qa/integrity.test.js
```

The harness starts/stops isolated local test servers. Failure artifacts are retained under `test/.tmp/qa/` and ignored by Git.

## Limits

This does not resolve existing `BUG-ZIP-001` (large audio in whole-session ZIP exports); preserve the original WAV. Existing skipped tests and live service acceptance limits in BUG_REPORT.md remain. The published v0.3.4 installer does not include this commit. Local installed frontend assets were updated separately during UI verification.
