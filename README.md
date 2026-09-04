# Nova Chat

<p align="center">
  <strong>把 OpenAI-compatible 模型带到手机上</strong><br>
  自托管 · 多用户 · Android / iOS · 图片与附件 · 安全网关
</p>

<p align="center">
  <a href="https://github.com/dyhxxs/nova-chat">项目主页</a> ·
  <a href="https://github.com/dyhxxs/nova-chat/releases">下载 Releases</a> ·
  <a href="https://github.com/dyhxxs/nova-chat/issues">反馈问题</a> ·
  <a href="https://github.com/dyhxxs/nova-chat/discussions">交流讨论</a>
</p>

<p align="center">
  <a href="https://github.com/dyhxxs/nova-chat/actions/workflows/ci.yml"><img src="https://github.com/dyhxxs/nova-chat/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://github.com/dyhxxs/nova-chat/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://github.com/dyhxxs/nova-chat"><img src="https://img.shields.io/github/stars/dyhxxs/nova-chat?style=flat" alt="GitHub stars"></a>
  <a href="https://github.com/dyhxxs/nova-chat/network/members"><img src="https://img.shields.io/github/forks/dyhxxs/nova-chat?style=flat" alt="GitHub forks"></a>
</p>

<p align="center"><a href="#中文说明">中文</a> · <a href="#english">English</a></p>

> 当前源码版本：**1.1.13**。欢迎 Star、Fork、提交 Issue，并把项目分享给需要“自建模型服务 + 手机聊天”的朋友。

## 中文说明

### 这是什么？

**Nova Chat** 是一个开源、自托管、多用户的 Android/iOS AI 聊天客户端。它把手机 App、一个负责认证和安全配置的 Gateway，以及任意兼容 OpenAI API 的第三方模型服务连接起来：

```text
Android / iOS App
       │ HTTPS / WSS
       ▼
Nova Gateway（账号、权限、限流、附件、模型配置）
       │
       ▼
OpenAI-compatible Responses / Chat Completions API
```

管理员只需要在 Gateway 中配置第三方 API Base URL、API Key、协议和允许使用的模型；普通用户只使用 Nova 的服务器地址、账号和密码，不需要接触上游 Key。

> **重要声明**：Nova Chat 是第三方开源客户端，不是 OpenAI、ChatGPT、Codex 或任何模型供应商的官方产品。第三方服务返回的模型名称不代表官方授权、官方来源或完全相同的能力。请确认你拥有所使用的 API、模型和内容的合法使用权。

### 为什么值得使用？

- **手机优先**：一套 Expo / React Native 代码同时支持 Android 和 iOS。
- **适合多人共享**：账号、角色、Session、注册开关、禁用用户和最后一个管理员保护都由 Gateway 统一管理。
- **不暴露管理员 Key**：第三方 API Key 只保存在服务端，并使用 AES-256-GCM 加密；Session 只保存哈希。
- **兼容多种服务商**：支持 Responses 和 Chat Completions 两种 OpenAI-compatible 接口模式。
- **图片和附件**：支持图片、文本/代码、PDF、Office/OpenDocument、EPUB/MOBI 等常见附件；兼容时也支持图片生成。
- **稳定流式聊天**：独立请求状态、WebSocket 心跳、REST 回退、断线和停滞处理、取消、重新生成和多会话并发。
- **更少重复计费**：已经开始输出后不会盲目自动重放；文本模型和图片模型分别降级；共享图片账号默认最多允许 100 个图片请求并发；可按服务商实际配额调整。
- **可部署**：支持 Docker Compose + Caddy/Nginx，适合家庭服务器、局域网和公网 HTTPS/WSS 部署。

### 功能一览

| 能力 | 状态 | 说明 |
|---|---:|---|
| Android / iOS App | ✅ | Expo 57 + React Native，支持深色模式 |
| 多用户与管理员控制台 | ✅ | 注册、登录、角色、禁用用户、Session 管理 |
| Responses API | ✅ | 流式输出；工具可用性取决于上游服务商 |
| Chat Completions API | ✅ | 适配只提供 `/chat/completions` 的服务商 |
| 图片输入与图片生成 | ✅ | 取决于模型权限和服务商真实兼容程度 |
| 文件附件 | ✅ | 图片、文本、代码、PDF、Office、电子书等 |
| 多会话并发 | ✅ | 切换对话不会串写增量回复 |
| 限流与并发控制 | ✅ | 用户/设备请求限制；图片共享账号最多 100 并发（可配置） |
| Docker 部署 | ✅ | SQLite 数据卷、HTTPS/WSS 反向代理 |
| Web Search / Code Interpreter | ⚠️ | 仅在上游 Responses 服务真正支持时可用 |

### 下载、安装与分享

#### 普通用户

正式安装包会放在 GitHub 的 **[Releases](https://github.com/dyhxxs/nova-chat/releases)** 页面。下载前请确认：

1. Release 版本与网关兼容；
2. APK 的 SHA-256 校验值与 Release 说明一致；
3. App 连接的是你信任的 HTTPS/WSS Gateway；
4. 你知道该 Gateway 的管理员是谁，以及它使用的第三方模型服务。

不要从聊天群里的未知 APK、临时内网穿透地址或来历不明的“破解包”安装。当前仓库默认不把 APK 直接塞进 Git 历史，而是建议通过 GitHub Releases 或支持断点续传的对象存储分发。

#### 开发者或自托管管理员

```powershell
# 1. 获取源码
 git clone https://github.com/dyhxxs/nova-chat.git
 cd nova-chat

# 2. 安装依赖并验证
 npm ci
 npm run verify
 npm run build
```

要快速启动本地 Gateway：

```powershell
Copy-Item services\gateway\.env.example services\gateway\.env
# 编辑 services\gateway\.env，至少设置 SERVER_MASTER_KEY 与 ADMIN_BOOTSTRAP_TOKEN
npm run dev:gateway
```

再开一个终端启动 App：

```powershell
npm run dev:mobile
```

Android 模拟器访问宿主机通常使用 `http://10.0.2.2:8787`；真机请使用电脑在同一局域网中的 IP。公网部署必须使用 HTTPS/WSS，不能把开发机上的明文 HTTP 或临时 Tunnel 当作生产服务。

### 生产部署

最短路径：

```bash
cp services/gateway/.env.example services/gateway/.env
# 设置强 SERVER_MASTER_KEY、ADMIN_BOOTSTRAP_TOKEN 等秘密
mkdir -p data
docker compose up -d --build
```

Compose 默认只把 Gateway 绑定到服务器本机 `127.0.0.1:8787`。请使用 Caddy、Nginx 或云负载均衡提供固定域名的 HTTPS/WSS；完整部署、备份、更新和分发说明见：

- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)：生产部署、HTTPS/WSS、构建与安装包分发
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)：数据流、并发、上下文和能力边界
- [`SECURITY.md`](./SECURITY.md)：威胁模型、密钥和运维安全要求

首次管理员配置的基本流程：

1. 部署 Gateway 并确认 `/health` 正常；
2. 用 App 连接 Gateway，完成管理员初始化或登录自动创建的管理员；
3. 进入“管理控制台 → 模型服务”；
4. 填写第三方 Base URL、API Key、协议和默认模型；
5. 点击“获取模型”同步并发布允许的模型列表；
6. 普通用户注册/登录后即可使用，不会看到管理员 Key。

### 支持的附件、图片与工具

- **附件输入**：图片、纯文本、代码、PDF、Office/OpenDocument、EPUB/MOBI 等；单文件默认上限 25 MB。
- **图片生成**：用户可以直接说“生成图片 / 生图 / 画一张”，也可以手动选择图片模型；最终能力取决于上游是否开放 `/images/generations`。
- **图片追问**：生成图片后可以继续要求修改风格、背景、构图或人物状态；客户端会保留必要的图片上下文。
- **模型目录**：管理员从上游 `/models` 获取目录并发布白名单，普通用户只看到管理员允许的模型。
- **Responses 工具**：Web Search、Code Interpreter、图片和 PDF 工具仅在第三方接口真实兼容时可用。

能力矩阵：

| 能力 | Gateway Responses | Gateway Chat Completions |
|---|---:|---:|
| 文字 / 流式回复 | ✅ | ✅ |
| 多对话并发 | ✅ | ✅ |
| 图片输入 | 取决于服务商 | 取决于服务商 |
| 图片生成 | 取决于服务商 | 取决于服务商 |
| PDF 输入 | 取决于服务商 | 通常不支持 |
| Web Search | 取决于服务商 | 通常不支持 |
| Code Interpreter | 取决于服务商 | 通常不支持 |
| 管理员统一 Key | ✅ | ✅ |

Nova Gateway **不会直接执行服务器 Shell 或任意远程代码**。它提供的是可靠的移动聊天、附件、多用户和兼容工具入口，不把未隔离的命令执行伪装成 Codex。

### 构建移动端

Expo bundle 验证：

```powershell
cd apps/mobile
npx expo-doctor
npx expo export --platform android --output-dir dist/android-bundle --clear
npx expo export --platform ios --output-dir dist/ios-bundle --clear
```

Windows 本机构建 Android ARM64 Release APK：

```powershell
cd apps/mobile/android
$env:ANDROID_HOME='D:\Android\Sdk'
$env:ANDROID_SDK_ROOT='D:\Android\Sdk'
.\gradlew.bat :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
```

iOS 可用 EAS 或 macOS/Xcode 完成签名：

```bash
cd apps/mobile
npx eas-cli build --platform ios --profile production
```

更多构建和发布注意事项见 [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)。

### 常用命令

```powershell
npm run dev          # 同时启动 Gateway 与 Mobile
npm run build        # 构建 Protocol 与 Gateway
npm run typecheck    # TypeScript 检查
npm run test         # 全部 workspace 测试
npm run lint         # ESLint
npm run verify       # typecheck + test + lint
```

### 安全底线

- 永远不要提交 API Key、`SERVER_MASTER_KEY`、管理员密码、初始化口令、Session Token 或真实 `.env`。
- 生产环境只使用 HTTPS/WSS；不要直接公开 8787 端口。
- 为第三方模型账户设置预算、速率限制和费用告警。
- 定期备份 SQLite 数据卷，并将数据库和主密钥分开控制访问权限。
- APK/IPA 使用 GitHub Releases、应用商店或支持 HTTPS + Range 断点续传的对象存储分发。
- 应用商店和公开介绍必须明确 Nova Chat 是第三方客户端。

### 参与项目与分享

如果这个项目对你有帮助：

1. 点一个 **Star**，帮助更多人发现项目；
2. Fork 后提交改进或新适配；
3. 在 [Issues](https://github.com/dyhxxs/nova-chat/issues) 报告可复现问题；
4. 分享项目主页，而不是只转发一个无法验证来源的 APK；
5. 提供服务商兼容性、设备型号和日志时，务必删除所有 Key、Token、密码和个人数据。

欢迎阅读 [`CONTRIBUTING.md`](./CONTRIBUTING.md) 后参与开发。

## English

### What is Nova Chat?

Nova Chat is an open-source, self-hosted, multi-user AI chat client for Android and iOS. It connects a mobile app to a secure Gateway and any provider that exposes an OpenAI-compatible Responses or Chat Completions API.

Administrators configure the upstream Base URL, API key, protocol and model allowlist once in the Gateway. Regular users only need a Nova Gateway URL and their own account; they never need to see the upstream key.

> Nova Chat is an independent third-party project. It is not an official OpenAI, ChatGPT, Codex or model-provider product. Verify your provider permissions, costs and legal right to use the models and content.

### Highlights

- Self-hosted Gateway for accounts, roles, sessions, rate limits and model policy.
- Android/iOS mobile app built with Expo and React Native.
- Streaming chat with WebSocket plus REST fallback, cancellation and concurrent conversations.
- Image input, image generation when supported, and follow-up image context.
- Uploads for images, text/code, PDF, Office/OpenDocument files and ebooks.
- Responses and Chat Completions compatibility, depending on the upstream provider.
- Encrypted server-side API-key storage, hashed sessions and per-device limits.
- Docker Compose deployment with HTTPS/WSS reverse-proxy guidance.

### Quick start

```bash
git clone https://github.com/dyhxxs/nova-chat.git
cd nova-chat
npm ci
npm run verify
npm run build
```

Copy `services/gateway/.env.example` to `services/gateway/.env`, set strong secrets, start the Gateway with `npm run dev:gateway`, then start the mobile app with `npm run dev:mobile`. For production, use Docker Compose behind Caddy/Nginx and never expose secrets or an unauthenticated development server.

- [Deployment guide](./docs/DEPLOYMENT.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Security policy](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md)
- [Releases](https://github.com/dyhxxs/nova-chat/releases)
- [Issues](https://github.com/dyhxxs/nova-chat/issues)

### Sharing safely

Please share the GitHub project page or a signed GitHub Release rather than an untrusted APK mirror. Check SHA-256 values, use HTTPS/WSS in production, and remove API keys, passwords, tokens and private user data from bug reports.

## License

MIT
