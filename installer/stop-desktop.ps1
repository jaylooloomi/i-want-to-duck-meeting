param([string] $AppRoot, [string] $DataRoot)
$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $DataRoot 'desktop.pid'
if (Test-Path -LiteralPath $pidFile) {
    $desktopPid = [int](Get-Content -LiteralPath $pidFile -Raw)
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$desktopPid" -ErrorAction SilentlyContinue
    $expectedExe = [IO.Path]::GetFullPath((Join-Path $AppRoot 'runtime/node.exe'))
    if ($process -and $process.ExecutablePath -eq $expectedExe -and $process.CommandLine.Contains('openmeeting.js') -and $process.CommandLine.Contains('--port')) {
        Stop-Process -Id $desktopPid -ErrorAction Stop
    }
    Remove-Item -LiteralPath $pidFile -ErrorAction SilentlyContinue
}
