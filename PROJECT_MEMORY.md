# Nova Chat 项目记忆文档

> **用途**：这是 Nova Chat 的长期上下文和交接记录。开始新的 Codex/ChatGPT 对话时，应先让助手读取本文件，再继续修改项目。
>
> **最后更新**：2026-09-04（Asia/Shanghai）
> **当前版本**：workspace / Mobile / Gateway / Protocol 1.1.13；最近已验证并发布的 LAN APK 为 1.1.13-lan
> **工作区**：`E:\gptapp`

## 0. 新对话首先执行

可以把下面这句话直接发给新的编程助手：

```text
请先完整阅读 E:\gptapp\PROJECT_MEMORY.md、README.md、docs/ARCHITECTURE.md、docs/DEPLOYMENT.md 和 SECURITY.md，再检查当前工作区与运行状态后继续。不要打印、复制或提交任何 API Key、管理员密码、初始化口令、Session Token 或 SERVER_MASTER_KEY。完成修改后必须更新 PROJECT_MEMORY.md。
```

新助手不得仅凭本文中的“运行快照”判断当前状态，因为局域网 IP、进程、端口占用和第三方接口能力可能变化。必须先实际检查。

涉及 Mobile 的页面、交互、权限、模型行为或其他会影响手机测试的修改时，完成代码验证后必须重新构建当前版本的 ARM64 LAN APK、覆盖 `artifacts/` 中对应文件，并实际校验 8790 下载直链与本地 APK 哈希一致；除非用户明确表示本轮不需要测试包。最终回复必须说明 APK 是否已重建，不能只完成 Metro 导出。

---

## 1. 产品目标

Nova Chat 是一个面向 Android/iOS 的自托管、多用户、GPT 风格聊天客户端：

- 管理员统一配置第三方 OpenAI-compatible API 地址、API Key、协议和可用模型。
- 普通用户只使用 Nova 网关地址、账号和密码，不接触第三方 API Key。
- 支持多对话、流式输出、上下文、取消和重新生成。
- 支持常见图片、文本/代码、PDF、Office/OpenDocument 和 EPUB/MOBI 等附件。
- 在第三方接口兼容时，支持 Responses API、Web Search、Code Interpreter 等工具。
- 当前先使用家庭局域网完成真机测试，生产环境最终应部署 HTTPS/WSS 公网服务器。

### 必须长期保留的边界说明

- Nova Chat **不是** OpenAI、ChatGPT 或 Codex 官方产品。
- 第三方服务商提供的 `gpt-5.6-*` 等模型名只是服务商声明，客户端无法独立证明它与任何官方同名模型完全一致。
- Nova Chat 可以实现相似的聊天、附件、工具和多用户体验，但不能承诺“完整复制官方 ChatGPT/Codex 的所有内部功能”。
- Web Search、Code Interpreter、图片理解、PDF 阅读、上下文上限和输出上限最终取决于第三方服务商的真实兼容程度。

---

## 2. 当前技术架构

```text
Android / iOS Nova Chat App
  ├─ React Native 0.86.2 + Expo 57
  ├─ Zustand 本地状态
  ├─ SecureStore 保存登录 Session
  ├─ REST：认证、模型目录、管理、附件上传
  └─ WebSocket：聊天流式生成
                  ↓
Nova Gateway（Fastify + Node.js）
  ├─ 注册、登录、Session、角色和用户管理
  ├─ 设备并发、速率限制、输入/输出限制
  ├─ SQLite 持久化
  ├─ AES-256-GCM 加密第三方 API Key
  ├─ 附件所有权、真实文件头和大小校验
  ├─ Responses / Chat Completions 协议转换
  └─ 模型和工具兼容性降级
                  ↓
管理员配置的第三方 OpenAI-compatible 服务
```

### 工作区结构

```text
E:\gptapp
├─ apps/mobile/               Expo / React Native Android+iOS 客户端
├─ services/gateway/          Fastify 网关
├─ packages/protocol/         App 与网关共享的 Zod 协议和类型
├─ scripts/                   LAN 启停、构建、下载和 CC Switch 导入脚本
├─ docs/ARCHITECTURE.md       详细数据流和并发设计
├─ docs/DEPLOYMENT.md         部署和构建说明
├─ SECURITY.md                安全边界
├─ PROJECT_MEMORY.md          本文件
├─ artifacts/                 构建出的 APK 和校验信息
├─ services/gateway/data/     本地 SQLite 与上传文件
└─ .run/                      PID、运行日志和临时验证文件
```

### 重要源码入口

#### Mobile

- `apps/mobile/src/screens/ChatScreen.tsx`
  - 发送流程、附件选择、多会话生成状态、键盘避让。
- `apps/mobile/src/components/Composer.tsx`
  - 输入框、附件预览、发送/停止按钮、键盘回车发送。
- `apps/mobile/src/components/ChatOptionsModal.tsx`
  - 聊天页模型搜索、模型选择、推理强度和回答详略设置。
- `apps/mobile/src/services/chatClient.ts`
  - 网关 WebSocket/REST 生成连接与回退。
- `apps/mobile/src/services/gatewayApiClient.ts`
  - 登录、模型、管理接口和原生附件上传。
- `apps/mobile/src/services/gatewayUploadResponse.ts`
  - 附件上传响应解析和错误分类。
- `apps/mobile/src/services/gatewayImageCache.ts`
  - 使用认证请求下载网关图片到 App 私有缓存；完整性校验、并发去重、超时和失败重试。
- `apps/mobile/src/lib/conversationContext.ts`
  - 历史上下文构建和裁剪。
- `apps/mobile/src/lib/modelSelection.ts`
  - 登录/恢复 Session 后的模型安全选择和旧模型迁移。
- `apps/mobile/src/store/useAppStore.ts`
  - 用户、Session、设置、对话和消息状态。

#### Gateway

- `services/gateway/src/server.ts`
  - Fastify 路由、WebSocket、认证、附件和管理入口。
- `services/gateway/src/provider.ts`
  - 第三方请求、流解析、模型和工具兼容性处理。
- `services/gateway/src/database.ts`
  - SQLite、用户、Session、模型配置和加密存储。
- `services/gateway/src/auth.ts`
  - 密码、Token 和权限相关逻辑。
- `services/gateway/src/config.ts`
  - 环境变量、限制和默认设置。
- `packages/protocol/src/index.ts`
  - App/网关共享协议；改变请求或消息结构时两端必须同步。

---

## 3. 当前版本和已实现能力

### 版本

```text
根/workspace package 版本：1.1.3
移动端/LAN app 版本：1.1.8
Android versionCode：10
iOS buildNumber：10
LAN versionName：1.1.8-lan
LAN 包名：com.novachat.mobile.lan
最低 Android SDK：24
目标 Android SDK：36
```

### 用户和管理员

- 首次管理员初始化已经完成：`needsBootstrap=false`。
- 服务器仍要求初始化口令机制：`bootstrapTokenRequired=true`。
- 当前允许普通用户注册：`registrationEnabled=true`。
- 已有登录、注册、退出和 Session 恢复。
- 已有管理员用户列表、角色调整、禁用账户和“不得删除/降级最后一个管理员”的保护。
- 管理员统一配置第三方接口；普通用户无法读取完整 API Key。
- 网关默认启用自动创建管理员账户，默认邮箱由 `ADMIN_EMAIL` 控制；已存在同邮箱账户时不会覆盖密码。
- `ADMIN_PASSWORD` 支持通过环境变量覆盖；凭据不记录在本文档中。

**严禁在本文记录管理员邮箱、密码、初始化口令或 Session Token。**

### 当前第三方服务配置

当前本地网关曾从 CC Switch 自动导入以下非秘密配置：

```text
服务商名称：My Codex
API Base URL：https://ai.kxai.cc/v1
API 模式：responses
认证模式：bearer
默认模型：gpt-5.6-sol
已发布模型数量：13
当前已发布模型：
- codex-auto-review
- gpt-5.2
- gpt-5.3-codex-spark
- gpt-5.4
- gpt-5.4-mini
- gpt-5.5
- gpt-5.6
- gpt-5.6-luna
- gpt-5.6-sol
- gpt-5.6-terra
- gpt-image-1
- gpt-image-1.5
- gpt-image-2
```

- API Key 已存在，但只以加密形式保存。
- 不得从 CC Switch、`.env` 或数据库中打印完整 Key。
- 第三方配置可能变化；操作前应通过管理员页面或安全脚本重新核对。

### 聊天能力

- 每个对话有独立的生成控制器、请求 ID 和 WebSocket 状态。
- 切换对话不会把流式增量写到另一个会话。
- 一个对话生成时，其他没有生成任务的对话仍可独立使用。
- 支持停止生成、失败状态、保留 partial 内容和重新生成。
- WebSocket 握手前可以安全回退 REST。
- 已开始输出后不会自动重放请求，避免重复回答或重复计费。
- 上下文会排除失败、取消和仍在流式输出的助手消息。
- 历史附件引用会随上下文保留，并按字符预算裁剪。
- 登录和恢复 Session 后会同步服务器模型目录；失效旧模型会迁移到管理员默认模型。
- 聊天页新增紧凑模型控制条和“对话设置”弹窗，可选择管理员发布的模型、推理强度和回答详略；设置通过现有生成请求发送，只影响后续消息。
- 网关会对模型名做安全兜底，避免客户端发送管理员未允许的模型。
- 第三方不支持工具时，网关会按兼容策略移除不支持工具后重试。
- 系统提示会说明客户端名称 Nova 和实际模型 ID，以减少错误自称 DeepSeek；模型仍可能产生错误陈述。

### 长上下文、推理强度与生图路由

- 客户端和网关统一使用 `MAX_HISTORY_CHARS=600000`、`MAX_HISTORY_MESSAGES=400` 的有界历史窗口；协议允许最多 512 条消息，网关请求体上限为 4 MB。
- 客户端先裁剪旧历史，网关再次裁剪作为安全兜底；聊天不会因为超过旧的较小阈值直接返回 `413 history_too_large`。
- 600000 字符是应用层预算，不代表无限上下文，也不能覆盖第三方模型自身更小的 token 上限；模型、服务商和输出长度仍可能限制实际可用上下文。
- Responses 模式发送 `reasoning.effort` 与 `text.verbosity`；Chat Completions 只向看起来支持推理的模型发送 `reasoning_effort`，不发送通用性不足的 `verbosity`；图片请求不发送这些文本推理参数。
- UI 的 `xhigh`/`max` 会映射为兼容的 `high`；第三方拒绝不支持的参数时，网关会移除参数后重试。
- 选择 `gpt-image-*` 或表达“生图/生成图片/画图”等意图时，网关自动调用 `/images/generations`，而不是把生图要求当作普通文字回答。
- 图片接口兼容 `b64_json`、data URL、远程 URL 和直接二进制图片响应；`response_format=b64_json` 不兼容时会自动移除后重试。图片模型和文本模型分别执行降级。
- 生图成功后图片保存为网关附件，REST 与 WebSocket 都返回 `attachments`；移动端使用带认证的本地缓存下载并显示，失败时可点按重试。

### 附件能力

支持：

- JPG / JPEG
- PNG
- WebP
- GIF
- PDF
- 每条消息最多 8 个附件
- 单个文件默认不超过 25 MB

服务器会检查：

- 登录状态和附件所有权
- 声明 MIME 类型
- 真实文件头
- 文件大小
- 文件 ID 是否属于当前用户

### 1.1.8 的关键修复

1. **修复 LAN APK 原生版本仍显示旧值的问题**
   - `apps/mobile/android/app/build.gradle` 不再硬编码旧的 `versionCode 5` / `versionName 1.1.3`。
   - `scripts/build_lan_android.ps1` 从 `apps/mobile/app.json` 读取 `version=1.1.8`、`android.versionCode=10`，并通过 Gradle 参数写入原生 APK 元数据。
   - 最终 APK 已用 `aapt2 dump badging` 验证为 `com.novachat.mobile.lan`、`versionCode=10`、`versionName=1.1.8-lan`，可覆盖安装旧 LAN 包。

2. **确认生图链路已实际返回图片**
   - 当前运行中的网关对 `gpt-image-2` 进行了真实端到端请求，HTTP 200，返回 1 个图片附件，格式为 PNG，约 1.19 MB。
   - 通过带授权的 `/v1/files/{id}` 读取返回 HTTP 200，并校验 PNG 文件头成功。
   - 因此之前“只有文字、没有图片”更可能是手机仍安装旧 APK，或 8787 仍运行旧网关进程，而不是当前图片链路本身没有实现。

3. **长对话不再因应用旧阈值直接失效**
   - 客户端/网关已统一为 600000 字符 / 400 条的有界窗口，并保留自动裁剪旧历史。
   - 该策略尽量接近长上下文体验，但不能承诺无限上下文；实际仍服从服务商模型上下文窗口、输入限制和输出限制。

### 1.1.3 的关键修复

1. **发送后的网关图片可以可靠显示**
   - 网关日志确认上传成功，但 React Native `<Image source.headers>` 在该 Android 真机上未实际携带 Authorization Header，导致 `GET /v1/files/{attachmentId}` 返回 401 和灰色占位。
   - 新增 `gatewayImageCache.ts`，使用 `expo-file-system` 的认证原生下载，把图片保存到 App 私有缓存后再用本地 `file://` URI 渲染。
   - Session Token 只进入请求 Header，不进入图片 URL、缓存文件名或日志 URL。
   - 按服务端附件大小校验下载完整性；损坏或不完整缓存会被删除。
   - 相同图片并发下载自动去重；下载超时为 60 秒；支持 JPG、PNG、WebP、GIF。
   - 消息气泡显示加载状态、失败提示和“点按重试”；本地解码失败时会清理缓存并允许重新下载。

2. **修复 Android 键盘重复避让**
   - Manifest 已使用 `windowSoftInputMode="adjustResize"`。
   - 1.1.2 同时设置 `KeyboardAvoidingView behavior="height"`，在该 Android 真机产生重复避让，反而把 Composer 推到键盘下方。
   - 现在仅 iOS 使用 `behavior="padding"`；Android 的 behavior 为 `undefined`，只依赖原生 `adjustResize`。

3. **LAN 构建和下载服务更可靠**
   - APK 文件名自动读取 `apps/mobile/app.json` 中的 `expo.version`。
   - 启停脚本根据端口监听进程和 `/health` 服务名识别真正的 Nova 下载服务，不再只依赖可能失效的 PID 文件。
   - 停止时等待端口释放；启动参数会正确传递下载端口；启动后验证服务名。

4. **新增图片缓存测试**
   - 文件：`apps/mobile/test/gatewayImageCache.test.ts`
   - 覆盖 Token 只进入 Authorization Header、使用认证原生下载、完整缓存复用、不完整缓存删除。

### 1.1.2 的关键修复（历史）

> 这里保留 1.1.2 当时的实现记录；其中 Android `behavior="height"` 已在 1.1.3 被新方案取代。

1. **Android 输入框不再被键盘遮挡**
   - `ChatScreen.tsx` 在 Android 使用 `KeyboardAvoidingView behavior="height"`。
   - Manifest 保持 `windowSoftInputMode="adjustResize"`。
   - 键盘弹出时，如果用户位于列表底部，会再次滚动到底部。

2. **键盘回车直接发送**
   - `returnKeyType="send"`
   - `enterKeyHint="send"`
   - `submitBehavior="submit"`
   - `onSubmitEditing` 和发送按钮调用同一提交函数。
   - 使用同步 ref 阻止用户快速回车造成重复发送。

3. **Android/iOS 原生附件上传**
   - 新增直接依赖 `expo-file-system ~57.0.5`。
   - 原生平台使用 `File.upload` 和 `UploadType.MULTIPART`。
   - 不再依赖容易在 React Native 本地 URI 上失败的 `fetch + FormData + { uri }`。
   - 90 秒超时；上传保持前台 Session。
   - 文件不可读、超时、服务端业务错误和局域网网络错误分别提示。

4. **上传响应测试**
   - 文件：`apps/mobile/test/gatewayUploadResponse.test.ts`
   - 覆盖成功、结构化错误、非 JSON HTTP 错误和畸形成功响应。

---

## 4. 当前 LAN 运行快照

> 以下是 **2026-09-01** 的运行快照，局域网 IP、进程和端口仍可能变化，使用前必须重新检测。

```text
电脑局域网 IP：192.168.0.113
Nova 网关：http://192.168.0.113:8787
APK 下载页：http://192.168.0.113:8790
检测到网关监听 PID：39032
检测到下载服务监听 PID：41616
```

当时健康检查：

```json
{"ok":true,"service":"nova-chat-gateway","apiMode":"responses","defaultModel":"gpt-5.6-sol"}
{"ok":true,"service":"nova-chat-lan-download"}
```

手机必须：

- 与电脑连接同一 Wi-Fi。
- 能访问 `192.168.0.113`。
- 安装 LAN 包而不是生产预览包。
- 电脑保持开机，网关和下载服务保持运行。

### 当前 APK

```text
文件：E:\gptapp\artifacts\NovaChat-1.1.8-android-arm64-lan.apk
大小：35,291,245 bytes
SHA-256：0312525EF4D52AB9692FD020E0DBC645687244ED6DEC8D8840F4F3941C6AFF78
包名：com.novachat.mobile.lan
versionCode：10
versionName：1.1.8-lan
预置网关：http://192.168.0.113:8787
```

- 1.1.8 LAN 包与此前 LAN APK 使用相同签名，可直接覆盖安装并保留 App 数据。
- LAN 变体允许明文 HTTP，只能用于可信私有 Wi-Fi。
- 下载服务支持 HTTP Range，已验证返回 `206 Partial Content`，手机浏览器中断后可尝试续传。

---

## 5. 常用操作手册

所有命令默认在：

```powershell
cd E:\gptapp
```

### 检查实际局域网 IP

```powershell
Get-NetIPConfiguration |
  Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address -and $_.NetAdapter.Status -eq 'Up' } |
  Select-Object -First 1 -ExpandProperty IPv4Address
```

### 启动 LAN 网关

```powershell
.\scripts\start_lan_gateway.ps1
```

如果代码或 `dist` 已更新而端口上仍有旧网关进程，必须显式重启以加载最新代码：

```powershell
.\scripts\start_lan_gateway.ps1 -GatewayHost 192.168.0.113 -Restart
```

脚本会：

- 检查 `services/gateway/.env`。
- 构建网关（仅在启动新进程或使用 `-Restart` 时）。
- 后台隐藏启动服务。
- 写入 `.run/lan-gateway.pid`。
- 写入 `.run/lan-gateway.stdout.log` 和 `.run/lan-gateway.stderr.log`。
- 检查 `/health`。

### 停止 LAN 网关

```powershell
.\scripts\stop_lan_gateway.ps1
```

脚本会先核对端口和健康检查，避免误杀其他程序。

### 构建 LAN Android APK

自动检测局域网 IP：

```powershell
.\scripts\build_lan_android.ps1
```

指定固定地址：

```powershell
.\scripts\build_lan_android.ps1 -GatewayHost 192.168.0.113 -Port 8787
```

每次准备给手机覆盖安装时必须：

1. 更新根包、mobile、gateway 和 protocol 版本。
2. Android `versionCode` 必须递增。
3. 更新 `scripts/build_lan_android.ps1` 的产物名。
4. 更新 `scripts/lan_download_server.mjs` 的 APK 文件名。
5. 更新 README、SECURITY 和本记忆文档。
6. 运行全量验证。
7. 构建 APK 并核对签名、包名、版本和预置网关地址。

### 启动 APK 下载服务

```powershell
.\scripts\start_lan_download.ps1
```

### 停止 APK 下载服务

```powershell
.\scripts\stop_lan_download.ps1
```

### 健康检查

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
Invoke-RestMethod http://127.0.0.1:8790/health
Invoke-RestMethod http://127.0.0.1:8787/v1/setup/status
```

### 查看端口和日志

```powershell
Get-NetTCPConnection -State Listen -LocalPort 8787,8790
Get-Content .run\lan-gateway.stdout.log -Tail 100
Get-Content .run\lan-gateway.stderr.log -Tail 100
Get-Content .run\lan-download.stdout.log -Tail 100
Get-Content .run\lan-download.stderr.log -Tail 100
```

### 安装和全量验证

```powershell
npm ci
npm run build
npm run verify
```

1.1.3 构建时的验证结果：

```text
Mobile：7 个测试文件 / 26 项测试
Gateway：6 个测试文件 / 22 项测试
总计：48 项测试通过
Mobile/Gateway/Protocol TypeScript 通过
Mobile/Gateway ESLint 通过
Android LAN Gradle 构建通过
APK v2 签名验证通过
```

### 从 CC Switch 安全导入当前服务商

先构建网关，再执行：

```powershell
npm run build -w @nova-chat/gateway
node scripts/import_cc_switch_provider.mjs
```

脚本读取：

```text
%USERPROFILE%\.cc-switch\cc-switch.db
```

并把当前 Codex 服务商写入 Nova SQLite。输出只能包含：

- 服务商名称
- Base URL
- API 模式
- 认证模式
- 默认模型
- 允许模型
- `apiKeySet`
- 脱敏预览

**绝不修改脚本去输出完整 Key。**

---

## 6. 数据和安全规则

### 永远不能提交或粘贴到聊天中的内容

- `services/gateway/.env` 的真实内容
- `SERVER_MASTER_KEY`
- `ADMIN_BOOTSTRAP_TOKEN`
- 管理员或普通用户密码
- 完整第三方 API Key
- Access Token / Session Token
- CC Switch 数据库中的认证字段
- 包含秘密的数据库导出或日志

### 本地关键数据

```text
services/gateway/.env
services/gateway/data/nova-chat.sqlite
services/gateway/data/uploads/
```

- Provider Key 在 SQLite 中使用 AES-256-GCM 加密。
- 加密依赖 `SERVER_MASTER_KEY`。只备份数据库但丢失主密钥，会无法解密 Provider Key。
- 生产环境必须使用固定、高熵主密钥，并安全备份。
- Session Token 只保存哈希；客户端 Session 保存于 SecureStore。
- LAN HTTP 包只能用于可信局域网，不应公开发布。
- 生产环境必须使用 HTTPS/WSS、正式 Android/iOS 签名和服务器备份。

### 当前版本控制风险

截至 2026-08-24，`E:\gptapp` **不是 Git 仓库**。这意味着：

- `git status` 不可用。
- 没有提交历史可恢复。
- 修改前后只能依赖文件备份和本记忆文档追踪。

建议后续建立私有 Git 仓库，并确保 `.env`、SQLite、上传目录、`.run` 和签名密钥被 `.gitignore` 排除。在用户明确同意前，不要擅自把项目推送到任何公开远程仓库。

---

## 7. 常见故障诊断

### 手机提示无法连接服务器

依次检查：

1. 电脑实际局域网 IP 是否仍是 `192.168.0.113`。
2. `8787` 是否在 `0.0.0.0` 监听。
3. `http://电脑IP:8787/health` 是否正常。
4. 手机和电脑是否同一 Wi-Fi、是否启用了访客网络隔离。
5. Windows 防火墙是否阻止 Node.js/8787。
6. 手机是否安装并打开 `Nova Chat LAN`。
7. APK bundle 中预置地址是否还是旧 IP；IP 改变后需要重新构建 LAN APK或在设置里更改地址。

### 图片/PDF 发送或显示失败

1. 查看 `.run/lan-gateway.stdout.log` 中是否出现 `POST /v1/files`。
2. 如果完全没有请求到达网关，优先检查客户端本地 URI、文件权限和网络层。
3. 1.1.2 起使用 `expo-file-system` 原生 multipart 上传，不要退回 RN `fetch + FormData + { uri }`。
4. 如果上传成功但消息内图片是灰色占位，检查 `GET /v1/files/{attachmentId}` 是否返回 401；1.1.3 必须经 `gatewayImageCache.ts` 认证下载后使用本地 URI 显示，不要依赖 `<Image source.headers>`。
5. 图片加载失败时可以点按图片区域重试；不完整缓存必须删除，不能直接渲染。
6. 如果刚更新过代码但网关日志仍显示旧启动时间，执行 `start_lan_gateway.ps1 -Restart`；普通启动命令为保护现有连接会复用健康的网关进程。
6. 如果网关返回 413/415/401，应保留服务器的中文结构化错误，不要统一误报“服务器离线”。
7. PDF 读取通常要求 Responses 模式和第三方文件输入兼容。

### 键盘挡住输入框

- 保持 Manifest `windowSoftInputMode="adjustResize"`。
- Android 的 `KeyboardAvoidingView behavior` 必须为 `undefined`，避免与 `adjustResize` 重复避让。
- iOS 继续使用 `KeyboardAvoidingView behavior="padding"`。
- 不要把 `Composer` 移出 `KeyboardAvoidingView`。
- Android edge-to-edge、导航栏或 Expo/React Native 升级后必须重新做真机键盘测试。

### 回车没有发送或重复发送

- `TextInput` 必须保留 `submitBehavior="submit"`。
- `onSubmitEditing` 和按钮必须共用同一个 `submit()`。
- `submittingRef` 用于阻止同一帧内的快速重复触发，不要只依赖异步 React state。

### 切换对话后回复串线或另一个对话不可用

- 不得把“是否生成中”设计成全局单一布尔值。
- 每个 conversation ID 必须拥有独立 `GenerationController`。
- 所有流式 delta 必须按 conversation ID 和 assistant message ID 写回。
- 删除对话时必须取消对应生成控制器。

### 模型不允许、错误模型或自称 DeepSeek

- 登录和 Session 恢复后调用 `/v1/models`。
- 使用 `selectGatewayModel` 把旧模型迁移到管理员默认模型。
- 网关必须再次校验 allowed models，客户端选择不能作为安全边界。
- 模型自我描述属于生成内容，系统提示只能降低错误概率，无法绝对保证。

### Code Interpreter / Web Search 报不支持

- 先确认当前 `apiMode=responses`。
- 能否真正使用由第三方供应商决定。
- 保留网关的工具自动降级逻辑，避免因为一个不兼容工具导致普通文本对话完全失败。
- 不得宣称第三方能力与官方 Codex 完全一致。

### APK 下载到一半中断

- 下载服务必须保留 Range 请求处理。
- 验证 `Accept-Ranges: bytes`。
- 验证 Range 请求返回 `206` 和正确 `Content-Range`。
- 手机浏览器仍反复失败时，可在同一局域网换浏览器，或通过 USB/本地文件传输安装 APK；无需为了 LAN 测试强制部署公网服务器。

---

## 8. 已知限制与下一步优先级

### P0：每次新版必须真机回归

当前 1.1.3 已完成自动化和构建验证，但每次安装到用户真机后仍应回归：

1. 选择图片后，附件预览可见。
2. 键盘弹出时，输入框文字、附件预览和发送按钮全部可见。
3. 点击键盘“发送”会发送一次且仅一次。
4. 图片可上传、发送后可在消息中显示，并能被模型读取。
5. 图片首次加载失败时，点按图片区域可以重试。
6. PDF 可上传并被兼容模型读取。
7. 快速切换两个对话时，两个生成任务互不串线。
8. 局域网短暂断开时，错误提示准确且 partial 内容不丢失。

### P1：生产化

- 部署固定域名的 HTTPS/WSS 网关。
- 正式 Android release keystore，不再使用 debug signer。
- 使用 EAS 或 macOS/Xcode 生成签名 iOS IPA。
- 数据库、上传文件和 `SERVER_MASTER_KEY` 的加密备份与恢复演练。
- 生产日志轮转、监控、崩溃收集和告警。

### P1：可靠性

- 继续测试大图片、25 MB 边界、慢 Wi-Fi、后台切换和上传取消。
- 为聊天流增加更完整的网络故障回归测试。
- 在 UI 中显示附件逐个上传进度和失败文件名称。
- 检查第三方服务对工具、图片和 PDF 的实际能力矩阵。

### P2：体验候选项

以下是候选方向，不代表已经完成或承诺：

- 服务端同步对话历史，多设备登录后恢复。
- 更细粒度的工具调用状态和结果展示。
- 相机拍照、文件管理和附件重试。
- 消息搜索、导出、收藏和对话归档。
- 语音输入/播放。
- 管理员用量、限额和审计页面。

---

## 9. 修改完成后的固定交接清单

任何后续助手完成一轮工作后，都要更新本文件，并记录：

1. 修改日期和新版本号。
2. 用户报告的问题。
3. 根因。
4. 修改过的关键文件。
5. 新增/修改的测试。
6. `npm run verify` 结果。
7. APK/IPA/Web 构建结果。
8. 新产物路径、包名、versionCode/versionName 和 SHA-256。
9. 当前运行地址和健康检查。
10. 尚未解决的问题与下一步建议。
11. 严格确认没有在文档中写入任何秘密。

### 版本升级规则

- 小修复：`1.1.2 → 1.1.3`，Android versionCode `4 → 5`。
- 新功能：按语义化版本升级。
- Android 每一个可安装新包都必须提高 versionCode。
- 下载服务的 APK 文件名必须和真实产物一致。
- 覆盖安装包必须保持相同 applicationId 和签名证书。

---

## 10. 最近一次交接记录

### 2026-08-31：管理员默认账户、注册和聊天模型设置

- 网关配置新增默认管理员邮箱、密码、显示名称和自动创建开关；生产环境可通过环境变量覆盖。
- 保留注册、登录和管理员初始化流程，密码最小长度统一为 8 位。
- 管理员模型测试支持使用当前表单草稿直接获取模型，确认后再保存。
- 普通用户在托管网关模式下不再自由编辑模型 ID，只能从管理员发布的模型中选择。
- 聊天页顶部新增模型控制条和设置弹窗，可修改模型、推理强度与回答详略。
- 本次修改完成后必须重新运行 `npm run typecheck`、`npm run test`、`npm run lint` 和 `npm run build`。

### 2026-08-24 / 1.1.3

用户真机报告：

- 键盘弹出后附件预览能看到，但输入框和输入文字被键盘挡住。
- 图片上传与模型识图成功，但发送后的图片消息只显示灰色占位。

根因：

- 网关日志显示 `POST /v1/files` 返回 201，但图片读取 `GET /v1/files/{attachmentId}` 返回 401；该 Android 环境没有可靠携带 React Native `<Image source.headers>` 中的 Authorization Header。
- Manifest 的原生 `adjustResize` 与 `KeyboardAvoidingView behavior="height"` 同时生效，发生重复键盘避让。

修改：

- 新增 `apps/mobile/src/services/gatewayImageCache.ts`。
- 修改 `apps/mobile/src/components/MessageBubble.tsx`，通过认证下载、本地缓存、完整性检查、加载状态和点按重试显示图片。
- 修改 `apps/mobile/src/screens/ChatScreen.tsx`，Android 仅依赖 `adjustResize`，iOS 使用 `padding`。
- 新增 `apps/mobile/test/gatewayImageCache.test.ts`。
- 修改 LAN 构建、下载服务和启停脚本，自动跟随版本文件名并可靠清理旧端口进程。
- 仓库版本升级到 1.1.3，Android versionCode 和 iOS buildNumber 升级到 5。

验证：

- Mobile 7 个测试文件 / 26 项测试通过。
- Gateway 6 个测试文件 / 22 项测试通过；总计 48 项。
- TypeScript、ESLint 和 Android LAN Gradle 构建通过。
- APK v2 签名、包名、版本、ARM64 ABI、cleartext LAN、`adjustResize` 和预置网关地址验证通过。
- 新旧 LAN APK 的签名证书一致，可覆盖安装并保留 App 数据。
- 下载服务 HEAD、`Accept-Ranges: bytes` 和 Range `206 Partial Content` 验证成功。

产物：

```text
E:\gptapp\artifacts\NovaChat-1.1.3-android-arm64-lan.apk
大小：35,272,021 bytes
SHA-256：04311D719383EDA2A5E16E277E66FACDAD3DFD596D7C0F7F2B37EE6F988A9DEE
包名：com.novachat.mobile.lan
versionCode：5
versionName：1.1.3-lan
```

当前局域网交付地址（使用前仍需重新检查电脑 IP 和服务状态）：

```text
网关：http://192.168.0.113:8787
APK 下载页：http://192.168.0.113:8790
```

下一步：在用户 Android 真机直接覆盖安装 1.1.3，完成本文件第 8 节的 P0 回归；不需要卸载旧版。

### 2026-08-24 / 1.1.2

用户真机报告：

- 添加图片后弹出“无法连接服务器”。
- 安卓键盘弹出后输入框被完全遮住。
- 键盘回车不能发送。

根因：

- 图片选择成功，但 React Native `fetch + FormData + 本地 URI` 在请求发出前失败，因此网关日志中没有 `POST /v1/files`。
- Android `KeyboardAvoidingView` 的 behavior 原来是 `undefined`。
- 多行 TextInput 的回车默认插入换行，没有绑定 submit。

修改：

- `apps/mobile/src/services/gatewayApiClient.ts`
- `apps/mobile/src/services/gatewayUploadResponse.ts`
- `apps/mobile/src/components/Composer.tsx`
- `apps/mobile/src/screens/ChatScreen.tsx`
- `apps/mobile/test/gatewayUploadResponse.test.ts`
- `apps/mobile/package.json`
- 版本和 LAN 构建/下载脚本

验证：

- 45 项自动化测试通过。
- TypeScript 和 ESLint 通过。
- Android ARM64 LAN APK 构建成功。
- 包名、versionCode、versionName、cleartext LAN、`adjustResize`、预置网关地址和 v2 签名均验证。
- 新旧 LAN APK 的签名证书摘要一致，支持覆盖安装。
- 下载服务 HEAD 和 Range 206 验证成功。

产物：

```text
E:\gptapp\artifacts\NovaChat-1.1.2-android-arm64-lan.apk
SHA-256：11B4D758AF976A54B04002825E4C7176F7FF1C6F96E9E5C62352AFD235390120
```

下一步：安装到用户 Android 真机，完成本文件第 8 节的 P0 回归项目。

### 2026-09-01 / 1.1.7：生图无图片返回、旧网关进程和 LAN APK

用户反馈：

- 选择 `gpt-image-2` 并发送“生成一张亚洲美女照片”后，助手只返回“已生成……风格”的文字，没有图片。
- 之前还出现过“无法连接服务”和图片附件在 REST 回退路径丢失的问题。

根因与修复：

- 本次排查发现：旧网关进程约在 10:20 启动，而包含生图路由的最新 `dist` 直到 11:41 才构建；`scripts/start_lan_gateway.ps1` 原先发现 8787 已有健康网关时只复用旧进程，不会自动重启。因此截图请求实际命中了旧代码，被当作普通文字对话处理，模型只能返回文字描述。
- 已重启网关并确认最新进程当前为 PID 45152，启动时间为 2026-09-01 11:58:49；本机和局域网 `/health` 都返回 `ok: true`、`apiMode: responses`、默认模型 `gpt-5.6-sol`。
- `services/gateway/src/provider.ts` 已按生图意图和 `gpt-image-*` 模型选择 `/images/generations`，解析 Base64、data URL 和远程 URL，保存为网关附件，并通过 WebSocket/REST 返回附件引用；图片模型和文本模型分开降级。
- `apps/mobile/src/services/chatClient.ts` 的 REST fallback 已补传 `data.attachments`，WebSocket 不可用时不会再把生成图片丢掉。
- `scripts/start_lan_gateway.ps1` 新增 `-Restart` 参数。代码或 `dist` 更新后执行 `.\scripts\start_lan_gateway.ps1 -GatewayHost 192.168.0.113 -Restart` 以停止旧进程、重新构建并启动最新网关；普通启动仍复用健康进程。

模型、托管和参数边界：

- 管理员点击“获取模型”时，网关会从当前草稿配置的 `/models` 读取完整去重模型 ID 列表并立即发布；普通用户的“对话设置”从 `/v1/models` 读取这份已发布列表。列表是否包含所有模型取决于第三方 `/models` 返回内容以及管理员发布时的实际配置，不能由客户端凭空补出模型。
- Key 的 `/models` 里出现 `gpt-image-*` 不等于该 Key 有图片生成权限，也不等于服务商实现了 `/images/generations`；生图失败时应查看结构化错误中的权限、接口、限流或返回格式原因。
- 当前移动端实际只有统一 Gateway 模式：App 登录 Nova 网关，第三方 Base URL、Key、协议和允许模型由管理员统一维护。工作区中不存在 `apps/mobile/src/services/directApiClient.ts`，不要在后续交接中把“高级直连”描述成当前已实现功能。
- “推理强度”和“回答详略”会按第三方协议兼容性发送：Responses 使用 `reasoning.effort` / `text.verbosity`；Chat Completions 仅对看起来支持推理的模型发送 `reasoning_effort`，不发送通用性不足的 `verbosity`；图片请求不发送推理参数；不支持参数时会移除后重试。UI 的 `xhigh`/`max` 映射为兼容的 `high`。

本轮修改的关键文件：

- `services/gateway/src/server.ts`：修复管理员模型测试的请求取消生命周期，并保留草稿配置测试。
- `services/gateway/src/provider.ts`：模型目录解析、图片生成路由、图片/文本分组降级、流式错误识别、reasoning/verbosity 兼容重试。
- `apps/mobile/src/services/chatClient.ts`：REST fallback 返回图片附件引用。
- `scripts/start_lan_gateway.ps1`：新增安全的显式 `-Restart` 机制，避免更新代码后误用旧进程。
- `apps/mobile/src/screens/AdminScreen.tsx`、`SettingsScreen.tsx`、`ChatScreen.tsx`、`ChatOptionsModal.tsx`：完整模型目录展示、自动选择有效模型、对话设置和生图入口。
- `services/gateway/test/provider.test.ts` 及现有移动端测试：覆盖图片路由、图片/文本降级、参数映射、流式错误和附件缓存等行为。

验证结果（2026-09-01）：

- `npm run typecheck`：通过（mobile、gateway、protocol）。
- `npm run test`：通过，Mobile 6 个测试文件 / 15 项测试；Gateway 6 个测试文件 / 26 项测试。
- `npm run lint`：通过（mobile、gateway）。
- `npm run build`：通过（protocol、gateway）。
- 已重新生成包含 REST 附件修复的 Android ARM64 局域网测试 APK：`E:\gptapp\artifacts\NovaChat-1.1.7-android-arm64-lan.apk`；预置网关为 `http://192.168.0.113:8787`，大小 35,290,421 bytes，SHA-256 为 `0FFBAA1F27861F24860DE74F783FF59E35763239DCA665CC0AC909404E206517`。该包允许可信局域网明文 HTTP，仅供测试使用。
- 下载服务 `http://192.168.0.113:8790/` 正常；APK HEAD 返回 200、`Content-Length: 35290421`、`Accept-Ranges: bytes`，Range `bytes=0-1023` 返回 206。

尚未完成：

- 尚未在用户真实 Android 设备上重新回归登录、完整模型列表、自动生图、图片显示、PDF、弱网和多对话切换；第三方服务对每个图片模型的真实权限仍需用用户实际 Key 做端到端验证。
- 如果重新安装/更新 APK、确认手机和电脑在同一 Wi-Fi 后仍无图，下一步应查看网关对该请求返回的结构化图片错误；不能仅凭“已生成”文字判断图片接口成功。


### 2026-09-01 / 1.1.8：重新打包、图片回归和长上下文

用户继续反馈：

- 生图请求仍没有返回图片，怀疑没有重新打包。
- 长对话聊到一定长度后无法继续，希望接近 Codex 的长上下文体验。

本轮处理：

- 修复原生 Android 版本同步，并重新构建 `NovaChat-1.1.8-android-arm64-lan.apk`。
- 已通过 `npm run verify`：Mobile 6 个测试文件 / 15 项测试，Gateway 6 个测试文件 / 28 项测试，TypeScript 和 ESLint 全部通过。
- 已通过 `npm run build`：protocol 和 gateway 构建通过。
- 已通过 Android LAN Gradle 构建；APK 元数据为：
  - 包名：`com.novachat.mobile.lan`
  - versionCode：`10`
  - versionName：`1.1.8-lan`
  - ARM64 LAN 测试包，允许可信局域网明文 HTTP
- 当前 APK 大小为 35,291,245 bytes，SHA-256 为 `0312525EF4D52AB9692FD020E0DBC645687244ED6DEC8D8840F4F3941C6AFF78`。
- 下载服务已经指向 1.1.8 产物；HEAD 返回 HTTP 200，Content-Length 为 35,291,245，支持 HTTP Range。
- 当前网关健康检查（本机和局域网地址）均返回 `ok: true`、`service: nova-chat-gateway`、`apiMode: responses`、默认模型 `gpt-5.6-sol`。
- 当前实际发布模型为 13 个，包含 `gpt-image-1`、`gpt-image-1.5`、`gpt-image-2`；图片模型是否可用仍取决于第三方 Key 的权限和接口实现。
- 已完成 `gpt-image-2` 真实端到端生图验证：HTTP 200、1 个 PNG 附件、网关授权文件读取 HTTP 200。

交付地址（当前局域网）：

```text
APK 下载页：http://192.168.0.113:8790
APK 直链：http://192.168.0.113:8790/NovaChat-1.1.8-android-arm64-lan.apk
网关健康检查：http://192.168.0.113:8787/health
```

安装说明：

1. 手机和电脑连接同一个 Wi-Fi。
2. 下载并安装 1.1.8 LAN APK；若系统不允许覆盖安装，先卸载旧 LAN 版本再安装。该包使用相同调试签名，正常情况下可直接覆盖安装。
3. 安装后确认 App 显示/预置网关为 `http://192.168.0.113:8787`。
4. 如果仍显示旧界面，说明手机没有实际装上新包；检查 Android 应用信息中的 versionName 是否为 `1.1.8-lan`。
5. 如果仍提示无法连接，先确认手机能访问 `192.168.0.113`，电脑上的 8787 网关和 8790 下载服务保持运行。

严格确认：本次记忆记录没有写入任何 API Key、Session Token、管理员密码、初始化口令、`SERVER_MASTER_KEY` 或 `.env` 真实内容。


### 2026-09-01 / 1.1.9：后台生成、自动生图与键盘滚动修复

用户继续反馈：

- App 退到后台后生成任务应继续执行，回到前台后不能丢失文本或图片结果。
- 选择文本模型时，生图请求应自动内部调用图片模型；图片模型不可用时应按优先级降级。
- 推理强度选项需要与实际协议一致，旧版“最大”设置需要兼容迁移。
- Android 键盘弹出、输入框变高或正在打字时，聊天记录应像微信一样自动上移，保证能看到当前消息和输入区域附近的历史内容。

本轮处理：

- 网关在 WebSocket 断开后继续执行生成任务，并保留任务结果约 30 分钟。
- 新增后台任务查询与取消接口：`GET /v1/chat/jobs/:requestId`、`POST /v1/chat/jobs/:requestId/cancel`。
- 移动端断线后轮询任务状态，支持增量文本、完整文本快照恢复、usage/model 信息和图片附件恢复；取消操作在断线时也走 REST 接口。
- 文本模型触发生图意图时自动优先调用 `gpt-image-2`，并按已配置的图片模型顺序降级；自动路由不会覆盖用户当前选择的文本模型。
- 旧版 `reasoningEffort: "max"` 迁移为 `xhigh`；UI 使用“无、低、中、高、极高”，请求层继续兼容旧值并按协议映射。
- 修复 Android 键盘布局变化后消息列表未上移的问题：输入框聚焦、键盘显示、输入框高度变化及布局变化时分阶段滚动到最新消息，并恢复底部跟随。
- 修复 LAN 下载服务仍提供旧 APK 的问题，重启服务后已切换到 1.1.9。
- Android LAN APK 版本升级为 `1.1.9-lan`，versionCode `11`，包名 `com.novachat.mobile.lan`，ARM64 测试包。

验证结果（2026-09-01）：

- `npm run verify`：通过。
- `npm run build`：通过。
- 网关健康检查：`http://192.168.0.113:8787/health` 返回 `ok: true`。
- 下载服务健康检查：`http://192.168.0.113:8790/health` 返回 `ok: true`。
- APK HEAD 请求返回 HTTP 200，Content-Length `35,297,169` bytes，支持 Range 下载。
- APK：`E:\gptapp\artifacts\NovaChat-1.1.9-android-arm64-lan.apk`。
- SHA-256：`AFC780856D27CCBB8F5288320E19EE8DEDEC1044E2CCA933CD3CB3F619E4CA55`。
- 下载页：`http://192.168.0.113:8790`。
- APK 直链：`http://192.168.0.113:8790/NovaChat-1.1.9-android-arm64-lan.apk`。

安全记录：本次记忆没有写入任何 API Key、Session Token、管理员密码、初始化口令、`SERVER_MASTER_KEY` 或真实 `.env` 内容。

### 2026-09-01 / 1.1.10：自动生图、头像显示与乱码修复

用户继续反馈：

- 即使选择文本模型，输入“生成照片/生照片/做头像/生成壁纸”等指令时仍希望自动调用图片模型。
- 头像上传后个人资料区没有正常显示；原先头像附件读取会出现鉴权失败。
- 个人资料名称、头像 initials 等位置出现黑色菱形问号（Unicode replacement character）乱码。
- 修复后需要重新打包 APK，并让下载服务提供最新包。

本轮处理：

- 扩大中文生图意图识别范围，支持“生成照片”“帮我生成一张照片”“做一个头像”“给我做一张壁纸”“生照片”“生成一张猫的图片”等自然表达。
- 增加否定/询问保护： “不要生成图片”“为什么不能生成照片”“怎么生成头像”不会误触发生图；“不要文字，生成一张照片”仍会正确进入图片生成路由。
- 文本模型继续负责普通对话；检测到生图意图后，网关内部自动调用 `/v1/images/generations`，优先使用 `gpt-image-2`，失败后按 `gpt-image-1.5`、`gpt-image-1` 降级，不要求用户手动切换模型。
- 头像改为使用带 `Authorization: Bearer <session token>` 的文件下载请求，下载到本地缓存后渲染本地 `file://` URI；新选择的头像仍立即使用本地预览。头像附件缺少服务端 `size` 时，只要本地缓存文件存在且非空即可复用，不再错误拒绝。
- 新增用户名称规范化：检测空字符串、U+FFFD（`�`）和典型 `ï¿½` 乱码；管理员回退为“管理员”，普通用户回退为邮箱 `@` 前的部分；正常中文名不改写。资料保存时若仍含乱码会提示重新输入，避免把乱码再次写回服务端。
- 相关修复已接入登录、注册、当前用户、资料更新、头像上传、设置、管理员用户列表和头像组件。
- Android LAN 版本升级为 `1.1.10-lan`，versionCode `12`，包名 `com.novachat.mobile.lan`，ARM64 测试包；已重新打包，避免手机继续使用旧版 JS bundle。

验证结果（2026-09-01）：

- `npm run verify`：通过（TypeScript、Mobile 7 个测试文件 / 20 项测试、Gateway 6 个测试文件 / 37 项测试、ESLint）。
- `npm run build`：通过（protocol、gateway）。
- Android LAN Gradle 构建：通过，APK 已生成。
- 网关健康检查：`http://192.168.0.113:8787/health` 返回 `ok: true`，`apiMode: responses`，默认模型 `gpt-5.6-sol`。
- 下载服务健康检查：`http://192.168.0.113:8790/health` 返回 `ok: true`。
- APK：`E:\gptapp\artifacts\NovaChat-1.1.10-android-arm64-lan.apk`。
- APK 大小：`35,300,797` bytes。
- SHA-256：`EF87FE76A5A5AA3EBBC6A235E599E914ED62579DDEDA4E1CCF3E8578C119E0BE`。
- APK HEAD 请求返回 HTTP 200、`Content-Length: 35300797`，并支持 Range 下载；下载服务已重启并切换到 1.1.10。
- 下载页：`http://192.168.0.113:8790`。
- APK 直链：`http://192.168.0.113:8790/NovaChat-1.1.10-android-arm64-lan.apk`。

安装/使用提示：

1. 手机和电脑连接同一个 Wi-Fi。
2. 打开下载页或 APK 直链，安装 `1.1.10-lan`；如不能覆盖安装，先卸载旧 LAN 包再安装。
3. 安装后确认网关为 `http://192.168.0.113:8787`。
4. 选择任意文本模型后直接输入“生成一张照片：……”即可；网关会内部选择图片模型并在失败时降级。图片模型是否最终可用仍取决于当前 Key 的图片接口权限和服务商实现。

安全记录：本次记忆没有写入任何 API Key、Session Token、管理员密码、初始化口令、`SERVER_MASTER_KEY` 或真实 `.env` 内容。

补充端到端验证（使用本机现有配置，输出已避免包含敏感凭据）：

- `node .run/verify_live_image_gateway.mjs`：通过。
- `/v1/models` 返回 HTTP 200，共 13 个已发布模型，包含 `gpt-image-2`。
- 发送中文“生成一张简单的蓝天白云插画，画面干净，不要文字”时，网关返回 HTTP 200，实际响应模型为 `gpt-image-2`，返回 1 个 PNG 图片附件。
- 该附件通过带鉴权的 `/v1/files/<id>` 读取返回 HTTP 200，PNG 文件签名正确；说明自动生图和图片回传链路已在网关端闭环验证。


### 2026-09-02：生成中追问、图片续作与上下文修复

用户反馈：回答生成期间无法继续发送；生成照片后说“[Image #1]”“这张不满意”“我要全身的”等要求仍被当作普通文本；历史图片和上下文记忆不稳定。

本轮修改：

- 移动端 Composer 在回答生成期间不再锁定输入；有新文本或附件时发送按钮优先发送新请求，输入为空时才显示停止。
- ChatScreen 按 `requestId` 保存多个活动生成任务，同一对话可并行发送追问；delta、完成、取消和错误都按原对话及 assistant message ID 写回。
- 完成的图片助手消息（包括无文字、只有图片附件的消息）会进入客户端和协议层上下文裁剪；未完成的图片消息仍会排除。
- 网关识别“生照片”、自然语言生图和图片修改意图；存在历史图片时，“不满意、改成全身、换背景、再来一张”等追问自动调用 `/images/generations`。图片 prompt 会带上原始创作要求、之前修改和本次修改。
- 普通视觉问题会将历史助手图片转换为 `input_image`/`image_url` 输入，不再把非法 `attachments` 字段放到 assistant 消息中；失效的历史图片引用会被忽略，不阻断普通文本请求。
- 当前图片续作采用跨服务商兼容的文字重建方式，尚未统一使用 multipart `/images/edits`，因此具体保真度仍取决于图片服务商。

验证结果（2026-09-02）：`npm run typecheck --workspaces --if-present`、`npm run test --workspaces --if-present`（Mobile 7 个测试文件 / 22 项测试，Gateway 6 个测试文件 / 40 项测试）、`npm run lint --workspaces --if-present`、`npm run build` 和 `npm run verify` 均通过。未重新构建 APK。

### 2026-09-03：回答模型归属、模型切换竞态与停止生成修复

用户反馈回答流程和模型切换不稳定，并要求一并排查其他明显问题。

本轮定位与修复：

- 修复旧回答完成后覆盖用户新模型选择的竞态：服务端返回的实际响应模型不再写回全局设置，用户手动选择只影响后续发送。
- 每条 assistant 消息新增可选的 `requestedModel` 和 `model` 元数据；发送和重新生成时冻结请求模型，完成时保存网关实际使用的模型。消息气泡会显示正在使用、请求模型或“实际模型 / 原选模型”，自动降级和图片模型路由不再看起来像串模型。
- 修复模型目录 effect 依赖当前模型导致每次切换都重拉 `/v1/models` 的问题；目录请求失败时保留已有模型，不再退化成单一模型，打开对话设置时会主动重试，并用最新设置处理异步响应。
- 修复空 body 的 POST/DELETE 请求仍携带 `Content-Type: application/json`，被 Fastify 5 以 `FST_ERR_CTP_EMPTY_JSON_BODY` 拒绝的问题。停止生成、登出、删除头像和无参数 Provider 测试现在不会发送错误的 JSON Content-Type。
- 阻止同一条 streaming assistant 消息被重复“重新生成”，并在启动前增加活动任务去重，避免两个请求的 delta 写入同一消息。
- 对活动生成任务增加消息级清理：对话被删除、重新生成截断后消息消失或消息不再 streaming 时，会取消并移除对应后台任务，避免孤儿请求继续运行。
- 修正生成启动失败后的提示和 Composer 行为：消息已经写入历史时会清空输入，避免用户再次点击造成重复发送；错误文案不再错误声称“当前对话已有回复正在生成”。
- 清理 Mobile Vitest 配置中重复的 `expo/file-system` alias。

新增回归覆盖：

- bodyless POST/DELETE 不携带 JSON Content-Type，而有 JSON body 的登录请求仍正确设置。
- 模型切换后旧回答完成不会改变新选择，消息会保留请求模型和实际模型。
- 重新生成会冻结当时的新模型并拒绝重复重新生成。
- 回答气泡的模型标识覆盖正常、生成中和实际降级场景。

验证结果（2026-09-03）：

- `npm run verify`：通过。
- Mobile：10 个测试文件 / 29 项测试通过。
- Gateway：6 个测试文件 / 40 项测试通过。
- Mobile、Gateway、Protocol TypeScript 检查通过；Mobile、Gateway ESLint 通过。
- `npm run build`：通过（Protocol、Gateway）。
- 本轮未重新构建 Android APK。

安全记录：本次记忆没有写入任何 API Key、Session Token、管理员密码、初始化口令、`SERVER_MASTER_KEY` 或真实 `.env` 内容。

### 2026-09-03：移动 App 对话页重设计、附件入口与 durable job 恢复

用户要求继续缩小与 Codex/豆包类移动对话体验的差距，重点改进 App 页面、模型下拉选择、默认思考强度、拍照/相册/文件入口和后台回答可靠性。

本轮完成：

- 聊天页删除原来的顶部“当前模型”大卡片；导航栏标题改为 `Nova + 当前思考强度 + 下拉箭头`，点击后打开“模型与回答方式”弹窗。模型 ID 只在弹窗/设置页中显示，不再占用对话页首屏。
- “模型与回答方式”弹窗改成原生移动端分组卡片设计：支持模型搜索、明显的模型选中态、完整中文思考档位、回答详略，并明确标注“中等思考”为默认值。设置页的思考档位文案同步改为“直接、轻度、中等、深度、高强度”。
- 新安装/无有效旧设置时继续默认 `reasoningEffort: medium`；不会强制覆盖用户以前主动保存的其他思考档位。旧 `max` 仍安全迁移为 `xhigh`。
- Composer 改成移动 App 风格：横向思考/网页搜索/代码工具快捷条，圆角浮动输入框，独立停止按钮、附件加号和发送按钮。回答生成时仍可输入并发送下一条消息，停止操作不会占用发送入口。
- 新增附件托盘和直接拍照入口：相机、相册、文件三项均可触达；最多 8 个附件，单个 25 MB。附件能力已在 1.1.12 扩展为常见图片、PDF、文本/代码、Office/OpenDocument、EPUB/MOBI 等；界面不再展示完整支持格式列表，由网关负责真实类型校验。
- 新增相机权限申请和 `launchCameraAsync` 流程，并复用图片 MIME、名称、大小和格式校验。`app.json` 不再阻止 Android CAMERA 权限，加入 Expo ImagePicker 的照片/相机中文权限说明，同时显式关闭麦克风权限；当前没有伪造语音或电话功能。
- 空对话页改为更轻量的 Nova 标识、推荐问题和“拍照提问或识别内容”入口；空状态现在可纵向滚动，避免小屏设备被 Composer 挤压后内容溢出。
- assistant 消息继续保存请求模型与实际模型，并新增/保留 durable generation 元数据：`generationRequestId`、冻结的思考/详略/token/工具选项、开始时间和完成时间。每轮发送及重新生成都绑定当时选择的模型与选项，旧回答完成不会覆盖用户后来选择的模型。
- App 重启/重新 hydration 后，带 durable request ID 的 streaming 消息会轮询 Gateway job 并重新附着；支持增量快照、完整文本替换、完成、取消、失败和 job 过期。页面卸载只 `dispose()` 本地监听，不取消服务器任务；用户明确停止或删除仍在生成的对话时才会取消 Gateway job。
- assistant 回答增加可折叠详情：请求模型、实际模型、是否发生网关切换、思考强度、回答详略、工具、输出 token 上限、token 用量、耗时和短任务 ID。回答详情及复制/重新生成按钮扩大触控区域，摘要文字不再抢占点击手势。
- 历史页支持同时搜索标题与消息正文，显示总数、搜索结果数和后台生成数；每条记录显示摘要、消息数、生成状态、更新时间和当前对话标记，并增加跨平台重命名与删除操作。修复三点菜单点击冒泡导致误打开对话、点击 action sheet 内部可能误关闭的问题。
- 对话标题重命名会合并多余空白、拒绝空标题并限制 80 字符。

验证结果（2026-09-03，Asia/Shanghai）：

- `git diff --check`：通过；仅有 Windows 下 LF/CRLF 转换提示，没有空白错误。
- `npx expo config --type public`：通过；Expo SDK 57 配置、相机/照片权限插件解析成功。
- `npx expo export --platform android`：通过；Metro 成功打包 1316 个模块并生成 Android Hermes bundle。
- `npm run verify`：通过。
- Mobile：11 个测试文件 / 39 项测试通过。
- Gateway：6 个测试文件 / 40 项测试通过。
- Mobile、Gateway、Protocol TypeScript 检查通过；Mobile、Gateway ESLint 通过。
- `npm run build`：通过（Protocol、Gateway）。
- 本轮未做真机像素级截图验收；后续仍需在 360px 左右手机、深浅色和软键盘场景完成真机点按回归。
- 发现仅修改 `app.json` 尚未同步到已存在的原生 Android Manifest：`apps/mobile/android/app/src/main/AndroidManifest.xml` 仍通过 `tools:node="remove"` 移除 CAMERA 权限。已改为显式声明 `android.permission.CAMERA` 并重新构建，避免“拍照”入口在安装包中无法取得相机权限。
- 已于 2026-09-03 11:09（Asia/Shanghai）重新构建并发布 `E:\gptapp\artifacts\NovaChat-1.1.11-android-arm64-lan.apk`，预置网关为 `http://192.168.0.113:8787`。
- APK 元数据：包名 `com.novachat.mobile.lan`，versionName `1.1.11-lan`，versionCode `13`，minSdk 24，targetSdk 36，仅含 `arm64-v8a`。
- APK 大小：`35,331,221` bytes；SHA-256：`7D48AAD69753AE89E3E590C5F3A020B845A42D07715DE02DEEE365CB63E9C3E9`。
- APK 权限复核：包含 `android.permission.INTERNET` 与 `android.permission.CAMERA`，不包含麦克风和旧式外部存储权限。
- `scripts/build_lan_android.ps1` 已加固：每次 LAN 构建前会同步被 Git 忽略的原生 Manifest 相机权限；构建后强制检查包名、版本、ARM64 架构、INTERNET/CAMERA 权限、无麦克风权限、APK 签名和 zipalign，任一不符合都会让构建失败，避免以后再次发布“名称是最新版但原生能力未同步”的测试包。
- 下载服务和网关健康检查均通过；直链 HEAD 返回 HTTP 200、`Content-Length: 35331221`、`Accept-Ranges: bytes`、`Cache-Control: no-store`。从 8790 完整下载后的 SHA-256 与本地构建产物完全一致。
- 当前手机下载直链：`http://192.168.0.113:8790/NovaChat-1.1.11-android-arm64-lan.apk`。

安全记录：本次记忆没有写入任何 API Key、Session Token、管理员密码、初始化口令、`SERVER_MASTER_KEY` 或真实 `.env` 内容。
### 2026-09-03：1.1.12 附件能力、字体和最新测试包

针对“文件种类太少、页面字体和移动端体验不够好、需要最新 APK 测试”的反馈，已完成并验证以下更新：

- 版本统一升级为 `1.1.12`：根项目、Mobile、Gateway、Protocol、Android `versionCode=14`、iOS `buildNumber=14`；`package-lock.json` 已同步。
- 附件支持扩展：JPEG、PNG、WebP、GIF、HEIC/HEIF、AVIF、BMP、TIFF；PDF；TXT/Markdown/CSV/TSV/JSON/JSONL/XML/HTML/CSS/JS/TS/Python/Java/Kotlin/C/C++/C#/Go/Rust/Ruby/PHP/Swift/Shell/SQL/YAML/TOML/RTF 等文本和代码；DOC/DOCX/DOT/DOTX/DOCM/DOTM、XLS/XLSX/XLT/XLTX/XLSM/XLTM、PPT/PPTX/PPS/POTX/PPTM/POTM/PPSX/PPSM；ODT/OTT、ODS/OTS、ODP/OTP；EPUB、MOBI。
- 网关增加真实文件签名校验、ZIP 解压大小限制，并支持从 Office/OpenDocument/EPUB/MOBI 提取文本；Chat Completions 对不能直接读取的文档返回通用降级提示，不再只针对 PDF。
- 移动端文件选择器使用 `*/*`，页面只显示附件数量和大小限制，不再在界面上堆叠“支持格式列表”；服务器仍会拒绝不安全或不支持的真实文件。
- 全局字体改为 Google Fonts 的 Manrope，并增加加载失败时的系统字体回退；主要页面、输入框、弹窗和消息组件已统一主题字体。
- 对话页移除重复的顶部当前模型大卡片，模型从 Nova 下拉入口选择；默认思考强度为“中等思考”。拍照、相册、文件入口均保留，并同步 Android 原生 CAMERA 权限。
- 已完成 `npm run verify`、`npm run build`、`npx expo export --platform android` 和 `git diff --check`；Mobile 11 个测试文件/39 项测试，Gateway 7 个测试文件/47 项测试全部通过。
- 最新 ARM64 LAN APK：`artifacts/NovaChat-1.1.12-android-arm64-lan.apk`；包名 `com.novachat.mobile.lan`；versionName `1.1.12-lan`；versionCode `14`；仅 `arm64-v8a`；预置网关 `http://192.168.0.113:8787`；包含 INTERNET/CAMERA 权限，不含 RECORD_AUDIO。
- APK 大小 `35,633,629` bytes；SHA-256：`C6E413D9E6D5C9C21E4BBA8B78C936EA0D0BB59DB6664B71391BEBA0E480216B`。
- 已重启局域网下载服务并切换到 1.1.12。手机下载地址：`http://192.168.0.113:8790/NovaChat-1.1.12-android-arm64-lan.apk`；HEAD 返回 HTTP 200、Content-Length `35,633,629`、支持 Range，完整下载校验与本地产物 SHA-256 一致。
- 本次未写入任何 API Key、Session Token、管理员密码、初始化口令、`SERVER_MASTER_KEY` 或真实 `.env` 内容。

> 本节关于 APK 和下载服务的记录 supersedes 之前 1.1.11 记录；以后每次功能或版本更新都要重新构建 APK、更新 `artifacts`、重启下载服务并同步本文件。

### 2026-09-03：1.1.13 会话独立性与并发生成隔离

针对“每个会话的内容必须独立、切换会话或模型不能互相影响、旧请求不能覆盖新回答”的反馈，已完成以下修复：

- 移动端生成回调统一按 `conversationId`、assistant 消息和 `requestId` 作用域写回；`appendAssistantDelta`、`replaceAssistantContent`、`completeAssistant`、`failAssistant`、`cancelAssistant` 会拒绝不匹配的旧请求，避免延迟回调污染新一代回答或其他会话。
- 正常生成、停止生成、重新生成、后台恢复任务以及恢复任务的完成/失败/取消回调全部接入同一套 requestId 校验。
- Durable generation 任务的查询和取消增加 `conversationId` 参数；网关会校验任务所属会话，错误会话返回 404，缺失或无效会话标识返回 `invalid_conversation_scope`，避免跨会话恢复或取消后台任务。
- WebSocket `cancel` 消息要求同时携带 `requestId` 和 `conversationId`，取消操作也受到会话作用域保护。
- 补充移动端和网关回归测试，覆盖两个会话互不影响、旧 requestId 不能修改新任务、错误会话恢复被拒绝，以及 durable job 查询/取消的会话参数校验。

验证结果：

- `npm run verify`：通过。
- `npm run build`：通过。
- Mobile：11 个测试文件、42 项测试通过；TypeScript 和 ESLint 通过。
- Gateway：7 个测试文件、48 项测试通过；TypeScript 和 ESLint 通过。
- 已重新导出 Android Hermes bundle 并重新构建最新版 ARM64 LAN APK。

最新版 APK：

- 文件：`artifacts/NovaChat-1.1.13-android-arm64-lan.apk`
- 包名：`com.novachat.mobile.lan`
- versionName：`1.1.13-lan`
- versionCode：`15`
- 架构：仅 `arm64-v8a`
- 预置网关：`http://192.168.0.113:8787`
- 权限：包含 INTERNET、CAMERA；不包含 RECORD_AUDIO
- 大小：`35,634,173` bytes
- SHA-256：`0848D61152E81C0A147D4210E05E4B64896028CA5ED2DD891E4FBB25C11515FC`
- 手机下载地址：`http://192.168.0.113:8790/NovaChat-1.1.13-android-arm64-lan.apk`

下载服务已切换到 1.1.13 后，需验证直链 HEAD 返回 HTTP 200、Content-Length 与 APK 大小一致、支持 Range，并校验完整下载文件的 SHA-256 与本地产物一致。

安全记录：本次记忆没有写入任何 API Key、Session Token、管理员密码、初始化口令、`SERVER_MASTER_KEY` 或真实 `.env` 内容。

下载服务补充验证（2026-09-03）：

- 已安全重启 `8790` 局域网下载服务，服务读取当前 `apps/mobile/app.json` 版本后已切换至 `1.1.13`。
- `http://192.168.0.113:8790/` 页面已列出 `NovaChat-1.1.13-android-arm64-lan.apk`。
- APK 直链 HEAD：HTTP 200；`Content-Length: 35,634,173`；`Accept-Ranges: bytes`。
- Range 请求 `bytes=0-15`：HTTP 206，`Content-Range: bytes 0-15/35634173`。
- 从下载地址完整下载后的文件大小为 `35,634,173` bytes，SHA-256 与本地产物一致：`0848D61152E81C0A147D4210E05E4B64896028CA5ED2DD891E4FBB25C11515FC`。
### 2026-09-04：账号隔离回归、注册开关/管理员/Token 测试与朋友下载包

- 复核移动端账号隔离：对话持久化按 `userId + serverUrl` 分桶；登录、登出或 `/v1/auth/me` 识别到不同账户时先清空可见本地状态；生成回调按 `conversationId + messageId + requestId` 校验，旧请求不能写入新会话。
- 新增网关回归覆盖：`REGISTRATION_ENABLED=false` 时公开注册返回 `registration_disabled`，已有管理员仍可登录；配置的 legacy `APP_ACCESS_TOKEN` 可鉴权 legacy 用户，错误 Token 返回 401，logout 不会把静态 legacy Token 误当作可撤销 Session。
- 定向测试：Gateway 管理员/注册开关/Token 18 项通过；Mobile 账号隔离与生成代际 8 项通过。
- `npm run verify`：通过；Mobile 12 个测试文件 / 44 项测试，Gateway 7 个测试文件 / 50 项测试，TypeScript 与 ESLint 均通过。
- `npm run build`：通过（Protocol、Gateway）。
- 已重新构建当前 1.1.13 ARM64 LAN APK，覆盖 `artifacts/NovaChat-1.1.13-android-arm64-lan.apk`；包名 `com.novachat.mobile.lan`，versionName `1.1.13-lan`，versionCode `15`，仅 `arm64-v8a`，预置网关 `http://192.168.0.113:8787`。
- APK 大小 `35,638,181` bytes；SHA-256：`3301FB0F50ABCF0085BF2F01E775AC8CC7B7B0690EBCB64E478573B107CB2689`；构建脚本已验证 INTERNET/CAMERA、无 RECORD_AUDIO、签名和 zipalign。
- 已准备仅包含当前 APK 的临时分享目录 `.run/friend-share`，并启动 Cloudflare Quick Tunnel。公网地址和 Token 只在当前交接消息中提供，不写入本文件；下载完成后执行 `powershell -ExecutionPolicy Bypass -File scripts\stop_download_tunnel.ps1`。
- 临时下载入口已验证：页面 HTTP 200；APK HEAD HTTP 200、Content-Length `35,638,181`、支持 Range；`bytes=0-15` 返回 206；完整公网下载文件 SHA-256 与本地产物一致。
- 该 APK 是 LAN 测试包，朋友即使能从公网下载，安装后仍需与 `192.168.0.113` 所在局域网连通，或在 App 设置中改为可访问的网关地址；当前 Quick Tunnel 仅用于 APK 下载，没有把 LAN APK 自动改成公网网关配置。

### 2026-09-04：共享图片服务账号的并发 429 排查与网关排队修复

- 运行日志确认用户截图中的 `Concurrency limit exceeded for account` 来自上游图片服务返回的 HTTP 429，而不是手机网络、Cloudflare Tunnel、用户本地账号或 Nova 自己的按用户并发限制。
- 原因是公网与局域网用户都使用管理员在同一个 Gateway 中配置的同一第三方 API Key；上游按 provider account 计算图片并发，所以一个用户正在生成图片时，另一个用户可能撞到账号级并发上限。稍后名额释放后另一请求又会成功，因此会出现“朋友失败、我们能用”的时间差。
- Gateway 新增共享图片请求 FIFO 信号量，默认 `MAX_CONCURRENT_IMAGE_REQUESTS=100`：同一 Gateway 最多允许 100 个图片请求同时进入上游；文字请求不受该队列影响，等待中的请求支持 AbortSignal 取消，取消后不会占用名额。当前上游账号已确认支持高并发，因此生产 `.env` 已设置为 100；如果服务商配额变化，应按实际配额调小。
- 上游并发 429 现在映射为 `provider_concurrency_limited` 和中文可重试提示，不再把英文错误原样显示给用户。
- 即使有 Gateway 之外的程序共用同一 Key，图片请求仍会按 `Retry-After` 或 5 秒、10 秒的有限退避自动重试；重试次数与最大等待可通过环境变量调整，默认只重试 2 次，避免无限放大请求和计费。
- 新增回归测试覆盖：并发错误中文映射、同一图片模型自动重试、不同用户共享账号时不并发调用上游、排队请求可取消、AsyncSemaphore 释放与取消、配置默认值。
- `npm run verify` 通过：Mobile 12 个测试文件 / 44 项测试；Gateway 7 个测试文件 / 58 项测试；所有 workspace TypeScript 与 ESLint 均通过。
- 最新 Gateway 已构建并重启；本机、局域网、公网 `/health` 均返回正常，公网注册开关仍为启用，Gateway stderr 为空。公网 Tunnel、局域网下载服务和公网下载服务未被重启或冲突。
- 本次仅修改服务端 Gateway；已经安装公网 APK 的朋友无需重新下载或重新配置，继续使用原公网地址即可自动获得排队与重试修复。

安全记录：本次记忆没有写入任何 API Key、Session Token、管理员密码、初始化口令、下载 Token、`SERVER_MASTER_KEY` 或真实 `.env` 内容。

### 2026-09-04：GitHub 公共发布整理

- 重写 `README.md`：增加中英文项目定位、功能矩阵、快速开始、生产部署、下载安全、分享和贡献入口，明确 Nova Chat 是第三方开源客户端，不是 OpenAI/ChatGPT/Codex 官方产品。
- 增加根 `package.json` 的 description、repository、homepage、issues 和 keywords，帮助代码托管平台与开发工具正确识别项目。
- 增加 `CONTRIBUTING.md` 以及 GitHub Bug/Feature Issue 表单，方便新用户反馈和贡献。
- 已完成本地验证：`npm run verify`（Mobile 44 项测试、Gateway 58 项测试、TypeScript、ESLint）通过；`npm run build` 通过。
- APK 继续保持不提交进 Git 历史，公开分发应使用 GitHub Releases 或支持 HTTPS/Range 的对象存储；不要分享包含局域网地址、临时 Tunnel 或秘密信息的测试包。

安全记录：本次记忆没有写入任何 API Key、Session Token、管理员密码、初始化口令、下载 Token、`SERVER_MASTER_KEY` 或真实 `.env` 内容。
