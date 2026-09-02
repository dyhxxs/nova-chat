param([int]$Port = 8790)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runDir = Join-Path $projectRoot '.run'
$pidPath = Join-Path $runDir 'lan-download.pid'
$stdoutPath = Join-Path $runDir 'lan-download.stdout.log'
$stderrPath = Join-Path $runDir 'lan-download.stderr.log'
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  try { $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3 } catch { throw "端口 $Port 已被其他程序占用。" }
  if ($health.service -ne 'nova-chat-lan-download') { throw "端口 $Port 上运行的不是 Nova 下载服务。" }
  Set-Content -LiteralPath $pidPath -Value $listener.OwningProcess -Encoding ascii
} else {
  Remove-Item -LiteralPath $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
  $previousPort = $env:PORT
  $env:PORT = [string]$Port
  try {
    $process = Start-Process -FilePath 'node' -ArgumentList 'scripts/lan_download_server.mjs' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
  } finally {
    if ($null -eq $previousPort) { Remove-Item Env:PORT -ErrorAction SilentlyContinue } else { $env:PORT = $previousPort }
  }
  Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ascii
  $ready = $false
  foreach ($attempt in 1..20) {
    Start-Sleep -Milliseconds 300
    try { $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2; if ($health.ok -and $health.service -eq 'nova-chat-lan-download') { $ready = $true; break } } catch {}
    if ($process.HasExited) { break }
  }
  if (-not $ready) { throw '局域网 APK 下载服务启动失败。' }
}
$ip = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1 -ExpandProperty IPv4Address | Select-Object -ExpandProperty IPAddress
Write-Output "手机浏览器打开: http://${ip}:$Port"
