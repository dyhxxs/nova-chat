$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stateFile = Join-Path $root '.run\gateway-supervisor.json'
if (-not (Test-Path -LiteralPath $stateFile)) { Write-Output '没有网关守护进程记录。'; exit 0 }
$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
$supervisor = Get-CimInstance Win32_Process -Filter "ProcessId = $($state.supervisorPid)" -ErrorAction SilentlyContinue
$gateway = Get-CimInstance Win32_Process -Filter "ProcessId = $($state.gatewayPid)" -ErrorAction SilentlyContinue
$supervisorPath = Join-Path $PSScriptRoot 'gateway_supervisor.mjs'
$gatewayPath = Join-Path $root 'services\gateway\dist\index.js'
if ($supervisor) {
  if ($supervisor.Name -ne 'node.exe' -or -not $supervisor.CommandLine -or -not $supervisor.CommandLine.Contains($supervisorPath)) { throw 'PID 已被其他程序使用，未终止进程。' }
  Stop-Process -Id $state.supervisorPid
}
# The supervisor may already have stopped its child during its own shutdown.
# Refresh and revalidate identity instead of acting on the stale process snapshot.
$gateway = Get-CimInstance Win32_Process -Filter "ProcessId = $($state.gatewayPid)" -ErrorAction SilentlyContinue
if ($gateway) {
  if ($gateway.Name -ne 'node.exe' -or -not $gateway.CommandLine -or -not $gateway.CommandLine.Contains($gatewayPath) -or $gateway.ParentProcessId -ne $state.supervisorPid) { throw '无法确认网关子进程，未终止该进程。' }
  try { Stop-Process -Id $state.gatewayPid } catch {
    if (Get-Process -Id $state.gatewayPid -ErrorAction SilentlyContinue) { throw }
  }
}
Remove-Item -LiteralPath $stateFile
Write-Output '网关守护进程和它的网关子进程已停止。'
