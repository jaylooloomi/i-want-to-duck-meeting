# Windows window video recording

Source implementation on `codex/meeting-video`. This document does not imply that an existing installed package or GitHub Release has been upgraded.

## Usage

1. Start the meeting with Duck Meeting as usual; existing audio and captions remain independent.
2. Open the meeting's **… → 會議影片／錄影** menu.
3. If needed, select **安裝錄影元件**. This explicitly downloads/verifies the pinned LGPL FFmpeg runtime. A working app Python environment is also required; no additional Python packages are used.
4. Click **選擇錄影視窗**, select the meeting window, then **開始錄影**. Inform participants before recording. Selecting a window alone never starts capture.
5. Click **停止錄影**, or let the meeting reach done/failed/archived; an active capture checks meeting completion approximately every second and stops. Closing the recording dialog does not stop capture.
6. After meeting completion, available mixed `audio.wav` is aligned and merged into `meeting-video.webm`. When no valid mixed recording exists, the video remains explicitly marked as lacking embedded audio. Verify actual content; an audio stream is not proof that every participant was recorded.
7. Open the video player. With **點逐字稿時間時定位影片** enabled, close the dialog and click a transcript timestamp to reopen at its video position. This locates the video without forcing playback. Playing video pauses the existing audio player to prevent duplicate sound.
8. Download video independently. The general meeting ZIP deliberately excludes the `video/` directory to avoid large-video ZIP compatibility/size problems. It still includes the timeline manifest; original segmented files remain local for recovery.

## Architecture and data

`src/video-recording.js` owns recording state, cross-server lock, bounded encoder arguments, segment timelines, disk checks and finalization. `scripts/video-worker.py` launches the encoder suspended, assigns it to a Windows kill-on-close Job Object, then resumes. Owner death/EOF triggers graceful stop; a stuck encoder is killed after 15 seconds. It never invokes a shell for encoder arguments.

`src/live/video.js` provides optional controls and player; the meeting worker's audio/caption logic is not replaced. This is local recording/encoding, with no LLM or cloud recording API and no additional AI token cost.

Per meeting:

- `video.json`: state, selected window, owner PID, start/stop, estimated meeting offset and segment intervals.
- `video/part-00000.webm`, …: recoverable silent video segments.
- `video/segments.csv`: FFmpeg media timestamps.
- `video/concat.txt`: validated relative segment names for final muxing.
- `video/meeting-video.webm`: optional consolidated video with the available mixed audio.

States: idle → starting → recording → stopping → finalizing → ready/failed. Starting is serialized before asynchronous window enumeration. A separate lock prevents two local server processes from starting captures against the same data home. Old dead-owner status becomes interrupted/failed; it is not silently resumed.

HTTP endpoints are local-only under the existing Host/Origin checks. Mutation endpoints require same-origin JSON and exact meeting identity; arbitrary paths/encoder arguments and synthetic mode are not accepted from HTTP:

- GET `/api/video/windows`: explicit visible, non-minimized window enumeration.
- POST `/api/video/install` with `{}`: optional runtime installation.
- POST `/api/video` with `{id, action: "start", windowId}` or `{id, action: "stop"}`.
- GET `/api/video?id=…`: state/finalization status.
- GET `/api/video-file?id=…&file=…`: allowlisted files with byte ranges, no path traversal or symlinked video directory.

## Limits and acceptance

- Windows only, first version has no pause/resume and permits one recording job per meeting; stopped/failed jobs are preserved rather than overwritten by a restart. One capture per data home, up to four hours by default, two-minute segments, 15 fps and maximum 1280px width. There is no inherited two-minute/25MB whole-meeting cap.
- Capture is an explicitly selected HWND, not a fixed desktop rectangle. It is not an isolated browser-tab stream: changing tabs in that window changes the captured content. Resize, hardware acceleration, minimizing, covering the window, locking Windows or disconnecting a desktop session may cause missing/black frames or encoder errors. Do not promise uninterrupted hidden-window capture.
- Requires at least 512MB free to start; requests stop below 256MB. This is a safety floor, not a storage forecast; long recordings require more space. Copies/segments are retained and may consume substantial disk.
- First-frame/progress timing provides an estimated offset, not sample-accurate synchronization. Transcript timestamps already have reception delays. No claim of phoneme-level sync.
- A stopped live recording can expose completed segments; the consolidated mixed-audio video is finalized after the meeting. No automatic recording restart after failure; original data is preserved.
- Browser tests and native synthetic captures are not real Meet/Teams acceptance. A real meeting must verify both voices, readable screen sharing, window changes, final audio alignment and source jumps before treating recording as production-validated for that platform.

## Tests

```powershell
node --test test/unit/video-recording.test.js
node --test --test-concurrency=1 test/integration/video-native.test.js
node --test --test-concurrency=1 test/qa/video.test.js
```

Native tests use the optional installed FFmpeg runtime and repo Python environment. They explicitly report skipped when unavailable. They generate synthetic media; the HWND test creates its own solid-color GDI window, verifies known output pixels and closes it, never captures the desktop. The 125-second media-duration test is accelerated, not a 125-second real-time endurance test. The owner-crash test verifies that both guard and encoder exit. UI tests enforce the shared zero page/console error guard.

Upstream attribution/runtime details: [video recording notices](third-party/video-recording.md).
