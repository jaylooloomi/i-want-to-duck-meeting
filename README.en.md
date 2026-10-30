# English documentation

The English README is now the default: [README.md](README.md).

[Traditional Chinese / 繁體中文](README.zh-TW.md)


### Meeting email drafts

Open **Meeting notes → Email** after the Agent finishes the meeting notes. After each authorized meeting-notes task, the Agent also prepares a local email subject and body from the actual notes by default (unless you opt out); recipients may remain empty until confirmed. Edit the local draft, then **Save draft**, **Copy email**, or **Download draft**. There is deliberately no mailbox-creation or send button. Saving locally does not create or send an email.

When you ask the Agent to create or send an email, it reads this exact meeting using `node bin/openmeeting.js mail-draft <ID> --json`, then uses its connected mailbox tools within your instruction. It must confirm missing recipients rather than infer addresses from speaker names. No Ollama or extra summary model API is used.

For Agent updates, save UTF-8 JSON with `to`, `cc`, `bcc` arrays, `subject`, `body`, and the returned `expectedRevision` (the current `revision`, initially null) and `sourceRevision`; run `node bin/openmeeting.js mail-draft <ID> --file <absolute-json-path> --json`. The returned fields live under `draft`. Thread ownership is enforced where the meeting has an owner. Canonical content is stored in `mail-draft.json`, with a readable `mail-draft.md` companion. Version conflicts preserve your edits; copy them before reloading and reconciling. Changed meeting notes mark the saved draft as stale. Existing notes and transcripts remain unchanged. Mailbox creation/sending requires a connected mail service and separate user instruction; it has not been exercised against a real mailbox in this implementation.

The notes header and tabs keep their positions when switching to Email. Shared Copy/Download actions follow the selected tab. Notes expand in the workspace scroll area, and the email body grows with its content to avoid nested notes-panel/textbox scrollbars.
