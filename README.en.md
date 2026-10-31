## Windows installer (recommended)

Download **DuckMeeting-0.3.4-Setup-x64.exe** from [GitHub Releases](https://github.com/jaylooloomi/i-want-to-duck-meeting/releases/latest). Run Setup, choose Codex / Claude Code integrations and a desktop shortcut, then open a new Agent conversation and paste a meeting link. Claude integration requires the Claude CLI; both Agents and Google Chrome remain separately installed applications. No Git, global Node.js or npm is required for the installer edition.

- Installs per user, without administrator rights, under `%LOCALAPPDATA%\Programs\DuckMeeting`. Bundled Node.js 24.13.0 and Playwright runtime are included. Windows x64 only (Windows 10/11).
- Recordings, notes, sign-in profile and downloaded models live separately under `%LOCALAPPDATA%\DuckMeeting\data`. Existing source-checkout data is not migrated automatically. Installer workspace: `http://127.0.0.1:8792`; source checkout keeps port 8791.
- Speech models/Python audio dependencies are not bundled. First audio use prepares them online; **Start menu → Duck Meeting → Prepare speech recognition** can prepare them in advance with visible progress. Keep that window open until completion.
- **Start menu → Duck Meeting → Check for updates** checks stable GitHub Releases, asks before downloading, verifies SHA-256 against the release checksum file and opens Setup. Private repositories require access; when API access is unavailable, it opens the Releases page for browser sign-in/manual download. It does not store a GitHub token.
- Running a newer Setup upgrades the same installation and preserves data. Finish recordings before upgrading or uninstalling.
- Remove via **Windows Settings → Apps → Duck Meeting**, or the Start-menu uninstall shortcut. Managed skills are removed only if still owned by this installation. Data is kept by default; interactive uninstall offers a second-confirmed deletion option. Silent uninstall always keeps data.
- This first installer is **not code-signed**; Windows may show an unknown-publisher/SmartScreen prompt. SHA256SUMS is an integrity check, not publisher signing.

Developers: install the official Inno Setup compiler, set `ISCC_PATH`, then run `npm ci` and `npm run build:windows`. The optional manual GitHub Actions workflow builds and smoke-tests the package. See [installer QA and limitations](docs/qa/reports/windows-installer-030.md).

# English documentation

The English README is now the default: [README.md](README.md).

[Traditional Chinese / 繁體中文](README.zh-TW.md)


### Meeting email drafts

Open **Meeting notes → Email** after the Agent finishes the meeting notes. After each authorized meeting-notes task, the Agent also prepares a local email subject and body from the actual notes by default (unless you opt out); recipients may remain empty until confirmed. Edit the local draft, then **Save draft**, **Copy email**, or **Download draft**. There is deliberately no mailbox-creation or send button. Saving locally does not create or send an email.

When you ask the Agent to create or send an email, it reads this exact meeting using `node bin/openmeeting.js mail-draft <ID> --json`, then uses its connected mailbox tools within your instruction. It must confirm missing recipients rather than infer addresses from speaker names. No extra summary model API is used.

For Agent updates, save UTF-8 JSON with `to`, `cc`, `bcc` arrays, `subject`, `body`, and the returned `expectedRevision` (the current `revision`, initially null) and `sourceRevision`; run `node bin/openmeeting.js mail-draft <ID> --file <absolute-json-path> --json`. The returned fields live under `draft`. Thread ownership is enforced where the meeting has an owner. Canonical content is stored in `mail-draft.json`, with a readable `mail-draft.md` companion. Version conflicts preserve your edits; copy them before reloading and reconciling. Changed meeting notes mark the saved draft as stale. Existing notes and transcripts remain unchanged. Mailbox creation/sending requires a connected mail service and separate user instruction; it has not been exercised against a real mailbox in this implementation.

The notes header and tabs keep their positions when switching to Email. Shared Copy/Download actions follow the selected tab. Notes expand in the workspace scroll area, while the email editor has a bounded height with its own text scrollbar and a nearby sticky action row.

### Decision/action sources and mail content

Use **Link source / View original** on a decision or action to associate exact transcript text, timestamp and speaker. Locate the passage or replay its recording when audio and time exist; unknown/changed sources stay unlinked. In **Email → Choose mail content**, select decisions/actions, preview, then explicitly apply; undo restores the previous body. Checkbox selection alone does not overwrite manual text or send mail.

**Known limitation:** full-session ZIP exports currently have a confirmed audio CRC issue for larger files. Keep original WAV files directly; a successful ZIP download does not verify the recording. See BUG-ZIP-001 in BUG_REPORT.md.

Starred transcript highlights also appear on the recording waveform at their saved timestamps. Click a star to seek to that moment; removing the highlight removes the pin. Pins require an available recording and a valid timestamp within its duration.

The notes card scrolls vertically within a bounded height, keeping its tabs visible. Expanded mail selections and bottom actions remain reachable; the email body can scroll independently. Transcript search highlights literal matches in displayed text and speaker names (case-insensitive for English), and clearing the query removes the marks.

Long transcripts scroll independently within their card while search/language controls and the recording player remain outside the scrolling area. Meeting-notes tabs retain a visible scrollbar rail in light/dark themes.

[Technical stack and architecture (Traditional Chinese)](docs/TECH_STACK.md)

Click a linked decision or action text (or press Enter) to clear transcript filters, scroll to the exact source and temporarily highlight it. Items without linked evidence do not infer a destination.

When preparing authorized meeting notes, the Agent instructions require a full original transcript quote and its original ISO timestamp for each decision/action. Only exact unique matches become links; unknown or ambiguous evidence stays unlinked. Upgrading does not backfill historical meetings. Reload Agent instructions after upgrading.
