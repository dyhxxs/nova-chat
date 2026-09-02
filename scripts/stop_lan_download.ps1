param([int]$Port = 8790)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pidPath = Join-Path $projectRoot '.run\lan-download.pid'
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  try { $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3 } catch { throw '无法确认下载服务身份，因此未停止。' }
  if ($health.service -ne 'nova-chat-lan-download') { throw '端口上的服务不是 Nova 下载服务，因此未停止。' }
  Stop-Process -Id $listener.OwningProcess -Force
  foreach ($attempt in 1..20) {
    Start-Sleep -Milliseconds 150
    if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) { break }
  }
  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw "下载服务进程已停止，但端口 $Port 尚未释放。"
  }
}
Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
Write-Output '已停止局域网 APK 下载服务。'
