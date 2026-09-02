$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pidPath = Join-Path $projectRoot '.run\lan-gateway.pid'
if (-not (Test-Path -LiteralPath $pidPath)) {
  Write-Output '没有找到局域网网关 PID 文件。'
  exit 0
}
$gatewayPid = [int](Get-Content -LiteralPath $pidPath -Raw).Trim()
$listener = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $gatewayPid } | Select-Object -First 1
if (-not $listener) {
  Write-Output '记录的网关进程已经停止；没有终止任何其他程序。'
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
  exit 0
}
try {
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 3
} catch {
  throw '无法确认该进程是 Nova 网关，因此未停止它。'
}
if ($health.service -ne 'nova-chat-gateway') {
  throw '端口 8787 上运行的不是 Nova 网关，因此未停止它。'
}
Stop-Process -Id $gatewayPid -Force
Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
Write-Output "已停止 Nova 局域网网关（PID $gatewayPid）。"
