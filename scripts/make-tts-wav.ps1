<#
.SYNOPSIS
  Generates a speech WAV (16 kHz, 16-bit, mono PCM) with Windows System.Speech.
  Used to make zh-TW test audio for the Whisper fallback (default voice: Microsoft Hanhan).

.DESCRIPTION
  Works in Windows PowerShell 5.1 and PowerShell 7. Non-ASCII text (e.g. Chinese) can be passed:
    -Text     directly (command-line arguments are UTF-16, so they survive when spawned from Node/cmd)
    -TextFile path to a UTF-8 text file (safest when the caller's console code page is not UTF-8)
    -TextBase64  base64 of the UTF-8 bytes of the text
  Prints only ASCII to stdout: WAV=<abs path>, VOICE=<name>, CHARS=<n>, TEXT_B64=<base64 of the UTF-8
  text actually spoken, so callers can verify it survived>, BYTES=<n>, SECONDS=<n>.
  The file is saved with a UTF-8 BOM so PowerShell 5.1 never misreads it.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\make-tts-wav.ps1 -TextFile hello.txt -Out test\.tmp\hello.wav
#>
[CmdletBinding()]
param(
  [string]$Text,
  [string]$TextFile,
  [string]$TextBase64,
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Voice = 'Microsoft Hanhan Desktop',
  [ValidateRange(-10, 10)][int]$Rate = 0
)

$ErrorActionPreference = 'Stop'

if ($TextFile) {
  $resolvedTextFile = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($TextFile)
  $Text = [System.IO.File]::ReadAllText($resolvedTextFile, [System.Text.Encoding]::UTF8)
} elseif ($TextBase64) {
  $Text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($TextBase64))
}
if ([string]::IsNullOrWhiteSpace($Text)) {
  [Console]::Error.WriteLine('No text given: use -Text, -TextFile or -TextBase64.')
  exit 2
}
$Text = $Text.Trim([char]0xFEFF).Trim()

Add-Type -AssemblyName System.Speech

# .NET resolves relative paths against the process directory, not the PowerShell location.
$outPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Out)
$outDir = [System.IO.Path]::GetDirectoryName($outPath)
if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $installed = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name })
  if ($installed -notcontains $Voice) {
    [Console]::Error.WriteLine(("Voice '{0}' is not installed. Installed: {1}" -f $Voice, ($installed -join ', ')))
    exit 3
  }
  $synth.SelectVoice($Voice)
  $synth.Rate = $Rate

  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
    16000,
    [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
    [System.Speech.AudioFormat.AudioChannel]::Mono)
  $synth.SetOutputToWaveFile($outPath, $format)
  $synth.Speak($Text)
  $synth.SetOutputToNull()
} finally {
  $synth.Dispose()
}

$bytes = (Get-Item -LiteralPath $outPath).Length
$seconds = [math]::Round([math]::Max(0, $bytes - 44) / 32000.0, 2)
Write-Output ('WAV=' + $outPath)
Write-Output ('VOICE=' + $Voice)
Write-Output ('CHARS=' + $Text.Length)
Write-Output ('TEXT_B64=' + [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Text)))
Write-Output ('BYTES=' + $bytes)
Write-Output ('SECONDS=' + $seconds.ToString([System.Globalization.CultureInfo]::InvariantCulture))
exit 0
