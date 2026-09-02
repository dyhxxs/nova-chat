$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$statePath = Join-Path $workspace '.run\download-tunnel.json'
if (-not (Test-Path -LiteralPath $statePath)) {
  Write-Host '没有正在记录的下载隧道。'
  exit 0
}
$state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
foreach ($entry in @(@{ Id = [int]$state.tunnelPid; Name = 'cloudflared' }, @{ Id = [int]$state.serverPid; Name = 'node' })) {
  $process = Get-Process -Id $entry.Id -ErrorAction SilentlyContinue
  if ($process -and $process.ProcessName -like "$($entry.Name)*") {
    Stop-Process -Id $process.Id -Force
  }
}
Remove-Item -LiteralPath $statePath -Force
Write-Host '下载隧道和本地文件服务已停止。' -ForegroundColor Green
