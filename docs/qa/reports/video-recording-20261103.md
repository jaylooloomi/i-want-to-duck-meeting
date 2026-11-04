# Optional window video — implementation and evidence

Date: 2026-11-03 (Asia/Taipei). Branch: `codex/meeting-video`.

## Implemented

- Independent local FFmpeg HWND video service, two-minute segments and a four-hour default cap; no inherited 120-second/25MB whole-recording restriction.
- Same-origin, exact-meeting start/stop API; explicit source selection; no capture on startup or join; no arbitrary encoder arguments or synthetic mode over HTTP.
- Optional pinned/hash-checked FFmpeg component installation; existing before-you-do runtime can be reused. Standard-library-only Python guard; no new npm/Python package dependency.
- Windows Job Object containment, suspended encoder launch, parent-death/EOF stop, cross-server recording lock and stale-owner failure reporting.
- Low disk stop, retained segments, metadata/timeline, bounded error logs and failure-safe shutdown. Existing audio/caption worker remains independent.
- Post-meeting concat/mux with available mixed `audio.wav`; probe verifies positive media duration and expected streams. No available recording is explicitly shown as no embedded audio.
- In-page window/source controls and recording indicator; completed jobs show playback/download rather than obsolete capture controls. Transcript time can locate the corresponding video interval, with video playback pausing audio to avoid double sound.
- Byte-range video serving, filename/symlink checks; independent video download. Large video directories are intentionally excluded from the existing ZIP export.
- Documentation, upstream MIT notice, FFmpeg notices and installer notice-file inclusion.

## Executed evidence

| Run | Result | Log |
| --- | --- | --- |
| Full existing/new unit suite | 540 passed, 0 failed/skipped | `test/.tmp/video-unit-regression.log` |
| Audio gain / highlights / toolbar / integrity / video feature regression | 22 passed, 0 failed/skipped | `test/.tmp/video-feature-regression.log` |
| Final core/native/video/integrity/scroll regression before visual refinement | 27 passed, 0 failed/skipped | `test/.tmp/video-final.log` |
| Native completion/cleanup and integrity final run | 8 passed, 0 failed/skipped | `test/.tmp/video-native-final.log` |
| Recording UI regression after visual refinement | 6 passed, 0 failed/skipped | `test/.tmp/video-ui-final.log` |
| Final recording sign-off (core/native/UI/integrity) | 18 passed, 0 failed/skipped | `test/.tmp/video-signoff.log` |
| Python compilation, Node syntax, PowerShell parser | Passed | terminal execution |

Native evidence is real encoding/decoding, not mocked:

1. Synthetic FFmpeg source produced multiple playable WebM segments.
2. A generated 440Hz PCM recording was muxed; ffprobe found VP8/video and Opus/audio, and decoded volume analysis was nonzero.
3. An accelerated 125-second media-duration fixture produced more than two minutes of decodable segments. This is not a multi-hour or real-time endurance claim.
4. A newly created isolated GDI window was captured by its HWND; decoded frame colors matched known synthetic pixels. No private desktop was captured.
5. Killing the owner process caused both the guard and encoder processes to exit.
6. Chromium loaded real generated video with positive dimensions/duration, located a transcript timestamp using the meeting offset, and played video while the audio player was paused.

Browser control tests isolate source selection/API boundaries with fixtures. They cover phone/desktop and light/dark, explicit action, double-start guard, failures, exact identity/origin, media ranges, playback and seeking. All use the shared zero console/page-error guard. These tests do not substitute for human speech recognition or a real Google Meet/Teams meeting.

## Review and limitations

The initial synthetic run exposed a Python buffered-stdin daemon shutdown failure; stdin watching now uses unbuffered `os.read`, and native tests passed afterward. Visual inspection exposed an inherited full-width checkbox style and irrelevant completed-meeting controls; the final UI rules keep the checkbox compact and hide obsolete controls. Tests were adjusted to assert that stopped controls are absent from the visible UI rather than still-visible disabled buttons.

This version has no pause or same-meeting restart. Interrupted/stopped recordings are retained rather than overwritten. HWND capture does not guarantee good output from minimized, obscured, resized, hardware-accelerated or locked-session windows. It captures the selected window's current tab. Offset is estimated from encoder progress, not sample-accurate. No full consent/attendance or both-human-voices claim is made from synthetic evidence.

Real Meet/Teams screen sharing, both parties' speech, typical one-hour capture, mixed-DPI layouts and minimized/obscured windows remain manual acceptance items. The optional download path was syntax/source-checked; no network install was performed, since the existing pinned runtime was available. Installer compilation/upgrade and public Release were not performed in this implementation task. The installed formal application was not replaced.

Existing unrelated working-tree changes were preserved. No private meeting data, video or audio was added to Git. No meeting was joined and no third party contacted.

## Reproduce

```powershell
node --test --test-concurrency=1 "test/unit/**/*.test.js"
node --test --test-concurrency=1 test/integration/video-native.test.js
node --test --test-concurrency=1 test/qa/video.test.js
```

Synthetic screenshot (ignored local evidence): `test/.tmp/qa/manual/VIDEO_real_synthetic_media_plays_and_transcript_seek_uses_meeting_offset/real-synthetic-video.png`.
