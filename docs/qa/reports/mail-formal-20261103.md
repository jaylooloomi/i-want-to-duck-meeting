# Formal complete mail draft — 2026-11-03

Implemented selected option 1. Preview/apply creates a complete template only for blank bodies (or the unchanged template just generated in this editing session). Existing body text retains its manual sections, with existing conservative decision/action replacement and undo. Preview reflects the actual proposed result.

First use selects all note items and all four context sections. Saved `selectedItemIds: []` is respected. Context section choices are stored in this browser per meeting; note selections remain in the versioned draft JSON. No recipient emails are inferred.

Meeting time is formatted in Asia/Taipei using saved start/end timestamps; missing values remain explicitly unavailable. Platform/code come from saved metadata. Names are deduplicated recorded speakers, explicitly labeled as transcript-derived and incomplete attendance. No new participant-roster capture has been implemented or live-validated. Summary/discussion use corresponding Agent-authored Markdown sections; missing discussion is marked for Agent completion, never fabricated from decisions.

Copy/download includes the previewed/applied body. No external mailbox action, model request, private-record rewrite, or dependency change.

## Verification

Commands:

```powershell
node --test --test-concurrency=1 test/qa/mail-draft.test.js
node --test test/qa/integrity.test.js
```

Browser cases use the shared strict page/console error guard and synthetic fixture data. Covers desktop/mobile, light/dark, copy/download, revisions, stale responses, retained manual text, repeated apply, undo, language switches, and empty-selection persistence.

Final result: 23/23 mail API/browser cases passed; 3/3 integrity cases passed; JavaScript syntax check passed. Frontend-only files deployed to the installed local site, with backup under `backups/mail-formal-before-20261103`. HTTP verification returned 200 and the new template function. Installed package version is unchanged; no installer Release was published. Logs: `test/.tmp/mail-formal-regression.log`, `test/.tmp/mail-integrity.log`.
