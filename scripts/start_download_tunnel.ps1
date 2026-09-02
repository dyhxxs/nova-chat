param(
  [string]$Directory = (Join-Path $PSScriptRoot '..\artifacts'),
  [ValidateRange(1024, 65535)][int]$Port = 8090
)

$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$resolvedDirectory = (Resolve-Path $Directory).Path
$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflared) { throw '未找到 cloudflared。请先安装 Cloudflare Tunnel。' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '未找到 Node.js。' }

$allowed = @('.apk', '.aab', '.ipa', '.zip')
$builds = Get-ChildItem -LiteralPath $resolvedDirectory -Recurse -File | Where-Object { $allowed -contains $_.Extension.ToLowerInvariant() }
if (-not $builds) { throw "目录中没有 APK/AAB/IPA/ZIP：$resolvedDirectory" }

$runDirectory = Join-Path $workspace '.run'
New-Item -ItemType Directory -Force -Path $runDirectory | Out-Null
$statePath = Join-Path $runDirectory 'download-tunnel.json'
if (Test-Path -LiteralPath $statePath) {
  try {
    $old = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
    if (Get-Process -Id $old.tunnelPid -ErrorAction SilentlyContinue) { throw '下载隧道已在运行，请先执行 scripts\stop_download_tunnel.ps1。' }
  } catch [System.Management.Automation.RuntimeException] { throw }
  catch { }
}

$tokenBytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($tokenBytes) } finally { $rng.Dispose() }
$token = [Convert]::ToBase64String($tokenBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$serverOut = Join-Path $runDirectory 'download-server.out.log'
$serverErr = Join-Path $runDirectory 'download-server.err.log'
$tunnelOut = Join-Path $runDirectory 'download-tunnel.out.log'
$tunnelErr = Join-Path $runDirectory 'download-tunnel.err.log'
@($serverOut, $serverErr, $tunnelOut, $tunnelErr) | ForEach-Object { Set-Content -LiteralPath $_ -Value '' }

$server = Start-Process -FilePath (Get-Command node).Source -ArgumentList @(
  (Join-Path $PSScriptRoot 'share-builds.mjs'), '--dir', $resolvedDirectory, '--port', [string]$Port, '--token', $token
) -WindowStyle Hidden -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr -PassThru

try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 250
    try {
      $health = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/healthz" -TimeoutSec 2
      if ($health.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) { throw "本地下载服务启动失败。日志：$serverErr" }

  $tunnel = Start-Process -FilePath $cloudflared.Source -ArgumentList @(
    'tunnel', '--no-autoupdate', '--url', "http://127.0.0.1:$Port"
  ) -WindowStyle Hidden -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr -PassThru

  $publicUrl = $null
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Milliseconds 500
    $logs = ((Get-Content -Raw -LiteralPath $tunnelOut -ErrorAction SilentlyContinue) + "`n" + (Get-Content -Raw -LiteralPath $tunnelErr -ErrorAction SilentlyContinue))
    $match = [regex]::Match($logs, 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($match.Success) { $publicUrl = $match.Value; break }
    if ($tunnel.HasExited) { throw "cloudflared 已退出。日志：$tunnelErr" }
  }
  if (-not $publicUrl) { throw "未能取得临时公网地址。日志：$tunnelErr" }

  $state = [ordered]@{
    serverPid = $server.Id
    tunnelPid = $tunnel.Id
    directory = $resolvedDirectory
    port = $Port
    publicUrl = $publicUrl
    startedAt = (Get-Date).ToString('o')
  }
  $state | ConvertTo-Json | Set-Content -Encoding utf8 -LiteralPath $statePath
  Write-Host ''
  Write-Host 'Nova Chat 临时下载地址已启动：' -ForegroundColor Green
  Write-Host "$publicUrl/?token=$token" -ForegroundColor Cyan
  Write-Host ''
  Write-Host '地址是临时公开入口。下载完成后执行：' -ForegroundColor Yellow
  Write-Host 'powershell -ExecutionPolicy Bypass -File scripts\stop_download_tunnel.ps1'
} catch {
  if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  throw
}
