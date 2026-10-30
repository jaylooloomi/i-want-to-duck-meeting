$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework
$appRoot = Split-Path -Parent $PSScriptRoot
$nodeExe = Join-Path $appRoot 'runtime/node.exe'
try {
    $result = & $nodeExe (Join-Path $PSScriptRoot 'update.js') 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($result -join "`n") }
    $release = ($result -join "`n") | ConvertFrom-Json
    if (-not $release.available) { [System.Windows.MessageBox]::Show('Duck Meeting is up to date.','Duck Meeting') | Out-Null; exit }
    $answer = [System.Windows.MessageBox]::Show(('Download and install version ' + $release.version + '? Meeting data will be preserved.'),'Duck Meeting update','YesNo','Question')
    if ($answer -ne 'Yes') { exit }
    $result = & $nodeExe (Join-Path $PSScriptRoot 'update.js') --download 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($result -join "`n") }
    $download = ($result -join "`n") | ConvertFrom-Json
    Start-Process -FilePath $download.file
} catch {
    [System.Windows.MessageBox]::Show(($_.Exception.Message + "`n`nOpen the Releases page to download manually (sign in if needed)."),'Duck Meeting update','OK','Warning') | Out-Null
    Start-Process 'https://github.com/jaylooloomi/i-want-to-duck-meeting/releases'
}
