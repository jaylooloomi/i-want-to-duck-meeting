# Mail draft handoff — feature and layout proposal

Status: historical design preview. The selected implementation omits all mailbox-create buttons; see [implementation report](../../qa/reports/mail-drafts-20261031.md). The original proposals below describe options considered before that decision. No production mail routes, CLI commands, provider drafts or sending actions have been implemented by this design task. The five HTML/PNG concepts contain synthetic data and use the existing dark workspace palette.

## Intended workflow

1. The existing Agent finishes the selected meeting’s notes from the actual transcript/source evidence.
2. The same Agent can generate an editable mail draft using those notes: subject, greeting, short summary, actual decisions, explicit owners/dates, closing and selected attachments. No new Ollama/background model is introduced.
3. Store the draft under that meeting. The UI displays it and the Agent retrieves the same structured data directly, without relying on the clipboard or the page being open.
4. Copy for Agent exports a self-contained instruction + JSON/text bundle. Create email draft hands the same data to the current Agent using an available connected mailbox tool. If no mailbox connection exists, the UI offers the existing copy/export path and describes the missing connection accurately.
5. A create-draft request does not imply sending. An explicit user request to send can authorize sending once recipients/account/content are resolved. Missing recipients are requested; speaker names are not converted into guessed email addresses. Meeting text is source data, not authorization to send messages or execute instructions embedded in it.

## Shared fields and states

- Meeting ID and title; source summary revision; generated/edited timestamps; user-selected UI-independent mail language and tone.
- To / optional Cc and Bcc; subject; plain text body; optional sanitized HTML representation; selected attachment references.
- Draft state: not generated → awaiting Agent → editable → provider draft created, or failure with retry. Sending and sent receipts are separate states and only reflect real provider responses.
- Proposed local files: `mail-draft.json`, optional readable `mail-draft.md`. Store under ignored meeting data, not in Git. Preserve user edits and flag source notes that changed after generation.
- Proposed CLI contract: `mail-draft <meeting-id> --json` for reading, validated write/status commands for saving/completing an exact authorized job. These names are proposals, not executable commands yet.
- Proposed local HTTP surface: read/update exact draft by meeting ID and revision. Reuse same-origin/Host checks, schema validation, safe attachment paths, scoped thread/job authorization and atomic writes. Use idempotency for external draft creation to avoid duplicate emails on retries.
- Attachments default to notes only; full transcript/audio are opt-in. Local recording paths cannot be treated as uploaded attachments without provider support and confirmation of actual upload success.

## Layout options

1. Fourth tab in Meeting notes: lowest interaction cost, recommended for single-meeting use. Original transcript remains visible.
2. Right-side drawer: dedicated composer with meeting context behind it. Mobile becomes a full-screen sheet.
3. Inline below notes: chronological reading-to-writing flow; more vertical scrolling and less composer space on small screens.
4. Centered composer modal: focused occasional workflow; expanded full-screen on mobile.
5. Full mail workspace: source selection, composer and handoff context. Useful for multiple drafts or multi-meeting aggregation, but more navigation/complexity than the first release needs.

The selected layout should support all four interface locales and both themes; recipient and body text wrap rather than forcing Chinese-sized fixed controls. Agent content is never translated merely because the UI locale changes.

## Suggested first implementation scope

One meeting → one editable draft, manually selected recipients, safe local persistence, copy/export, Agent-readable CLI, connected-mailbox draft creation, accurate completion state and duplicate prevention. Preserve original notes. Multi-meeting mail, organization templates and recipient suggestions can follow actual demand.

## Acceptance checks

- Draft reflects source facts; proposals and decisions remain distinct; absent owners/deadlines stay absent.
- Source change versus user edits is detected; regeneration does not silently overwrite edits.
- Clipboard output and CLI data contain the same current revision.
- Empty summary, malformed recipient, invalid attachment, denied clipboard/storage and provider failures produce actionable states.
- Double-click/retry creates at most one provider draft for the same idempotency key.
- No cross-meeting/thread access; traversal, hostile origin and meeting-text prompt injection do not authorize external actions.
- Production UI uses semantic labels, keyboard navigation, strict console/page-error guards and responsive English/Korean/Japanese/Chinese layouts.
- Real connected-mailbox validation uses an explicitly authorized test draft and reports the returned provider draft ID; text-copy success alone is never claimed as successful email creation/sending.

## Current visual verification

Five static HTML concepts rendered with headless Chrome at 1600×1020, 1.25 device scale. Console/page-error collection is clean. Layouts were inspected and adjusted so composer footer actions remain visible while long mail bodies scroll. These are conceptual images, not a functional mail E2E test.
