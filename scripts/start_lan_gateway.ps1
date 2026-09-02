param(
  [string]$GatewayHost = '',
  [int]$Port = 8787,
  [switch]$Restart
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$gatewayDir = Join-Path $projectRoot 'services\gateway'
$envPath = Join-Path $gatewayDir '.env'
$runDir = Join-Path $projectRoot '.run'
$pidPath = Join-Path $runDir 'lan-gateway.pid'
$stdoutPath = Join-Path $runDir 'lan-gateway.stdout.log'
$stderrPath = Join-Path $runDir 'lan-gateway.stderr.log'
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

if (-not (Test-Path -LiteralPath $envPath)) {
  throw "缺少 $envPath。请先生成本地网关配置。"
}

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  try {
    $existingHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3
  } catch {
    throw "端口 $Port 已被其他程序占用。"
  }
  if ($existingHealth.service -ne 'nova-chat-gateway') {
    throw "端口 $Port 上运行的不是 Nova 网关。"
  }

  if ($Restart) {
    $oldPid = [int]$listener.OwningProcess
    Stop-Process -Id $oldPid -Force
    $released = $false
    foreach ($attempt in 1..30) {
      Start-Sleep -Milliseconds 500
      if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
        $released = $true
        break
      }
    }
    if (-not $released) { throw "旧网关进程（PID $oldPid）停止后端口 $Port 仍被占用。" }
    $listener = $null
    Write-Output "已停止旧 Nova 网关（PID $oldPid），准备启动最新构建。"
  } else {
    Set-Content -LiteralPath $pidPath -Value $listener.OwningProcess -Encoding ascii
    Write-Output "Nova 网关已经在端口 $Port 运行（PID $($listener.OwningProcess)）。如需应用最新代码，请使用 -Restart。"
  }
}

if (-not $listener) {
  & npm run build --workspace @nova-chat/gateway
  if ($LASTEXITCODE -ne 0) { throw '网关构建失败。' }

  Remove-Item -LiteralPath $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
  $process = Start-Process -FilePath 'node' -ArgumentList 'dist/index.js' -WorkingDirectory $gatewayDir -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
  Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ascii

  $ready = $false
  foreach ($attempt in 1..30) {
    Start-Sleep -Milliseconds 500
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
      if ($health.ok -and $health.service -eq 'nova-chat-gateway') { $ready = $true; break }
    } catch {}
    if ($process.HasExited) { break }
  }
  if (-not $ready) {
    $errorTail = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Tail 30 | Out-String } else { '' }
    throw "网关启动失败。
$errorTail"
  }
  Write-Output "Nova 网关启动成功（PID $($process.Id)）。"
}

if ([string]::IsNullOrWhiteSpace($GatewayHost)) {
  $GatewayHost = Get-NetIPConfiguration |
    Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address -and $_.NetAdapter.Status -eq 'Up' } |
    Select-Object -First 1 -ExpandProperty IPv4Address |
    Select-Object -ExpandProperty IPAddress
}
if ([string]::IsNullOrWhiteSpace($GatewayHost)) { $GatewayHost = '127.0.0.1' }
Write-Output "本机健康检查: http://127.0.0.1:$Port/health"
Write-Output "手机局域网地址: http://${GatewayHost}:$Port"
Write-Output '保持电脑开机，并让手机连接同一个 Wi-Fi。'
