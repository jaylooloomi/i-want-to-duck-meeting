<h1 align="center">i-want-to-duck-meeting 🎙️</h1>

<p align="center">
  <b>Focus on the meeting. Let AI keep the notes.</b><br>
  Paste a Google Meet or Microsoft Teams link to capture transcripts and audio.<br>
  Afterward, ask “summarize this meeting” to turn the record into decisions and action items.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/version-0.1.0-informational" alt="Version 0.1.0">
  <img src="https://img.shields.io/badge/platform-Windows%2010%2F11-lightgrey" alt="Windows 10/11">
  <img src="https://img.shields.io/badge/Node.js-22%2B-339933" alt="Node.js 22 or later">
  <img src="https://img.shields.io/badge/Claude%20Code-plugin-D97757" alt="Claude Code plugin">
  <img src="https://img.shields.io/badge/Codex-skill-black" alt="Codex skill">
  <a href="README.en.md"><img src="https://img.shields.io/badge/lang-English-brightgreen" alt="English"></a>
  <a href="README.md"><img src="https://img.shields.io/badge/lang-繁體中文-green" alt="繁體中文"></a>
</p>

<p align="center"><img src="docs/images/meeting-hero-en.png" alt="Left: a participant struggles to take notes during a meeting. Right: an orange octopus with a headset helps preserve audio, transcripts, and action items. Labels: Focus on the meeting; Let AI take notes." width="900"></p>
<p align="center"><sub>Illustrated use case, not a screenshot of the application.</sub></p>

## Core features

**One local Windows meeting recorder, with a Codex skill and a Claude Code plugin as its two AI entry points.**

| Feature | What it does |
|---|---|
| 🔗 **Start with a link** | Paste a Meet or Teams link into your AI conversation; the same local CLI starts the recording |
| 📝 **Transcripts and sources** | Meet preserves captions, speaker names, and timestamps; local ASR preserves text, audio lanes, and estimated speaker labels |
| 🎙️ **Saved audio** | Meet records received meeting audio; Teams saves the local microphone, playback audio, and an aligned mix separately |
| 🇹🇼 **Local Chinese ASR** | Microphone and Teams modes use Paraformer Chinese int8, Traditional Chinese conversion, and spoken digit formatting; Whisper provides whole-recording fallback transcription |
| 👀 **Live viewing** | A local web page displays transcripts, speakers, timestamps, and previous meetings, and can start in-person microphone recording |
| ✅ **Summaries and action items** | Ask Codex or Claude Code to read the actual transcript and extract highlights, decisions, owners, deadlines, and open questions |

Recording and local ASR do not require an additional cloud speech API key. **Summaries are processed by your chosen AI service**; the entire workflow is not necessarily offline.

## Autonomous Google Meet validation

An explicit test command, `node scripts/verify-meet-live.js --live --seconds 30`, creates a private test meeting, sends newly generated synthetic speech, and records it from a second muted page in the same signed-in browser context. It requires the existing Windows/Chrome and local Paraformer setup. [Commands and evidence limits](docs/live-google-validation.md).

The 2026-10-25 run captured 25.216 seconds of received audio; offline Paraformer matched the complete test sentence, Google Meet, and 1357. Google native captions contained errors, so the overall result is **partial**. A subsequent 120.064-second run contained at least one complete matching sentence in both native captions and decoded audio; other repetitions still contained errors. This verifies a synthetic same-account remote path, not two human participants or independent organizations. Captions and decoded recording are checked separately against the actual WAV hash. Test artifacts remain local and ignored by Git.

## Teams native captions first (live acceptance pending)

A Teams link starts a dedicated Chrome profile. The worker attempts to join, mute its microphone/camera, enable captions, and select Traditional Chinese. Sign-in, permissions or host admission may still require your action. Audio devices use saved settings or Windows defaults.

Native captions replace equivalent, nearby Paraformer results. Unmatched ASR remains so captions from only one participant cannot erase the other participant. Raw events remain in `transcript-native.jsonl` and `transcript-paraformer.jsonl`; differently worded results may both appear. Native times are reception times, and unknown speaker identities remain unknown.

Check `teamsBrowser.state`, `nativeCaptions` and `audioHealth` independently. `--no-open` skips the native browser and keeps audio/ASR only; omit it for normal use. Stop with `leave <ID>` to finalize audio and close the dedicated browser.

Controlled Chrome tests pass; real Teams acceptance is pending. Private platform event formats may change. Audio capture starting does not prove membership, successful captions, or recorded speech. See [implementation and acceptance notes](docs/teams-native-captions.md).

## Use cases

| Situation | Ask your AI | What you keep |
|---|---|---|
| 💻 **Google Meet project discussion** | “Join this meeting and record it” | Captions, speakers, timestamps, and meeting audio |
| 📱 **Teams call between a PC and a phone** | “Record this Teams meeting and verify both audio lanes afterward” | Separate local and remote recordings, transcripts, and a mix |
| 🪑 **In-person discussion** | “Open the local transcript page and record with the microphone” | Chinese transcripts, estimated speaker labels, and audio |
| 🔍 **Review during a meeting** | “Show the transcript so far” | Saved text and its sources |
| 📋 **After the meeting** | “Stop recording and summarize decisions and action items” | An AI-written `summary.md`, with the original transcript available for review |
| 🧪 **Verify the recording** | “Check that my test sentence and confirmation code were captured” | Content checks against the actual audio, rather than assuming a saved file means success |

## Install

Choose your AI tool and follow its three steps.

**Requirements:** Windows 10/11 · Git · Node.js 22 or later · Google Chrome · local Codex or Claude Code with access to this computer's files and processes. Claude integration also requires the `claude` CLI. Users of the private repository need read access first.

### OpenAI Codex

**1. Copy this into local Codex**

```text
Install the i-want-to-duck-meeting Codex skill for me:
1. Download https://github.com/jaylooloomi/i-want-to-duck-meeting, or reuse an existing checkout.
2. Run npm install in the project directory.
3. Run npm run setup -- --target codex.
4. Verify installation and report the skill location. Keep credentials and meeting data out of Git.
```

**2. Start a new local Codex conversation**

Let the new conversation load the installed skill. Restart Codex if it does not appear. The skill needs access to the Windows computer where it is installed; a cloud-only chat cannot directly use this computer's recording devices.

**3. Paste your actual meeting link**

```text
<Your Google Meet or Teams meeting link>
Record this meeting. Tell me when I need to sign in or grant permission.
```

To select the skill explicitly, use `$openmeeting` followed by the meeting link.

### Claude Code

**1. Copy this into Claude Code**

```text
Install the i-want-to-duck-meeting Claude Code plugin for me:
1. Download https://github.com/jaylooloomi/i-want-to-duck-meeting, or reuse an existing checkout.
2. Run npm install in the project directory.
3. Run npm run setup -- --target claude.
4. Verify that openmeeting@openmeeting-local is enabled and report completion.
```

**2. Reload the plugin**

Run `/reload-plugins` in Claude Code, or restart Claude Code.

**3. Paste your meeting link and ask to record**

You can also invoke the command explicitly:

```text
/openmeeting:meet <Your Google Meet or Teams meeting link>
```

> The project is displayed as **i-want-to-duck-meeting**. The CLI, Codex skill, and Claude plugin retain the identifier `openmeeting` for compatibility with existing installations.

<details>
<summary><b>Manual installation, both agents, updates, and removal</b></summary>

Run in PowerShell:

```powershell
git clone https://github.com/jaylooloomi/i-want-to-duck-meeting.git
cd i-want-to-duck-meeting
npm install
npm run setup -- --target codex
# Claude only: npm run setup -- --target claude
# Both agents, requiring the claude CLI: npm run setup
```

The installer prepares uv, Python 3.12, audio packages, Paraformer, VAD, and speaker models. Initial downloads need a network connection. uv is installed under the data root's `tools/` directory without changing the global PATH. `npm install` installs dependencies; `setup` configures the AI integrations.

```powershell
# Preview the installation plan
npm run setup -- --dry-run
# Install the integration now; Teams prepares audio on first use
npm run setup -- --target codex --skip-audio
# After updating, or moving the project or Node, repeat your installation target
npm run setup -- --target codex
# Remove the Claude integration
claude plugin uninstall openmeeting@openmeeting-local
claude plugin marketplace remove openmeeting-local
```

Codex installs under `$CODEX_HOME/skills/openmeeting`, or `~/.codex/skills/openmeeting` when `CODEX_HOME` is unset. Use `--skills-dir` to select a skill parent directory. To uninstall, remove the installed skill directory. The skill points to this checkout, so keep the project directory in place.

See the [installation guide](docs/installation.md) for custom paths, migration, and the scope of `--force`. Detailed linked guides are currently in Traditional Chinese.

</details>

## Everyday use

### Google Meet: a silent recording account

1. On first use, let the AI open a dedicated Chrome sign-in window. Sign in to the recording account yourself, then close that entire dedicated window.
2. Join with your normal account, paste the link into the AI conversation, and ask it to join and record.
3. The host admits the recording account. The AI confirms it has joined before reporting that recording is active.
4. When finished, say “leave the meeting and summarize it.”

The recording account keeps its microphone and camera off. Receiving audio does not require enabling its microphone. A signed-in account normally displays its Google account name; `--name` does not guarantee an override. Let participants know the meeting is being recorded.

### Teams: native captions and two audio lanes

1. Paste the **full invitation link for the current meeting**, preserving parameters such as `?p=`.
2. The program opens a dedicated Teams Chrome and attempts joining and caption setup. Complete sign-in, permissions or host admission only when needed.
3. The program prepares the environment and starts background recording with previously confirmed devices or Windows defaults.
4. On first use or after changing devices, have both sides speak and verify the content of each lane. Confirmed device settings can be saved for subsequent use.
5. Say “stop recording and summarize this meeting” when finished.

**The dedicated Teams page is an additional participant; sign-in and host admission cannot be guaranteed automatically.** Native text comes from that page; audio still comes from this computer's microphone and playback device. With `--no-open`, an existing computer-side client must receive meeting audio.

The playback lane includes other applications using that output device, so music can enter the recording. The program does not read private Teams device settings, and Windows defaults may differ from Teams selections. See [automatic audio setup](docs/automatic-audio.md).

### In-person meetings and live transcripts

```powershell
node bin/openmeeting.js live
```

Open the printed `LIVE_URL`, normally `http://127.0.0.1:8791`. View an existing recording or select a microphone to record an in-person discussion.

Microphone and Teams ASR run Paraformer Chinese int8 on the CPU. The segmenter tolerates approximately 1.2 seconds of silence and submits continuous speech after about 15 seconds, preserving context across brief pauses and language switches. Display latency still depends on CPU speed and utterance length.

Meet captions retain the names supplied by the meeting. Local ASR labels A/B are estimates within the current session, not identities. In Teams, the local microphone is always A; remote voices are conservatively clustered and uncertain regions remain unidentified. Multiple people sharing the local microphone all appear as A. Overlapping remote voices can still be misidentified.

See [live transcription](docs/live-transcription.md) for operation, segmentation, clustering, and saved-audio replay.

## After the meeting

<p align="center"><img src="docs/images/meeting-review-en.png" alt="A participant and a headset-wearing octopus review four panels labeled Transcript, Recording, Summary, and Action items. Headline: Meeting over. Key points kept." width="900"></p>
<p align="center"><sub>Illustrated outcome, not an application screenshot. The conversational AI produces summaries from the transcript.</sub></p>

Return to your AI conversation and say:

```text
Stop recording and summarize this meeting:
- Highlights and decisions
- Action items, owners, and deadlines
- Open questions
Include transcript and audio locations. Do not guess uncertain details.
```

The CLI records, stops, and saves files. Codex or Claude Code reads the transcript to produce a summary; **the CLI does not generate one automatically**. If the host cannot deliver background completion notifications, return to the original conversation after the meeting and ask for the summary.

Each recording is saved locally under `meetings/<meeting-ID>/`:

| File | Purpose |
|---|---|
| `transcript.md`, `transcript.jsonl` | Readable and structured transcripts with timestamps, speakers, and sources |
| `audio.wav` | Meet or in-person recording, or the aligned Teams mix |
| `audio-microphone.wav`, `audio-system.wav` | Separate Teams local microphone and playback recordings |
| `status.json`, `live.json` | Recording state, signal information, and live text |
| `transcript-whisper.*` | Output from Whisper fallback transcription |
| `summary.md` | AI-written summary, decisions, and action items |

Background recording does not require keeping the chat or transcript page open. **Closing Teams does not stop the recording.** Explicitly request a stop; the default maximum duration is four hours.

## Verify captions and audio

An audio file existing does not mean it captured your voice.

```powershell
node bin/openmeeting.js status <meeting-ID>
node bin/openmeeting.js transcript <meeting-ID>
node bin/openmeeting.js transcribe <meeting-ID>
```

- `audioPeak > 0` proves only a nonzero signal. A growing duration, `signal_only`, or `state=done` does not establish that a particular utterance was recorded.
- Transcribe or play the actual recording and compare the complete sentence, names, numbers, and sources. Verify Teams lanes separately.
- `transcribe` uses whole-recording Whisper fallback and requires the `setup-stt` environment. Automatic fallback when captions are empty is attempted only if that environment is available. It does not identify Meet participants by name.

## Validation and scope

| Area | Verified evidence | Limits |
|---|---|---|
| Google Meet | Real participants' captions, speakers, and recorded speech checked | Organization policies and website changes may affect admission and capture |
| Teams dual audio | PC and phone utterances checked in separate recordings | Does not establish accuracy for every device, room echo, or overlapping voice |
| Paraformer Chinese/English mixing | A new phone recording replayed through the corrected live pipeline matched the complete sentence, Microsoft Teams, and 1357 | Saved-audio replay validation; earlier noisy recordings still contain errors |
| Music interference | A temporary local helper monitored and paused specific music during the live test | No general automatic music-isolation feature is installed |
| Codex / Claude Code | Local Windows skill/plugin sharing one CLI | Full capture on macOS, Linux, or cloud-only chat is not supported |

Evidence: [Meet live test](docs/2026-10-24-live-meet-recording.md) · [Teams audio validation](docs/teams-audio-validation.md) · [Live ASR and replay](docs/live-transcription.md) · [Earlier two-speaker validation](docs/local-microphone-validation.md).

## Why build this?

The easiest things to miss in a meeting are often a decision, a number, or an action item nobody wrote down.

This tool connects audio, transcripts, and follow-up in the same AI conversation. Keeping the original recordings and transcripts gives summaries a source and lets you check uncertain details.

## How it works

```text
Codex skill / Claude Code plugin
                  |
         Local openmeeting CLI
                  |
  Google Meet                  Teams / in-person
  Dedicated Chrome             Windows playback / microphone
  Captions + received audio    VAD -> Paraformer -> speaker labels
                  |
  Local meetings/<ID>/: transcripts + WAV + state
                  |
  Conversational AI: read transcript on request -> summary + tasks
```

Meet captures received WebAudio by default; the recording account stays silent. Teams uses WASAPI loopback plus microphone capture. The local web server listens only on `127.0.0.1`; it is not a remote sharing service.

<details>
<summary><b>CLI, environment variables, and advanced settings</b></summary>

```powershell
node bin/openmeeting.js doctor
node bin/openmeeting.js login
node bin/openmeeting.js join "<actual meeting link>"
node bin/openmeeting.js list
node bin/openmeeting.js status <meeting-ID>
node bin/openmeeting.js leave <meeting-ID>
```

Use an explicit ID so `latest` cannot select a different recording. The Meet bot records one meeting at a time; the local web page can own one local capture job at a time.

| Setting | Purpose |
|---|---|
| `OPENMEETING_HOME` | Data root containing recordings, device settings, and models |
| `CHROME_PATH`, `OPENMEETING_PROFILE` | Chrome executable and dedicated recording profile |
| `OPENMEETING_CAPTION_LANG` | Meet caption language, default `cmn-Hant-TW` |
| `OPENMEETING_NAME` | Guest name; does not guarantee overriding a Google account name |
| `OPENMEETING_MUTE=0` | Play received Meet audio through the speakers |
| `audio-settings.json` | Device names, channels, and sample rates saved by `audio-confirm <ID>` after confirmation |

See the [CLI reference](docs/cli.md) for parameters, stopping behavior, and errors.

</details>

## Data and privacy

Recordings, transcripts, and local ASR output stay on your Windows computer. Initial package and model downloads need a network connection; Paraformer loads local models at runtime. When you request a summary, transcript content may be processed by your selected AI service according to its settings and policies.

Inform participants before recording. Do not commit `meetings/`, `chrome-profile/`, personal audio settings, or credentials; Git ignore rules cover these locations. Speaker features stay in process memory rather than a persistent voiceprint database, but the recordings themselves still need appropriate care.

This project is not an official Google or Microsoft service.

## Local viewer readiness and QA

The viewer clears old transcripts, counts, and Meet links when no meetings remain. Unknown meeting IDs fall back to `latest` with a synchronized URL; selecting or starting a meeting preserves other query parameters, including `source=teams`. Teams capture stays disabled while devices load or either required device is unavailable. Connect devices and use **更新裝置** to retry; stale responses after switching modes are ignored. Starting still requires browser microphone permission when applicable.

Run `node test/qa/run.mjs` for two complete offline regression rounds. See [test matrix](TEST_MATRIX.md), [quality report](TEST_SUMMARY.md), and [defects and acceptance limits](BUG_REPORT.md). This verifies local behavior and synthetic fixtures, not live meeting accuracy. Sixteen HTTP/network fault-injection cases remain acceptance-limited because Chromium itself emits resource console errors under the strict zero-console rule; they are not counted as passes.

## Development and tests

```powershell
npm test
npm run test:integration
npm run test:all
.venv-stt/Scripts/python.exe -m unittest discover -s stt -p 'test_*.py'
```

Tests requiring private audio, public fixtures, or physical devices are opt-in and skipped without those inputs. A skip is not a pass. Integration tests using local simulated meeting pages do not establish that a real meeting was joined.

Current offline QA totals, coverage, skipped cases, and acceptance limits are recorded in [TEST_SUMMARY.md](TEST_SUMMARY.md). Historical live/replay results above have a different scope.

Application code is in `src/`, audio tools in `stt/`, the Codex skill in `codex/skills/openmeeting/`, and the Claude plugin in `plugin/`. The unified installer is `scripts/install.js`.

## Credits and license

README structure and octopus illustration direction were inspired by [i-want-to-sleep](https://github.com/jaylooloomi/i-want-to-sleep). The two new illustrations were generated with built-in imagegen; see [prompts and sources](docs/readme-assets.md). Paraformer model selection was informed by [SpeakSlow](https://github.com/Jeffrey0117/SpeakSlow).

Code is licensed under [MIT](LICENSE). Third-party packages and models retain their respective licenses.
