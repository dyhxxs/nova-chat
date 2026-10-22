# Nova Chat 生产部署与发布

本文以单台 Linux 云服务器、Docker Compose 和 Caddy 为例。当前没有证书时，可以直接使用固定公网 IPv4 + HTTP/WS；取得证书后再切换到 HTTPS/WSS，不需要更换数据库或 App 账户数据。

## 1. 准备资源

当前公网 IPv4 + HTTP 模式需要：

- 一台具备固定公网 IPv4 的 Linux 服务器；
- Docker Engine 和 Docker Compose；
- 第三方 OpenAI-compatible API Base URL 和 Key；
- 云安全组和服务器防火墙的配置权限。

取得证书后切换 HTTPS/WSS 时，再准备你控制的域名（例如 `chat.example.com`）以及 Caddy、Nginx 或云负载均衡。正式分发 Android/iOS 安装包时，再准备商店或支持断点续传的对象存储/CDN。

不要把 APK 文件下载和模型网关混成同一个临时服务。网关负责 API；对象存储/CDN 负责大文件下载。

## 2. 生成服务器秘密

Linux 示例：

```bash
openssl rand -base64 48   # SERVER_MASTER_KEY
openssl rand -base64 36   # ADMIN_BOOTSTRAP_TOKEN
```

PowerShell 示例：

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(36))
```

将结果写入服务器的 `services/gateway/.env`。不要放进 Git、APK 或群聊。

## 3. 配置环境

```bash
cp services/gateway/.env.example services/gateway/.env
chmod 600 services/gateway/.env
```

生产最小配置：

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=8787
DATA_DIR=/app/data
SERVER_MASTER_KEY=<32+ random characters>
ADMIN_BOOTSTRAP_TOKEN=<24+ random characters>
REGISTRATION_ENABLED=true
SESSION_DAYS=30
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5.6-sol
ALLOWED_MODELS=gpt-5.6-sol
PROVIDER_API_MODE=responses
PROVIDER_AUTH_MODE=bearer
APP_ACCESS_TOKEN=
REQUESTS_PER_MINUTE=20
MAX_CONCURRENT_PER_DEVICE=2
MAX_HISTORY_CHARS=300000
MAX_OUTPUT_TOKENS=32768
MAX_FILE_BYTES=26214400
```

生产环境必须显式设置独立的 `SERVER_MASTER_KEY`（至少 32 个字符）和 `ADMIN_BOOTSTRAP_TOKEN`（至少 24 个字符），否则网关会拒绝启动。旧版 `APP_ACCESS_TOKEN` 不能替代数据库加密主密钥；如果从旧部署升级，请先把原有加密主密钥迁移到 `SERVER_MASTER_KEY`，再启动新版本。

`OPENAI_*` 只用于数据库尚无管理员配置时的默认值。推荐保持 Key 为空，部署后从 App 管理控制台填写第三方配置。

## 4. 启动 Docker Compose

```bash
npm ci
npm run verify
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 gateway
```

Compose 使用命名卷 `nova-chat-data` 保存 SQLite 和附件。默认将宿主机端口绑定到所有网卡，便于当前的公网 IPv4 + HTTP 部署：

```text
0.0.0.0:8787 -> container:8787
```

如果使用 Caddy/Nginx，应在启动前设置 `GATEWAY_BIND_ADDRESS=127.0.0.1`；如果直接使用公网 IP，保持默认值，并在云安全组和服务器防火墙只开放 TCP 8787（以及 SSH 管理端口）。`GATEWAY_PORT` 可用于更换宿主机端口，容器内部端口仍为 8787。

健康检查分为三个用途：

```bash
# 兼容旧客户端的服务摘要
curl -fsS http://127.0.0.1:8787/health
# 容器存活探针
curl -fsS http://127.0.0.1:8787/healthz
# 数据库和 Provider 配置就绪检查
curl -fsS http://127.0.0.1:8787/readyz
```

Compose 的容器健康检查使用 `/readyz`。首次管理员初始化前，如果数据库正常但 Provider 尚未填写，`/readyz` 会返回 `200` 并在 `checks.provider` 标记 `unconfigured`；数据库不可用时返回 `503`。响应不包含任何密钥：

```json
{"ok":true,"service":"nova-chat-gateway","checks":{"database":"ok","provider":"configured"}}
```

`/healthz` 只代表进程存活，不能代替 `/readyz`。客户端请求和服务器日志通过 `X-Request-ID` 关联；错误响应会带同一个 `requestId`。

部署后可以运行无凭据、无模型调用的本地冒烟检查。它只请求 `/healthz` 和 `/readyz`，允许数据库正常但 Provider 尚未配置的初始化状态，并拒绝重定向、超大响应、缺少请求 ID 和包含凭据的地址：

```bash
npm run gateway:smoke -- http://127.0.0.1:8787
```

通过后会输出健康状态和 `provider: configured` 或 `provider: unconfigured`；失败输出只包含检查代码，不回显响应正文、Token、Key 或模型配置。公网发布仍使用 `npm run gateway:check`，真实聊天验收才使用 `npm run gateway:check-chat`。

如果要采集 Prometheus 指标，在 `.env` 中设置：

```dotenv
METRICS_ENABLED=true
METRICS_TOKEN=<至少 24 个字符的随机值>
```

生产环境开启指标而没有满足长度要求的 Token 时网关拒绝启动。采集器使用：

```bash
curl -fsS -H "Authorization: Bearer $METRICS_TOKEN" http://127.0.0.1:8787/metrics
```

指标只按方法、路由模板和状态码聚合；未知动态路由统一记为 `/unknown`。不要把 `/metrics` 直接暴露到公共互联网，并按实际反向代理情况设置 `TRUST_PROXY=true` 或保持默认的 `false`。完整说明见 [企业级运行说明](ENTERPRISE_READINESS.md)。

## 5. 没有证书时使用公网 IPv4 + HTTP

这是当前可以直接上线联调的部署方式。假设服务器公网地址为 `YOUR_SERVER_IP`（请替换成真实 IPv4）：

~~~bash
# 服务器上启动，默认已经绑定 0.0.0.0:8787
docker compose up -d --build
curl -fsS http://YOUR_SERVER_IP:8787/health
~~~

在 App 中填写根地址 `http://YOUR_SERVER_IP:8787`，不要附加 `/v1`。HTTP API 使用 `http://`，流式聊天会自动使用 `ws://`。首次管理员创建、Provider 配置和普通用户注册流程与 HTTPS 部署相同。

公网 IP 的 HTTP 地址只在发布检查器中通过显式 `--allow-http-ip` 放行，域名 HTTP、内网 IP、回环地址和保留地址仍然拒绝。Android 构建使用：

~~~powershell
.\scripts\build_friend_android.ps1 -GatewayUrl 'http://YOUR_SERVER_IP:8787' -AllowHttpIp
~~~

服务器所有者初始化包使用：

~~~powershell
.\scripts\build_owner_android.ps1 -GatewayUrl 'http://YOUR_SERVER_IP:8787' -AllowHttpIp
~~~

脚本会自动设置 `EXPO_PUBLIC_GATEWAY_URL` 和 `ALLOW_CLEARTEXT=true`，构建后检查 APK 的网关地址、明文网络开关、包名、版本、ARM64、权限、签名和 zip 对齐。HTTP 会明文传输登录 Session，只应在当前确实没有证书的受控部署中使用；后续获得证书时，将地址改为 HTTPS 并去掉 `-AllowHttpIp` 即可。

## 6. 配置 HTTPS/WSS（取得证书后）

取得域名和证书后，使用反向代理终止 TLS，并把网关只绑定到本机回环地址：

```bash
export GATEWAY_BIND_ADDRESS=127.0.0.1
docker compose up -d --build
```

Caddyfile：

```caddy
chat.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8787
}
```

Caddy 会自动申请证书并代理 WebSocket。防火墙仅开放 22（限制来源）、80 和 443。

Nginx 需要显式传递 WebSocket Upgrade：

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 180s;
}
```

验证：

```bash
curl https://chat.example.com/health
```

## 7. 首次管理员初始化

1. 在 App 登录页填写 `https://chat.example.com`，不要附加 `/v1`。
2. App 请求 `/v1/setup/status` 并显示“创建管理员”。
3. 填写管理员邮箱、名称、至少 10 位密码和 `ADMIN_BOOTSTRAP_TOKEN`。
4. 创建后进入管理控制台。
5. 配置第三方服务，例如：

```text
Base URL: https://kxai.cc/v1
Protocol: Responses
Auth: Bearer
Default model: gpt-5.6-sol
Allowed models: gpt-5.6-sol
API Key: <第三方 Key>
```

6. 保存并点击测试连接。
7. 普通用户注册登录后直接使用，不需要填写第三方 Key。

如果第三方文档明确要求 `api-key` Header，选择 `api-key`；无需鉴权的私有服务才选择 `none`。

## 8. 注册与用户管理

- `REGISTRATION_ENABLED=true`：登录页允许自助注册。
- `REGISTRATION_ENABLED=false`：关闭新注册，已有用户继续使用。
- 管理员可在 App 中禁用用户、恢复用户、修改显示名称和调整角色。
- 禁用会立即撤销该用户所有 Session。
- 系统不会允许删除最后一个启用管理员的权限。

当前版本没有“管理员直接设置用户初始密码”的接口。小范围部署可暂时开放注册，让用户创建账号后关闭注册。

## 9. 服务商兼容性排查

### Responses 模式

优先选择真正兼容 `/responses` 的服务商。可使用文字、图片、PDF、Web Search 和 Code Interpreter，但每项能力仍取决于服务商实现、模型权限和计费计划。

### Chat Completions 模式

适用于只兼容 `/chat/completions` 的第三方。文字聊天通常可用，图片取决于服务商；PDF 和 Responses 工具不应预期可用。

常见错误：

- `401/403`：Key、Header 模式或账户权限错误；
- `404`：Base URL 多/少了 `/v1`，或协议选择错误；
- `model_not_allowed`：模型未加入管理员允许列表；
- `429`：Nova 限流或第三方限流；
- `stream_stalled`：反向代理/移动网络长连接中断，检查 WebSocket 和超时；
- 工具字段报 `400`：第三方并不兼容该 Responses 工具，先关闭工具重试。

## 10. 数据备份

列出卷：

```bash
docker volume ls | grep nova-chat-data
```

建议停止短时写入后备份。推荐使用仓库内的校验脚本，它会同时处理 SQLite 一致性副本和附件路径：

```bash
docker compose stop gateway
npm run gateway:backup -- \
  --data-dir /var/lib/docker/volumes/gptapp_nova-chat-data/_data \
  --output-dir /var/backups/nova-chat-$(date -u +%Y%m%dT%H%M%SZ)
npm run gateway:backup:verify -- \
  --backup-dir /var/backups/nova-chat-<timestamp>
docker compose start gateway
```

实际卷名前缀取决于 Compose 项目名，请以 `docker volume ls` 为准。数据库备份必须与 `SERVER_MASTER_KEY` 一起保存，但二者最好分开存放并分别控制访问权限。

恢复前先在隔离环境验证备份。不要覆盖运行中的 SQLite 文件。恢复到新的目录并用同一主密钥启动临时网关：

```bash
npm run gateway:backup:restore -- \
  --backup-dir /var/backups/nova-chat-<timestamp> \
  --data-dir /var/lib/nova-chat-recovery/data
```

脚本要求恢复目标目录尚不存在，且不会覆盖现有数据。检查 `/readyz`、管理员登录、资料库查询和附件下载后，再切换正式数据卷。完整说明见 [企业级运行说明](ENTERPRISE_READINESS.md)。

## 11. 更新网关

```bash
git pull
npm ci
npm run verify
docker compose build --pull gateway
docker compose up -d gateway
docker compose logs --tail=100 gateway
```

更新前备份数据卷。发布数据库迁移时先在副本上验证。

## 12. 构建 Android

### 可选：预置公开网关地址

生产包应在构建时预置网关地址，普通用户登录时无需填写服务器。为固定部署构建时设置：

```powershell
$env:EXPO_PUBLIC_GATEWAY_URL='https://chat.example.com'
```
该变量会公开嵌入 App，只能放网关 URL，不能放任何 Key、Token 或密码。未配置该变量时，登录页仅通过“服务器连接设置”高级入口允许开发者手动配置网关。

### Expo 验证和 bundle

```powershell
cd E:\gptapp\apps\mobile
npx expo-doctor
npx expo export --platform android --output-dir dist/android-bundle --clear
```

### Windows 本地 ARM64 APK

```powershell
cd E:\gptapp\apps\mobile\android
$env:ANDROID_HOME='D:\Android\Sdk'
$env:ANDROID_SDK_ROOT='D:\Android\Sdk'
.\gradlew.bat :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
```

Release 包应禁用明文流量：

```powershell
$env:ALLOW_CLEARTEXT='false'
```

构建后验证签名和摘要：

```powershell
& "$env:ANDROID_HOME\build-tools\<version>\apksigner.bat" verify --verbose path\to\app-release.apk
Get-FileHash path\to\app-release.apk -Algorithm SHA256
```

Play 商店发布通常应构建 AAB，并使用受控发布密钥，而不是开发/临时签名。

## 13. 构建 iOS

Windows 可以验证 Expo 配置并导出 iOS bundle：

```powershell
cd E:\gptapp\apps\mobile
npx expo export --platform ios --output-dir dist/ios-bundle --clear
```

可安装/可发布的 IPA 需要 Apple Developer 账户和签名：

```bash
npx eas-cli login
npx eas-cli init
npx eas-cli build --platform ios --profile production
```

也可在 macOS/Xcode 上本地 Archive。不能在普通 Windows 本机构造一个合法签名的 App Store IPA。

## 14. 分发 APK/IPA

Android 推荐：Google Play 内部测试、正式轨道或企业 MDM。iOS 推荐 TestFlight/App Store/企业 MDM。

如果必须直链 APK，使用支持以下特性的对象存储/CDN：

- `Accept-Ranges: bytes`；
- 稳定 `Content-Length`；
- HTTPS；
- CDN 和足够带宽；
- APK 正确 Content-Type；
- 大文件下载超时和断点续传；
- 版本化文件名，不覆盖旧版本。

“下载到 40% 断开”通常来自临时隧道、家用上行带宽、无 Range 简易服务器或链接过期，与 Nova 模型网关部署与否无关。

## 15. 发布检查清单

- [ ] `npm run build` 和 `npm run verify` 全部通过。`npm run gateway:smoke -- http://127.0.0.1:8787` 通过。
- [ ] `npx expo-doctor` 通过。
- [ ] Android/iOS bundle 导出成功。
- [ ] Android APK/AAB 签名正确，记录 SHA-256。
- [ ] iOS 使用正确团队、Bundle ID、证书和 Provisioning Profile。
- [ ] 已按实际发布模式验证 App 与网关地址：
  - 公网 IPv4 + HTTP：根地址使用 `http://公网IPv4:端口`，流式连接使用 `ws://`，构建显式使用 `-AllowHttpIp`，并确认 `ALLOW_CLEARTEXT=true`。
  - HTTPS/WSS：根地址使用 `https://域名`，流式连接使用 `wss://`，不使用 `-AllowHttpIp`，并确认 `ALLOW_CLEARTEXT=false`。
- [ ] 数据卷、主密钥、备份和恢复流程已验证。
- [ ] 管理员 Key 不在 bundle、日志、截图和源代码中。
- [ ] 注册策略、用户禁用、附件权限、限流和预算告警已验证。
- [ ] 图片/PDF/工具能力用实际第三方服务完成真机测试。
- [ ] 隐私政策与商店说明明确这是第三方客户端。
- [ ] 安装包托管支持断点续传，不使用临时内网穿透长期分发。

### 使用内部镜像仓库构建

网关镜像默认使用 Node 22 LTS，并通过 `NODE_IMAGE` 构建参数支持企业私有镜像仓库或内部镜像缓存：

```bash
NODE_IMAGE=registry.example.com/library/node:22-alpine \
  docker compose build gateway
docker compose up -d gateway
```

Windows PowerShell 使用：

```powershell
$env:NODE_IMAGE = 'registry.example.com/library/node:22-alpine'
docker compose build gateway
docker compose up -d gateway
```

仓库根目录的 `.dockerignore` 会排除本地依赖、数据库、上传文件、环境文件、密钥、移动端和文档，防止它们进入 Docker 构建上下文。生产构建前仍应确认 `services/gateway/.env` 只通过 Compose 的 `env_file` 注入，不要复制到镜像中。
