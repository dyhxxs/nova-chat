# Nova Chat 生产部署与发布

本文以单台 Linux 云服务器、Docker Compose 和 Caddy 为例。目标是让 Android/iOS App 通过固定 HTTPS/WSS 域名访问 Nova 网关，并由管理员统一管理第三方模型服务。

## 1. 准备资源

需要：

- 一台具备固定公网 IP 的 Linux 服务器；
- 一个你控制的域名，例如 `chat.example.com`；
- Docker Engine 和 Docker Compose；
- Caddy、Nginx 或云负载均衡；
- 第三方 OpenAI-compatible API Base URL 和 Key；
- 用于 Android/iOS 分发的商店或支持断点续传的对象存储/CDN。

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

生产环境缺少强 `SERVER_MASTER_KEY` 或 `ADMIN_BOOTSTRAP_TOKEN` 时，网关会拒绝启动。

`OPENAI_*` 只用于数据库尚无管理员配置时的默认值。推荐保持 Key 为空，部署后从 App 管理控制台填写第三方配置。

## 4. 启动 Docker Compose

```bash
npm ci
npm run verify
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 gateway
```

Compose 使用命名卷 `nova-chat-data` 保存 SQLite 和附件，并只绑定：

```text
127.0.0.1:8787
```

因此外网不能绕过 TLS 代理直接访问网关。

健康检查：

```bash
curl http://127.0.0.1:8787/health
```

预期响应不包含任何密钥：

```json
{"ok":true,"service":"nova-chat-gateway","apiMode":"responses","defaultModel":"gpt-5.6-sol"}
```

## 5. 配置 HTTPS/WSS

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

## 6. 首次管理员初始化

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

## 7. 注册与用户管理

- `REGISTRATION_ENABLED=true`：登录页允许自助注册。
- `REGISTRATION_ENABLED=false`：关闭新注册，已有用户继续使用。
- 管理员可在 App 中禁用用户、恢复用户、修改显示名称和调整角色。
- 禁用会立即撤销该用户所有 Session。
- 系统不会允许删除最后一个启用管理员的权限。

当前版本没有“管理员直接设置用户初始密码”的接口。小范围部署可暂时开放注册，让用户创建账号后关闭注册。

## 8. 服务商兼容性排查

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

## 9. 数据备份

列出卷：

```bash
docker volume ls | grep nova-chat-data
```

建议停止短时写入后备份：

```bash
docker compose stop gateway
docker run --rm \
  -v gptapp_nova-chat-data:/data:ro \
  -v "$PWD/backups:/backup" \
  alpine sh -c 'tar czf /backup/nova-chat-data-$(date +%F-%H%M%S).tar.gz -C /data .'
docker compose start gateway
```

实际卷名前缀取决于 Compose 项目名，请以 `docker volume ls` 为准。数据库备份必须与 `SERVER_MASTER_KEY` 一起保存，但二者最好分开存放并分别控制访问权限。

恢复前先在隔离环境验证备份。不要覆盖运行中的 SQLite 文件。

## 10. 更新网关

```bash
git pull
npm ci
npm run verify
docker compose build --pull gateway
docker compose up -d gateway
docker compose logs --tail=100 gateway
```

更新前备份数据卷。发布数据库迁移时先在副本上验证。

## 11. 构建 Android

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

## 12. 构建 iOS

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

## 13. 分发 APK/IPA

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

## 14. 发布检查清单

- [ ] `npm run build` 和 `npm run verify` 全部通过。
- [ ] `npx expo-doctor` 通过。
- [ ] Android/iOS bundle 导出成功。
- [ ] Android APK/AAB 签名正确，记录 SHA-256。
- [ ] iOS 使用正确团队、Bundle ID、证书和 Provisioning Profile。
- [ ] 生产 App 只使用 HTTPS/WSS，明文流量已关闭。
- [ ] 数据卷、主密钥、备份和恢复流程已验证。
- [ ] 管理员 Key 不在 bundle、日志、截图和源代码中。
- [ ] 注册策略、用户禁用、附件权限、限流和预算告警已验证。
- [ ] 图片/PDF/工具能力用实际第三方服务完成真机测试。
- [ ] 隐私政策与商店说明明确这是第三方客户端。
- [ ] 安装包托管支持断点续传，不使用临时内网穿透长期分发。


