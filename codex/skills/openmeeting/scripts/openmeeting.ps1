param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $CliArgs
)

$ErrorActionPreference = 'Stop'
$skillRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $skillRoot 'runtime.json'
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw 'openmeeting is not configured. Run npm run setup -- --target codex from the project.'
}
$config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$cliPath = Join-Path $config.repoRoot 'bin\openmeeting.js'
if (-not (Test-Path -LiteralPath $cliPath -PathType Leaf)) {
    throw 'The openmeeting checkout moved or is missing. Run its installer again.'
}
$nodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$nodeCandidates = @($config.nodePath, $(if ($nodeCommand) { $nodeCommand.Source }))
$nodeExe = $nodeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $nodeExe) { throw 'Node.js was not found. Install Node.js 22+ and run the installer again.' }

$systemDirectory = Join-Path ([Environment]::GetFolderPath('Windows')) 'System32'
$windowsPowerShell = Join-Path $systemDirectory 'WindowsPowerShell\v1.0'
$env:PATH = (@((Split-Path -Parent $nodeExe), $systemDirectory, $windowsPowerShell, $env:PATH) | Where-Object { $_ }) -join ';'
& $nodeExe $cliPath @CliArgs
exit $LASTEXITCODE
