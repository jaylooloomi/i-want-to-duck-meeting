# openmeeting — Design Spec

Date: 2026-10-04 · Status: approved scope ("貼連結 → 加入會議 → 記錄對話文字")

## 1. Goal

The user pastes a Google Meet link into Claude Code. A bot joins the meeting as a **silent**
participant (mic + camera off, can never speak), records **what is said as text** (speaker +
timestamp + text), and stops by itself when the meeting ends. Claude then shows the transcript
and a short summary in the conversation.

Hard constraints: everything free (no paid SaaS / APIs / Workspace features). Windows 10,
Node 24, Chrome 151 installed, Python 3.12 available via `uv`, Docker NOT required.

Non-goals (v1): speaking in meetings, Zoom/Teams, calendar auto-join, multiple concurrent
meetings, a separate summarization pipeline (Claude in the session writes the summary).

## 2. Key facts this design relies on (from research, Oct 2026)

- The Google Meet REST API cannot join meetings or stream audio; Meet's own transcripts are
  paid-only and have **no Chinese**. → a browser bot is the only free way in.
- Meet **live captions** are free for everyone, per-viewer (no host permission), and support
  "Chinese (Mandarin, Traditional)" = language code `cmn-Hant-TW`. Captions are produced
  server-side (no local CPU). They include the speaker's display name.
- Since 2026 Google is stricter with bots: headless is blocked, Playwright-launched Chrome is
  fingerprinted, risky join requests land in a host queue that **defaults to Deny**
  (host must click ⋮ → Admit). Best free path on a home PC: **real installed Chrome, headful,
  dedicated `--user-data-dir`, launched by us, Playwright attaches via CDP**; force English UI
  (`--lang=en-US` + `?hl=en`) so text selectors are stable.
- Signing in to Google from automation is blocked → the human signs the bot profile in once
  by hand (`openmeeting login`). Anonymous guest join also supported.
- Free-account meetings with ≥3 participants end at 60 min (the bot counts as a participant).
- Whisper-class STT runs fine on CPU after the meeting (faster-whisper, int8). Use Python 3.12
  and pin `av<19` (PyAV 19 breaks faster-whisper 1.2.1). Convert output with OpenCC `s2twp`.
- Claude Code hooks fire only on Claude Code's own lifecycle events → they cannot detect a
  meeting ending. The bot detects the end itself. A Bash command started with
  `run_in_background` re-invokes Claude when it exits → that is the "meeting over" signal.

## 3. Architecture

```
 Claude Code session
   /openmeeting:meet <link>   (plugin skill: instructions only)
        │ Bash: openmeeting join <link>          → spawns detached worker, prints id
        │ Bash (run_in_background): openmeeting wait <id>  → exits when meeting is done
        ▼                                         (Claude is re-invoked, reads transcript.md,
 ┌──────────────── worker process (Node) ───────────┐   writes summary.md, shows user)
 │ session.js                                        │
 │  ├─ chrome.js   launch real Chrome (headful,      │
 │  │              own profile, CDP port) + connect  │
 │  ├─ meet/join.js     prejoin → lobby → IN_CALL    │
 │  ├─ meet/incall.js   dismiss modals, captions ON, │
 │  │                   caption language cmn-Hant-TW │
 │  ├─ page/caption-observer.js (in page) ──► captions/assembler.js ─► transcript/store.js
 │  ├─ page/audio-capture.js   (in page) ──► audio/wav-writer.js (audio.wav backup)
 │  ├─ end detection (meet/state.js classifier + participant count + STOP file + timers)
 │  └─ finalize: transcript.md; if no captions → stt/transcribe.py (Whisper fallback)
 └───────────────────────────────────────────────────┘
        │ writes
        ▼
 <OPENMEETING_HOME>/meetings/<id>/ status.json transcript.jsonl transcript.md audio.wav ...
```

Claude Code mechanisms used: **Skill** (entry point + instructions), **Plugin** (packaging so
`/openmeeting:meet` works in any project). **Not used: MCP, Hooks** (not needed; hooks can't
observe Meet).

## 4. Repository layout

```
package.json                 type: module, bin { openmeeting: bin/openmeeting.js }, deps: playwright-core
bin/openmeeting.js           CLI entry (thin; parses args, calls src/cli.js)
src/cli.js                   command implementations
src/config.js                paths + defaults (env overrides)
src/url.js                   Meet URL parsing/normalization
src/status.js                meeting dir creation, status.json read/write, locate "latest"
src/log.js                   tiny logger → bot.log + stderr
src/chrome.js                find/launch Chrome, connect via CDP, close
src/meet/selectors.js        ALL selectors + text matchers (single place to patch)
src/meet/state.js            pure classify(snapshot) → state
src/meet/join.js             join flow
src/meet/incall.js           post-join setup (modals, captions, language), leave
src/page/snapshot.js         browser-side: collectSnapshot(SEL) → snapshot object
src/page/caption-observer.js browser-side: installCaptionObserver(SEL)
src/page/audio-capture.js    browser-side: installAudioCapture(opts)
src/captions/assembler.js    pure: caption DOM snapshots → finalized utterances
src/transcript/store.js      append transcript.jsonl, render transcript.md
src/audio/wav-writer.js      streaming 16 kHz mono PCM16 WAV writer
src/session.js               orchestrates one meeting (used by worker + --foreground)
src/worker.js                detached process entry → runSession()
stt/transcribe.py            faster-whisper fallback
stt/requirements.txt
plugin/.claude-plugin/plugin.json
plugin/skills/meet/SKILL.md.tmpl   (absolute repo path substituted at install)
.claude-plugin/marketplace.json    (repo root = local marketplace "openmeeting-local")
scripts/install-plugin.js    renders SKILL.md from template, adds marketplace, installs plugin
scripts/make-tts-wav.ps1     generates zh-TW test speech WAV via System.Speech (Hanhan voice)
test/unit/*.test.js          node:test
test/mock-meet/server.js     local HTTP server that imitates Meet's DOM/flows
test/mock-meet/public/*      mock pages/scripts
test/integration/*.test.js   real Chrome against the mock
```

Runtime data (gitignored) under `OPENMEETING_HOME` (default: repo root):
`chrome-profile/`, `meetings/<id>/`, `.venv-stt/`, `models/`.

## 5. Module contracts

All JS is ESM, plain JavaScript with JSDoc (no build step). Node ≥ 22. Tests use `node:test`
+ `node:assert/strict`. Only runtime dependency: `playwright-core`.

### 5.1 config.js
```js
export function getConfig(env = process.env) → {
  home,            // env OPENMEETING_HOME || repo root (dirname of package.json)
  meetingsDir,     // home/meetings
  profileDir,      // env OPENMEETING_PROFILE || home/chrome-profile
  chromePath,      // env CHROME_PATH || null (auto-detect in chrome.js)
  displayName,     // env OPENMEETING_NAME || 'Arthur 的會議記錄'
  captionLang,     // env OPENMEETING_CAPTION_LANG || 'cmn-Hant-TW'
  headless,        // env OPENMEETING_HEADLESS === '1' (tests only; real Meet blocks headless)
  muteAudio,       // env OPENMEETING_MUTE !== '0' (default true: don't play meeting audio on speakers)
  allowAnyHost,    // env OPENMEETING_ALLOW_ANY_HOST === '1' (tests: allow mock server URLs)
  lobbyTimeoutMs:   15 * 60_000,
  aloneTimeoutMs:   60_000,       // ≤1 participant this long after others were seen → leave
  noOneTimeoutMs:   15 * 60_000,  // nobody else ever joined → leave
  maxDurationMs:    4 * 3600_000,
  pollMs:           1500,
  sttVenv,         // home/.venv-stt
}
```
Every timeout can be overridden by env `OPENMEETING_<NAME>_MS` (e.g. `OPENMEETING_ALONE_TIMEOUT_MS`).

### 5.2 url.js
```js
export function parseMeetUrl(input, { allowAnyHost = false } = {}) → { code, url }
```
- Accepts `https://meet.google.com/abc-defg-hij`, with/without scheme, extra query/hash,
  trailing slash, bare code `abc-defg-hij`, and `meet.google.com/lookup/<x>` paths.
- `code`: the Meet code if it matches `/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/`, else the last path
  segment (sanitized to `[a-z0-9-]`).
- `url`: normalized `https://meet.google.com/<path>?hl=en` (always sets `hl=en`, drops other
  query params except `authuser`).
- Non-meet hosts throw `Error('not_a_meet_url')` unless `allowAnyHost` (then keep host/scheme,
  still set `hl=en`).
- Empty/garbage throws `Error('not_a_meet_url')`.

### 5.3 status.js
```js
export function newMeetingId(code, now = new Date()) → 'YYYYMMDD-HHmmss-<code>' (local time)
export function createMeetingDir(meetingsDir, id) → absDir   // mkdir -p, plus screens/
export function writeStatus(dir, patch) → status             // read-merge-write atomically (tmp + rename), sets updatedAt
export function readStatus(dir) → status | null
export function resolveMeeting(meetingsDir, idOrLatest) → { id, dir } | null   // 'latest' = newest dir by name
export function listMeetings(meetingsDir) → [{ id, dir, status }]  // newest first
export function isProcessAlive(pid) → boolean
```
status.json shape:
```json
{
  "id": "20261004-221530-abc-defg-hij", "code": "abc-defg-hij", "url": "https://meet.google.com/abc-defg-hij?hl=en",
  "displayName": "Arthur 的會議記錄", "pid": 1234,
  "state": "starting|launching|joining|waiting_admission|in_call|leaving|transcribing|done|failed",
  "startedAt": "ISO", "joinedAt": null, "endedAt": null,
  "endReason": null,
  "error": null,
  "stats": { "utterances": 0, "speakers": [], "audioSeconds": 0, "captionLang": "unknown", "captionsOn": false },
  "updatedAt": "ISO"
}
```
`endReason ∈ meeting_ended | removed | alone | no_one_joined | max_duration | user_stop | signal | page_closed`.
`error.code ∈ signin_required | not_found | blocked | denied | lobby_timeout | chrome_not_found |
chrome_launch_failed | join_failed | crashed`, plus `error.message`.
Terminal states: `done`, `failed`.

### 5.4 chrome.js
```js
export function findChrome(env = process.env) → absPath  // CHROME_PATH, then
   // %ProgramFiles%\Google\Chrome\Application\chrome.exe, %ProgramFiles(x86)%\..., %LocalAppData%\Google\Chrome\Application\chrome.exe
   // throws Error('chrome_not_found')
export function chromeArgs({ profileDir, port, headless, muteAudio, windowSize = '1280,800' }) → string[]
export async function launchChrome({ chromePath, profileDir, headless, muteAudio, log, startUrl = 'about:blank' })
   → { proc, port, cdpUrl, close: async () => void }
export async function connectChrome(cdpUrl) → { browser, context, page }
```
`chromeArgs` MUST produce exactly these (order irrelevant) and nothing automation-flavored:
`--user-data-dir=<profileDir> --remote-debugging-port=<port> --lang=en-US --no-first-run
--no-default-browser-check --autoplay-policy=no-user-gesture-required
--disable-backgrounding-occluded-windows --disable-renderer-backgrounding
--disable-background-timer-throttling --window-size=<windowSize>`
+ `--mute-audio` if muteAudio + `--headless=new` if headless.
Forbidden: `--enable-automation`, `--disable-web-security`, `--ignore-certificate-errors`,
UA overrides, `--use-fake-ui-for-media-stream` (would silently grant the real mic).
`launchChrome` picks a free port (`net` listen 0), spawns Chrome, polls
`http://127.0.0.1:<port>/json/version` up to 20 s for `webSocketDebuggerUrl`, else
`chrome_launch_failed`. `close()` tries `browser.close()` via CDP then kills the process tree
(`taskkill /pid <pid> /T /F` on win32). `connectChrome` uses `chromium.connectOverCDP`, takes
`browser.contexts()[0]` and reuses its first page or creates one.

### 5.5 meet/selectors.js
Exports `SEL` (CSS selector lists, tried in order) and `TEXT` (substring matchers; compare
against text normalized with `normalizeText()` = replace `’‘` with `'`, collapse whitespace).
```js
export const TEXT = {
  joinCtas: ['Join now','Ask to join','Switch here','Join here too','Join anyway','Ask to join anyway','Join the call now'],
  continueWithoutDevices: ['Continue without microphone and camera','Continue without microphone','Continue without camera'],
  lobby: ['Asking to be let in',"You'll join the call when someone lets you in",'Please wait until a meeting host brings you into the call','Waiting for the host to join','Waiting for the host to let you in'],
  denied: ['denied your request to join','request to join was denied','You were denied',"weren't allowed to join",'not allowed to join','Ask to join again'],
  lobbyTimeout: ['No one responded to your request to join','No one has responded to your request to join'],
  blocked: ["You can't join this video call","You can't join this meeting",'There is a problem connecting to this video call'],
  notFound: ['Check your meeting code','Invalid video call name','Your meeting code has expired',"The meeting code you entered doesn't work",'Meeting not found'],
  ended: ["You've been removed from the meeting",'The call ended because everyone left','Your host ended the meeting for everyone','Meeting ended','Call ended','You left the meeting'],
  reconnecting: ['Trying to reconnect','You lost your network connection','Reconnecting'],
  dismiss: ['Got it','Dismiss','Stay in the call'],
}
export const SEL = {
  nameInput: ['input[type="text"][aria-label="Your name"]','input[jsname][type="text"]:not([aria-hidden="true"])','input[placeholder*="name" i]'],
  micOff: ['[aria-label*="Turn off microphone"]'],
  camOff: ['[aria-label*="Turn off camera"]'],
  leave: ['button[aria-label="Leave call"]','button[jsname="CQylAd"]'],
  captionsTurnOn: ['button[aria-label="Turn on captions"]','button[aria-label="Captions and translation"]'],
  captionsTurnOff: ['button[aria-label="Turn off captions"]'],
  participantTile: '[data-participant-id]',
  selfName: '[data-self-name]',
  avatarCount: '[data-avatar-count]',
  peopleButton: 'button[aria-label^="People"]',
  moreOptions: ['button[aria-label="More options"]'],
  settingsMenuItemText: 'Settings',
  captionsSettingsTab: ['button[aria-label="Captions"]'],
  captionLangItem: (code) => `li[data-value="${code}"]`,
  closeDialog: ['button[aria-label="Close dialog"]','button[aria-label="Close dialogue"]'],
  captionRegion: ['[role="region"][aria-label="Captions"]','div[role="region"][tabindex="0"]','.vNKgIf'],
  captionBlock: '.nMcdL',
  captionSpeaker: '.NWpY1d',
  captionText: '.ygicle',
}
export function normalizeText(s) → string
export function matchAny(text, list) → string | null   // returns the matched entry
```

### 5.6 page/snapshot.js (browser-side, must be self-contained — passed to `page.evaluate`)
```js
export function collectSnapshot(SEL_SERIALIZABLE, TEXT) → {
  url, text,                 // document.body.innerText, normalized, max 20000 chars
  nameInputVisible,          // any SEL.nameInput visible (offsetParent !== null and not aria-hidden)
  ctaTexts,                  // visible <button> innerTexts (trimmed) that exactly equal a TEXT.joinCtas entry
  leaveButton, captionsOn,   // captionsOn: true if captionsTurnOff visible, false if captionsTurnOn visible, null otherwise
  captionRegion,             // boolean
  participantTiles,          // count of [data-participant-id] whose text doesn't include 'Backgrounds and effects'
  selfName,                  // boolean
  participantCount,          // number|null: [data-avatar-count] attr, else People button aria-label /(\d+)/, else null
  bodyEmpty,                 // innerText.trim().length < 5
}
```
(`SEL.captionLangItem` is a function → `snapshot.js` receives a serializable copy without it.)

### 5.7 meet/state.js (pure)
```js
export function classify(snap) → { state, matched }   // matched = text/selector that decided it
```
Decision order (first match wins):
1. `url` host `accounts.google.com` → `SIGNIN_REQUIRED`
2. host is not the meeting host (`workspace.google.com`, or `meet.google.com/` landing w/o code) → `BLOCKED`
3. `TEXT.notFound` → `NOT_FOUND`
4. `TEXT.denied` → `DENIED`
5. `TEXT.lobbyTimeout` → `LOBBY_TIMEOUT`
6. `TEXT.blocked` → `BLOCKED`
7. `TEXT.ended` → `ENDED`
8. `TEXT.reconnecting` → `RECONNECTING`
9. `TEXT.lobby` → `LOBBY`
10. `ctaTexts.length > 0` or `nameInputVisible` → `PREJOIN`
11. (`captionsOn !== null` or `participantTiles > 0` or `selfName` or `captionRegion`) and `leaveButton` → `IN_CALL`
12. `bodyEmpty` → `BLANK`
13. else `UNKNOWN`
Note: `leaveButton` alone is NOT enough for IN_CALL (it also exists in the lobby).
The host check in (2) must accept the configured meeting origin (tests use a mock host):
`classify(snap, { meetingOrigin })`.

### 5.8 meet/join.js
```js
export class JoinError extends Error { constructor(code, message) }  // code ∈ status error codes
export async function joinMeeting(page, { url, displayName, lobbyTimeoutMs, pollMs, onState, log, screenshot, meetingOrigin })
  → { admittedAfterMs }
```
Flow:
1. `page.goto(url, { waitUntil: 'domcontentloaded' })`.
2. PREJOIN loop (≤ 90 s): snapshot+classify each `pollMs`;
   - click a visible button whose text matches `TEXT.continueWithoutDevices`;
   - click visible `TEXT.dismiss` buttons;
   - if name input visible and empty → click it, type `displayName` with 30–80 ms per-key delay;
   - for each visible `SEL.micOff` / `SEL.camOff` → click (so mic/cam end up off);
   - click the first visible CTA in `TEXT.joinCtas` order via Playwright locator click
     (hover, 150–400 ms pause, click — never `element.click()` in page JS);
   - state SIGNIN_REQUIRED/NOT_FOUND → throw; BLOCKED/BLANK(>10 s) → re-navigate, at most 3
     attempts total with 20 s/40 s backoff, then throw `blocked`.
3. After the CTA click: wait loop up to `lobbyTimeoutMs`; `onState('waiting_admission')` while
   LOBBY; DENIED → throw `denied`; LOBBY_TIMEOUT → throw `lobby_timeout`; BLOCKED → retry as in 2.
4. IN_CALL must be observed on **3 consecutive polls** → return.
5. Take a screenshot (via `screenshot(name)`) on every throw and on UNKNOWN lasting > 15 s.

### 5.9 meet/incall.js
```js
export async function prepareInCall(page, { captionLang, log }) → { captionsOn, captionLang }   // captionLang: code or 'unknown'
export async function dismissModals(page) → number   // clicks visible TEXT.dismiss buttons + consent "Join now" in [role=alertdialog]
export async function ensureCaptions(page, { log }) → boolean
export async function setCaptionLanguage(page, code, { log }) → boolean
export async function leaveCall(page) → void          // click SEL.leave if visible; ignore errors
```
- `ensureCaptions`: if `captionsTurnOff` visible → true. Else click `captionsTurnOn`; if not
  found, press `c` (Playwright keyboard → trusted). Verify `captionRegion` or `captionsTurnOff`
  within 5 s; retry once.
- `setCaptionLanguage`: More options → menu item "Settings" → `captionsSettingsTab` →
  `li[data-value=code]` clicked through `page.evaluate(el => el.click())` (works while the
  dropdown is hidden) → close dialog. Return true if the li existed. Failure is non-fatal (log
  warning, status `captionLang: 'unknown'`).

### 5.10 page/caption-observer.js (browser-side)
```js
export function installCaptionObserver(SEL_SERIALIZABLE) → void
```
- Idempotent (`window.__omCaptionObserver`). Finds region via `SEL.captionRegion` (first hit).
- MutationObserver `{childList, subtree, characterData}`; throttle 200 ms; on fire collect
  blocks = region children that have text: `id` = `el.dataset.omId` (assign incrementing int
  on first sight), `speaker` = `SEL.captionSpeaker` text || first child's text if < 60 chars ||
  '', `text` = `SEL.captionText` text || textContent minus speaker. Skip blocks with empty text
  and the region's control buttons. Calls `window.__omCaptions({ ts: Date.now(), blocks })`.
- Every 2 s: if region missing/disconnected → re-find + re-attach; report
  `window.__omCaptions({ ts, blocks: null, region: false })` when not found.

### 5.11 captions/assembler.js (pure)
```js
export class CaptionAssembler {
  constructor({ finalizeMs = 4000, goneSettleMs = 1500, rematchMs = 10000 } = {})
  update(blocks, now) → Utterance[]   // newly finalized
  tick(now) → Utterance[]
  flush(now) → Utterance[]
}
// Utterance = { speaker, text, startMs, endMs }
export function joinText(a, b) → string  // concatenation with ' ' only between two non-CJK chars
export function mergeVisible(acc, last, next) → acc'   // the rolling/revision algorithm below
```
Per block id keep `{ speaker, acc, last, startMs, lastChangeMs, goneSinceMs }`.
`mergeVisible(acc, last, next)`:
1. `next === last` → acc.
2. `last === ''` → acc + next (joinText).
3. common prefix `cp(last,next) ≥ min(8, 0.5·min(len))` → revision/extension in place:
   `acc.slice(0, acc.length - last.length) + next`.
4. rolled window: largest `k ≥ 6` (≤ 400) with `last.endsWith(next.slice(0,k))` → `acc + next.slice(k)`.
5. `j = last.indexOf(next.slice(0, 12))`, `j ≥ 0` → `acc.slice(0, acc.length - last.length) + last.slice(0, j) + next`.
6. else → `joinText(acc, next)`.
Finalization: a block is finalized when (a) it is absent from snapshots for ≥ `goneSettleMs`,
or (b) unchanged for ≥ `finalizeMs` **and** a newer block exists, or (c) `flush()`.
Re-match: a newly appearing block whose speaker equals a block seen in the last `rematchMs`
and whose text starts with the tail (last 12 chars) of that block's `last`, or equals a prefix
of it, is treated as the same block (Meet re-renders rows). Finalized utterances with empty
text are dropped; consecutive exact duplicates (same speaker+text within 10 s) are dropped.
`update(null, now)` (region missing) behaves like an empty snapshot.

### 5.12 transcript/store.js
```js
export class TranscriptStore {
  constructor(dir, { code, startedAt })
  append(utterance)            // appends JSON line to transcript.jsonl:
                               // { t0: ISO, t1: ISO, speaker, text, source: 'captions' }
  get count(); get speakers()  // unique speakers, first-seen order
  renderMarkdown({ endedAt, captionLang, extraNote }) → string   // and writes transcript.md
}
export function renderTranscriptMd({ code, startedAt, endedAt, utterances, captionLang, extraNote }) → string
```
transcript.md format (Traditional Chinese labels):
```
# 會議逐字稿 — abc-defg-hij

- 時間：2026-10-04 22:15 – 23:02（47 分鐘）
- 發言者：王小明、Arthur
- 來源：Google Meet 即時字幕（cmn-Hant-TW）

**[22:15:30] 王小明：** 大家好，今天討論…

**[22:16:02] Arthur：** 好的…
```
Consecutive utterances by the same speaker less than 30 s apart are merged into one paragraph
(first timestamp, texts joined with joinText). Empty transcript renders the header plus
`（沒有擷取到任何字幕）`. Times shown in local time `HH:mm:ss`.

### 5.13 page/audio-capture.js (browser-side) + audio/wav-writer.js
Browser: `installAudioCapture({ sampleRate: 16000, flushMs: 1000 })`, idempotent.
- Scan every 3 s for `audio, video` elements with `srcObject instanceof MediaStream` having
  live audio tracks; dedupe by track id; connect each via `createMediaStreamSource` into one
  shared `AudioContext({ sampleRate })` → mixer gain → AudioWorkletNode (module from a Blob
  URL; fallback ScriptProcessorNode 4096 if `addModule` fails) → mono Float32 →
  Int16LE. Do NOT connect to `ctx.destination` (keeps it silent; use a zero-gain sink if a
  processor needs to be pulled).
- Every `flushMs`: if samples buffered → `window.__omAudio(base64)`; also
  `window.__omAudioStatus({ tracks, contextState })` every 5 s. Call `ctx.resume()` on start.
- Also export `installTrackMirror()` for `context.addInitScript`: wraps `RTCPeerConnection`
  so every remote audio `track` event is mirrored into a hidden `<audio autoplay muted=false>`
  element with `srcObject = new MediaStream([track])` (so captures work if Meet renders no
  audio elements). Must not break Meet: wrap via addEventListener on construction, never
  replace methods' behaviour.
Node:
```js
export class WavWriter {
  constructor(path, { sampleRate = 16000, channels = 1 } = {})
  write(int16leBuffer)        // appends, tracks samples
  get seconds()
  get peak()                  // max |sample| seen (0..32767)
  async close()               // patch RIFF/data sizes, close fd
}
```
Header patched every 30 s while writing so a crash leaves a playable file.

### 5.14 session.js
```js
export async function runSession(opts) → finalStatus
// opts: { url, code, id, dir, displayName, captionLang, config, log, foreground }
```
1. `writeStatus` starting → launching; `launchChrome` + `connectChrome`.
2. Before navigation: `context.addInitScript(installTrackMirror)`; `page.exposeFunction`
   `__omCaptions`, `__omAudio`, `__omAudioStatus`; deny mic/cam for the meeting origin via
   browser CDP session `Browser.setPermission` (`audioCapture`, `videoCapture` → `denied`).
3. `joinMeeting` (state joining → waiting_admission → in_call, `joinedAt`).
4. `prepareInCall`; `page.evaluate(installCaptionObserver, SEL)`; `page.evaluate(installAudioCapture)`.
5. Main loop every `pollMs`: snapshot+classify; `assembler.tick`; append finalized utterances;
   update `stats` in status at most every 5 s; every 30 s re-run `dismissModals` and, if
   captions turned off, `ensureCaptions`; re-install observer if the page reloaded.
   End when: classify ENDED (`meeting_ended`, or `removed` if text contains "removed");
   page/browser closed (`page_closed`); participantCount == 1 for `aloneTimeoutMs` after a
   count ≥ 2 was seen (`alone`); no count ≥ 2 ever within `noOneTimeoutMs` (`no_one_joined`);
   `maxDurationMs` (`max_duration`); file `<dir>/STOP` exists (`user_stop`); SIGINT/SIGTERM
   (`signal`). RECONNECTING is tolerated for up to 60 s before counting as ended.
   `participantCount === null` never counts as alone.
6. Finalize (state leaving): `assembler.flush`, `leaveCall`, close WAV, `chrome.close()`,
   `store.renderMarkdown`. If 0 utterances and `audioSeconds ≥ 20` and the STT venv exists →
   state transcribing, run `stt/transcribe.py`, note in transcript.md. Final state `done`
   (even with 0 utterances) with `endedAt`, `endReason`, stats.
7. Any JoinError → state `failed`, `error: { code, message }`; unexpected exception →
   `failed`/`crashed`. Chrome is always closed in `finally`.

### 5.15 CLI (`openmeeting <cmd>`)
| Command | Behaviour | Exit |
|---|---|---|
| `join <url> [--name N] [--lang code] [--foreground]` | validate URL; create dir; write status starting; spawn `node src/worker.js --dir <dir> ...` detached (`windowsHide: true`, stdio → `<dir>/worker.out`), `unref()`; print `MEETING_ID=<id>` and `MEETING_DIR=<dir>` lines + a zh-TW hint. `--foreground` runs the session in-process. | 0 ok, 1 bad url |
| `wait <id\|latest> [--timeout-min N]` | poll status every 2 s; print one line per state change (`STATE=<state>` + zh-TW text); when terminal print `RESULT=done\|failed`, `TRANSCRIPT=<path>`, `UTTERANCES=<n>`, `ERROR=<code>`. If the worker pid died without a terminal state → mark failed/crashed. | 0 done with ≥1 utterance; 2 done but empty; 3 failed; 4 timeout |
| `status [id\|latest]` | print status JSON | 0 / 1 not found |
| `list` | newest first: id, state, utterances | 0 |
| `leave [id\|latest]` | create STOP file; wait ≤ 30 s for terminal state | 0 |
| `transcript [id\|latest]` | print transcript.md (render from jsonl if md missing) | 0 / 1 |
| `login` | launch Chrome with the bot profile at `https://accounts.google.com/` (no CDP automation of the page), print instructions, wait until the window is closed | 0 |
| `doctor` | check Chrome path, profile dir, signed-in hint, node version, STT venv; print a table | 0 / 1 |
| `setup-stt` | `uv venv <home>/.venv-stt --python 3.12` + `uv pip install -r stt/requirements.txt` | 0 / 1 |
| `transcribe <id\|latest> [--model M]` | run the Whisper fallback on audio.wav | 0 / 1 |

### 5.16 Whisper fallback (stt/transcribe.py)
`python transcribe.py --audio <wav> --out-dir <dir> [--model large-v3-turbo] [--threads 14] [--lang zh]`
→ `transcript-whisper.json` (segments `{start,end,text}`) + `transcript-whisper.md`.
faster-whisper `WhisperModel(model, device='cpu', compute_type='int8', cpu_threads=threads)`,
`transcribe(audio, language='zh', vad_filter=True, condition_on_previous_text=False,
beam_size=5, initial_prompt='以下是台灣會議的逐字稿，使用繁體中文，專有名詞保留English。')`,
every segment → `opencc.OpenCC('s2twp').convert`. Prints `SEGMENTS=<n>` on success.
requirements.txt: `faster-whisper==1.2.1`, `av<19`, `opencc`.

### 5.17 Plugin
- `.claude-plugin/marketplace.json` (repo root): marketplace `openmeeting-local`, one plugin
  `openmeeting` with `source: "./plugin"`.
- `plugin/.claude-plugin/plugin.json`: `{ name: 'openmeeting', version: '0.1.0', description }`.
- `plugin/skills/meet/SKILL.md` (rendered from `.tmpl` with `{{CLI}}` = `node "<abs repo>/bin/openmeeting.js"`):
  frontmatter `name: meet`, `description` (triggers on Google Meet links / 參加會議 / 會議記錄),
  `argument-hint: <google-meet-link>`, `allowed-tools: Bash(node:*)`.
  Body (zh-TW): (1) run `{{CLI}} join "$ARGUMENTS"`; (2) tell the user the bot name and that
  they may need to admit it (possibly ⋮ → Admit in the "potential risk" prompt); (3) run
  `{{CLI}} wait <id>` with `run_in_background: true` and timeout 7200000; (4) on re-invocation:
  exit 0 → read transcript.md, write `summary.md` (重點、決議、待辦/負責人) next to it, show
  stats + summary + file paths; exit 2 → explain no captions were captured, suggest
  `transcribe`; exit 3 → map `ERROR=` code to a zh-TW remedy table; exit 4 or killed at the
  2 h tool limit while still in_call → run `wait` again. Also: "離開會議" → `leave latest`;
  "現在講到哪" → `transcript latest`.
- `scripts/install-plugin.js`: render SKILL.md, then run
  `claude plugin marketplace add <repo>` and `claude plugin install openmeeting@openmeeting-local`
  (idempotent; print what it did). `claude plugin validate` must pass for both.

## 6. Error handling summary
| Situation | Detection | Result |
|---|---|---|
| Not a Meet link | url.js | CLI exit 1, zh-TW message |
| Chrome missing | chrome.js | failed / chrome_not_found |
| Profile signed out mid-flow / sign-in wall | classify SIGNIN_REQUIRED | failed / signin_required → "請執行 openmeeting login" |
| Bot blocked by Google | classify BLOCKED/BLANK after 3 tries | failed / blocked |
| Host denies / nobody admits | DENIED / LOBBY_TIMEOUT | failed / denied, lobby_timeout |
| Captions never appear | no caption events 90 s after IN_CALL | warn in bot.log, retry ensureCaptions; audio still recorded; Whisper fallback at end |
| Meet DOM changed | UNKNOWN > 15 s | screenshot into screens/, keep polling |
| Worker crash | wait sees dead pid | failed / crashed |

## 7. Testing strategy
1. **Unit** (`node --test test/unit`): url, config, status (incl. latest/atomic write),
   state classifier (fixtures for every state incl. lobby-with-leave-button), assembler
   (revision, rolling window, re-render rematch, speaker change, CJK join, flush, duplicates),
   transcript render (merge rules, empty), wav writer (header bytes, sizes, crash-safe patch),
   chrome args (forbidden flags absent), CLI arg parsing and exit codes (with a fake status dir).
2. **Mock Meet integration** (`node --test test/integration`, real Chrome, headless allowed
   via `OPENMEETING_HEADLESS=1` — the mock is local so no bot detection):
   `test/mock-meet/server.js` serves `/<code>?scenario=...` reproducing Meet's English DOM:
   prejoin (name input, mic/cam toggles with aria-labels, "Ask to join"), optional
   "Continue without microphone and camera" dialog, lobby text, in-call (Leave call,
   Turn on captions → caption region `[role=region][aria-label=Captions]` with
   `.nMcdL > (.NWpY1d, .ygicle)` blocks driven by a scripted caption timeline including
   revisions, a rolling long monologue and a speaker change), More options → Settings →
   Captions → `li[data-value="cmn-Hant-TW"]`, a remote `<audio>` element whose `srcObject` is
   a MediaStream of a tone or WAV (via WebAudio `createMediaStreamDestination`),
   `[data-avatar-count]`, and end screens. Scenarios: `happy`, `denied`, `blocked`,
   `lobby_timeout`, `removed`, `alone`, `signin`, `notfound`, `continue_dialog`.
   Assertions: final status/endReason/error per scenario; transcript.jsonl equals the expected
   utterances for `happy`; audio.wav has ≥ 3 s with peak > 1000 **while `--mute-audio` is on**;
   `wait` exit codes; `leave` produces `user_stop`.
3. **STT**: `scripts/make-tts-wav.ps1` makes a zh-TW sentence WAV (Microsoft Hanhan); run
   `transcribe` on it; expect key Traditional characters present.
4. **Plugin**: `claude plugin validate plugin` and `claude plugin validate .` pass; SKILL.md
   rendered path exists.
5. **Live E2E (needs the user, ~3 min)**: user hosts a real Meet, runs `/openmeeting:meet <link>`,
   admits the bot, speaks Mandarin ~1 min, ends the meeting → expect status done, captions in
   Traditional Chinese with the user's name, summary shown.

## 8. Things only the user can do
- (Optional, recommended) create a dedicated free Gmail for the bot and sign in once via
  `openmeeting login` — the assistant never creates accounts or types passwords.
- Admit the bot in each meeting (Google's 2026 risk queue may require ⋮ → Admit).
- Tell participants the meeting is being transcribed.
