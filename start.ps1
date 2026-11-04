$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$url = "http://localhost:4174"
Set-Location $root

function Test-AppReady {
  try {
    $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 1
    return [bool]$health.ok
  } catch {
    return $false
  }
}

if (Test-AppReady) {
  Start-Process $url
  Write-Host "Meeting Action Agent is already running: $url"
  exit 0
}

$candidates = @(
  (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"),
  "C:\Program Files\nodejs\node.exe",
  "C:\Program Files (x86)\nodejs\node.exe",
  (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe")
)
$node = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $node) {
  $command = Get-Command node -ErrorAction SilentlyContinue
  if ($command) { $node = $command.Source }
}
if (-not $node) {
  Write-Host "Node.js was not found. Install Node.js 20+ and try again."
  Read-Host "Press Enter to close"
  exit 1
}

Start-Process -FilePath $node -ArgumentList "server.mjs" -WorkingDirectory $root -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $root "server.log") `
  -RedirectStandardError (Join-Path $root "server.err.log")

for ($i = 0; $i -lt 30; $i += 1) {
  Start-Sleep -Milliseconds 250
  if (Test-AppReady) {
    Start-Process $url
    Write-Host "Meeting Action Agent: $url"
    exit 0
  }
}

Write-Host "The local service did not start. Check server.err.log in this folder."
Read-Host "Press Enter to close"
exit 1
