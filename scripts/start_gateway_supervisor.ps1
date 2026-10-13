param([int]$Port = 8787)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$run = Join-Path $root '.run'
New-Item -ItemType Directory -Force -Path $run | Out-Null
$stateFile = Join-Path $run 'gateway-supervisor.json'
if (Test-Path -LiteralPath $stateFile) {
  $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  $existing = Get-CimInstance Win32_Process -Filter "ProcessId = $($state.supervisorPid)" -ErrorAction SilentlyContinue
  if ($existing -and $existing.Name -eq 'node.exe' -and $existing.CommandLine -and $existing.CommandLine.Contains((Join-Path $PSScriptRoot 'gateway_supervisor.mjs'))) {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5
    if (-not $health.ok -or $health.service -ne 'nova-chat-gateway') { throw '守护进程存在但网关未就绪，请检查日志。' }
    Write-Output "网关守护进程已运行：$($state.supervisorPid)"
    exit 0
  }
}
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "端口 $Port 已被占用。请先确认并停止旧网关，避免运行两个实例。" }
Push-Location $root
try { & npm run build; if ($LASTEXITCODE -ne 0) { throw '网关构建失败。' } } finally { Pop-Location }
$env:PORT = [string]$Port
$process = Start-Process -FilePath (Get-Command node).Source -ArgumentList @((Join-Path $PSScriptRoot 'gateway_supervisor.mjs')) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $run 'gateway-supervisor.out.log') -RedirectStandardError (Join-Path $run 'gateway-supervisor.err.log') -PassThru
foreach ($attempt in 1..30) {
  Start-Sleep -Milliseconds 500
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
    if ($health.ok -and $health.service -eq 'nova-chat-gateway') { Write-Output "网关守护进程已启动：$($process.Id)。电脑关机后仍会离线；这不是云端常驻部署。"; exit 0 }
  } catch {}
}
throw "网关未就绪，请检查 $run 下的 gateway-supervisor 日志。"
