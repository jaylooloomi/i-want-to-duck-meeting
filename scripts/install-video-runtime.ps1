# FFmpeg runtime pattern adapted from before-you-do, Copyright (c) 2026 Arthur Wang, MIT.
# Full upstream MIT license: docs/third-party/before-you-do-LICENSE.txt.
$ErrorActionPreference = 'Stop'
$runtimeDir = $env:DUCK_VIDEO_RUNTIME
if (-not $runtimeDir) { throw 'Recording runtime destination is required' }
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$taskRoot = Join-Path $tempRoot ('duck-video-' + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $taskRoot | Out-Null
try {
    $archive = Join-Path $taskRoot 'runtime.zip'
    Invoke-WebRequest 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-28-19-47/ffmpeg-n8.1.3-25-g611cec792a-win64-lgpl-shared-8.1.zip' -OutFile $archive -UseBasicParsing
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne '0448c3f3b9bdc724cc0189d5ce6e6bfa5b8937e7ec408e1e97fb08719bdb3b92') { throw 'Recording runtime checksum mismatch' }
    $unpacked = Join-Path $taskRoot 'unpacked'
    Expand-Archive -LiteralPath $archive -DestinationPath $unpacked
    $source = Join-Path $unpacked 'ffmpeg-n8.1.3-25-g611cec792a-win64-lgpl-shared-8.1'
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $source 'bin') -Destination $runtimeDir -Recurse -Force
    Get-ChildItem -LiteralPath $source -File | Copy-Item -Destination $runtimeDir -Force
} finally {
    $resolvedTask = [IO.Path]::GetFullPath($taskRoot)
    if ($resolvedTask.StartsWith($tempRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($resolvedTask).StartsWith('duck-video-')) {
        Remove-Item -LiteralPath $resolvedTask -Recurse -Force
    }
}
