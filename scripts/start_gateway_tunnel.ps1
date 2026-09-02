param(
  [ValidateRange(1024, 65535)][int]$Port = 8787
)

$ErrorActionPreference = 'Stop'
$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflared) { throw '未找到 cloudflared。请先安装 Cloudflare Tunnel。' }
try {
  $health = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3
  if ($health.StatusCode -ne 200) { throw "网关健康检查返回 $($health.StatusCode)。" }
} catch {
  throw "本机端口 $Port 上没有可用的 Nova 网关。请先运行 npm run dev:gateway。"
}
Write-Host '正在创建 Cloudflare 临时隧道。网关仍会要求 APP_ACCESS_TOKEN。' -ForegroundColor Yellow
& $cloudflared.Source tunnel --no-autoupdate --url "http://127.0.0.1:$Port"
