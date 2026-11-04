# Optional Windows video recording runtime

Recorder design and runtime installation pattern reference [before-you-do](https://github.com/jaylooloomi/before-you-do), Copyright (c) 2026 Arthur Wang, MIT. The upstream MIT notice is bundled in `before-you-do-LICENSE.txt`. Duck Meeting uses its own Node service and Python standard-library worker; it does not require the Tauri app.

FFmpeg is a separate executable, not linked into Duck Meeting. The app's MIT license does not replace FFmpeg's license. No FFmpeg binary is committed or bundled by this change.

- Provider/build recipes: https://github.com/BtbN/FFmpeg-Builds
- Pinned release: `autobuild-2026-10-28-19-47`
- Archive: `ffmpeg-n8.1.3-25-g611cec792a-win64-lgpl-shared-8.1.zip`
- SHA-256: `0448c3f3b9bdc724cc0189d5ce6e6bfa5b8937e7ec408e1e97fb08719bdb3b92`
- Upstream FFmpeg revision: `611cec792a`, source: https://github.com/FFmpeg/FFmpeg/tree/611cec792a
- LGPL shared variant, not the GPL/nonfree build. The installer preserves archive license and accompanying notice files in the runtime folder. Source/build/dependency details remain available from the provider and upstream.
- Device documentation: https://ffmpeg.org/ffmpeg-devices.html#gdigrab

Only the explicit **Install recording component** action downloads this archive. Its SHA-256 must match before extraction/use. No startup download and no PATH modification. Default install location: `<OPENMEETING_HOME>/recording-runtime/`.

Lookup order: explicit administrator environment `OPENMEETING_FFMPEG`, Duck Meeting's managed runtime, then the known existing before-you-do runtime under LOCALAPPDATA. Do not distribute an arbitrary system FFmpeg build while assuming the same license configuration. The matching `ffprobe.exe` and shared libraries must accompany `ffmpeg.exe`.

FFmpeg window video uses VP8/WebM (`libvpx`); optional final audio uses Opus (`libopus`). Capture does not start on installation, enumeration, opening the workspace, or joining a meeting. The user must choose a window and press Start recording.
