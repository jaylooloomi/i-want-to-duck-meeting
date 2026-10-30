$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$env:PATH = (Join-Path $appRoot 'runtime') + ';' + $env:PATH
& (Join-Path $appRoot 'runtime/node.exe') (Join-Path $appRoot 'bin/openmeeting.js') setup-audio
if ($LASTEXITCODE -ne 0) { Write-Host 'Audio setup failed. Check the messages above.' }
Read-Host 'Press Enter to close'
