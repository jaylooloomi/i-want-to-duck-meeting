# Meeting capture and Agent architecture

## Meaning of “no extra tokens”

Duck Meeting does not independently call a paid language-model API to produce meeting notes. In the standard subscription-based workflow, the existing signed-in Codex or Claude Code Agent reads the meeting files and writes the results. There is no separate meeting-summary API key or model-credit purchase to configure.

This is not zero model usage: requests made by the Agent consume its account's applicable usage allowance. API-billed Agent configurations and optional connected paid services may incur their own charges. Capture uses platform captions and local audio/ASR, while translation uses an online Google endpoint without a configured key; that endpoint is a network dependency and is not a guaranteed unlimited service. The workflow is not fully offline.

## Operational flow

1. The user sends a Meet/Teams URL to an installed Agent skill/plugin, or starts a supported local recording from the workspace.
2. The Agent calls the local CLI. A background worker drives the dedicated meeting browser, waits for required sign-in/permission/admission and captures available platform captions/audio. Local audio modes use local ASR. Login/admission cannot be bypassed.
3. The local server renders the saved transcript, translation and recording controls. Translation requests go through `/api/translate` to `translate.googleapis.com`; source text is sent online. Captions/local ASR are sources, not guaranteed word-perfect output.
4. When recording finalization reaches done/failed, an Agent-owned meeting can enter `summaryJob.state=waiting_agent`. `/api/summarize` queues this handoff; it does not call a summary model.
5. The owning Agent must actually resume (user request or an available host follow-up mechanism). It reads the exact meeting's transcript/status and any relevant local transcription, checks evidence and writes `summary.md`, source-linked decisions/actions and local email draft content. A waiting job alone cannot wake a sleeping/closed Agent.
6. The Agent marks the notes ready; the workspace displays them. Sending mail or creating mailbox drafts requires explicit user instruction and connected mail tools. Local mail draft generation does not send email.

## Text architecture

```text
User + existing signed-in Agent account/subscription
  |
  v
Codex skill / Claude Code plugin
  | local commands
  v
CLI --> recording worker --> dedicated Chrome --> Meet / Teams
           |                       |
           | audio                 | platform captions
           v                       v
       local ASR --------> local meeting files
                                  |
                    +-------------+----------------+
                    |                              |
                    v                              v
             local web workspace          finished Agent-owned job
                    |                       waiting_agent
                    v                              |
          /api/translate                           | user request / host follow-up
                    |                              v
          online Google translation      same owning Agent resumes
                                                   |
                                          reads files + reasons
                                                   |
                                summary.md / evidence links / mail draft
                                                   |
                                                   v
                                            local web workspace
```

The Agent host communicates with its model service under that host's configuration. Duck Meeting's notes backend does not add a second model API call and does not use Ollama. A subscription is not a promise of unlimited requests or autonomous wake-up.

## Code anchors

- `src/agent-summary.js`: finished-state checks, owning-thread filtering, waiting_agent/generating/ready handoff and summary validation.
- `src/live-server.js`: `/api/translate` online boundary and `/api/summarize` handoff endpoint.
- `src/live/app.js`: source rendering, translation requests and text search.
- `codex/skills/openmeeting/SKILL.md`, `plugin/skills/meet/SKILL.md.tmpl`: Agent operation, evidence review, mail content and host-dependent resumption instructions.
