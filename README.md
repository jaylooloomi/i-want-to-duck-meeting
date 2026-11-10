<h1 align="center">Duck Meeting <img src="docs/images/duck-meeting-icon.svg" alt="Duck Meeting logo" width="36" height="36"></h1>

<p align="center"><strong>Record the meeting. Review the transcript. Let your Agent prepare the follow-up.</strong><br>
Duck Meeting captures Google Meet, Microsoft Teams, and in-person meetings in a local workspace. Use your existing Codex or Claude Code account to turn the transcript into decisions, tasks, and an editable email draft.</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/static/v1?label=license&amp;message=MIT&amp;color=3b82f6&amp;style=flat" alt="MIT license"></a> <a href="https://github.com/jaylooloomi/i-want-to-duck-meeting/releases/latest"><img src="https://img.shields.io/github/v/release/jaylooloomi/i-want-to-duck-meeting?style=flat&amp;color=8b87de" alt="Latest GitHub release"></a><br>
  <a href="#get-started"><img src="https://img.shields.io/static/v1?label=platform&amp;message=Windows%2010/11%20x64&amp;color=64748b&amp;style=flat" alt="Windows 10/11 x64"></a><br>
  <a href="docs/AGENT_ARCHITECTURE.md"><img src="https://img.shields.io/static/v1?label=Agent&amp;message=Codex%20%2B%20Claude%20Code&amp;color=487fa8&amp;style=flat" alt="Codex and Claude Code"></a><br>
  <a href="#what-you-can-do"><img src="https://img.shields.io/static/v1?label=UI&amp;message=%E7%B9%81%E4%B8%AD%20/%20EN%20/%20%E6%97%A5%E6%9C%AC%E8%AA%9E%20/%20%ED%95%9C%EA%B5%AD%EC%96%B4&amp;color=637e64&amp;style=flat" alt="Interface languages: 繁體中文, English, 日本語, 한국어"></a> <a href="https://github.com/jaylooloomi/i-want-to-duck-meeting/actions/workflows/windows-installer.yml"><img src="https://img.shields.io/static/v1?label=CI&amp;message=view%20runs&amp;color=64748b&amp;style=flat" alt="Windows installer workflow"></a>
</p>

<p align="center"><a href="https://github.com/jaylooloomi/i-want-to-duck-meeting/releases/latest">Download for Windows x64</a> · <a href="README.zh-TW.md">繁體中文</a></p>

<p align="center"><a href="#what-you-can-do"><img src="https://img.shields.io/static/v1?label=LOCAL%20CAPTURE&amp;message=AGENT%20NOTES&amp;labelColor=143e39&amp;color=087b68&amp;style=for-the-badge" alt="LOCAL CAPTURE · AGENT NOTES"></a></p>

<p align="center"><img src="docs/images/workspace-v0.3.8-en.png" width="900" alt="Duck Meeting workspace with transcript and meeting notes"><br>
<sub>Windows app screenshot · v0.3.8 · fictional meeting data</sub></p>

## What you can do

- **Capture and follow live.** Record audio, read live captions and translations, and star important moments. The dedicated Meet or Teams window can show recent captions and stop capture. Meet also supports pause and resume.
- **Review the evidence.** Search originals and translations, play audio from a transcript timestamp, and jump from a linked decision or task to the source. Compare platform captions with an existing audio transcript using `openmeeting crosscheck <ID>`, or use `openmeeting report <ID>` to draft a review and verify quotations.
- **Follow up.** Give your Agent a notes template, track tasks across meetings, and edit or copy a local email draft.

## Get started

1. Run the Windows installer and select the Codex skill or Claude Code plugin. Install Chrome and your chosen Agent separately. The Claude Code integration requires the `claude` CLI.
2. In a new Agent chat, enter `Record this meeting <URL>`. Sign in or wait for host admission when required. For an in-person meeting, start a microphone recording from Duck Meeting.
3. After the call, ask your Agent to summarize the meeting. Review the summary, decisions, tasks, and email draft in Duck Meeting.

[Installation and updates](docs/installation.md) · [Evidence review guide](docs/transcript-review.md)

## Where the data goes

| Step | Data |
| --- | --- |
| Capture | Recordings, captions, and transcripts are saved on your computer. |
| Live translation | When enabled, transcript text is sent to Google Translate. |
| Meeting notes | Your signed-in Agent processes meeting text using its existing account allowance. Duck Meeting requires no separate summary API key. |

[Agent workflow and architecture](docs/AGENT_ARCHITECTURE.md)

<details>
<summary>Close-up screenshots of the transcript and meeting notes</summary>

![Bilingual transcript with speaker names, timestamps and a highlighted excerpt](docs/images/transcript-v0.3.8-en.png)

<img src="docs/images/notes-v0.3.8-en.png" width="1035" alt="Meeting notes with summary, decisions, action items and source references">

</details>

## Releases and license

- **v0.3.9** fixes transcript flicker as translations arrive in batches. [Release notes](docs/releases/v0.3.9.md)
- **v0.3.8** adds meeting controls, transcript comparison, and quotation review. [Release notes](docs/releases/v0.3.8.md)

Created by Arthur Wang ([@jaylooloomi](https://github.com/jaylooloomi)). Feedback and contributions are welcome. [Open an issue](https://github.com/jaylooloomi/i-want-to-duck-meeting/issues) · [MIT license](LICENSE)
