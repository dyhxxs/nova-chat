# Nova Chat 1.1.11

Nova Chat 是一个自托管、多用户、第三方 OpenAI-compatible 模型移动客户端。项目包含 Android/iOS Expo 应用和一个安全网关。普通用户只需要网关地址、账号和密码；第三方 API Base URL、API Key、协议和允许使用的模型由管理员在 App 内统一配置。

> Nova Chat 是第三方客户端，不是 OpenAI、ChatGPT、Codex 或任何模型供应商的官方产品。第三方接口把某个模型 ID 命名为 `gpt-5.6-*`，不代表它一定拥有官方同名模型或完全相同的能力。

> **后续对话交接**：开始新的开发会话前，请先阅读根目录 [`PROJECT_MEMORY.md`](./PROJECT_MEMORY.md)。每次功能修改、版本升级、构建或部署后都应同步更新该文档。

## 本版解决的问题

- **Android 输入法适配**：软键盘弹出时输入区会自动抬起，当前输入内容和发送按钮保持可见；键盘发送键可直接提交消息，并阻止重复提交。
- **原生附件上传**：Android/iOS 改用系统文件上传任务发送图片和 PDF，绕过 React Native 本地 URI 与 `FormData` 的兼容问题；超时、本地文件不可读、服务器错误和局域网断开会分别提示。
- **多会话与同会话并发**：每个请求拥有独立 WebSocket、取消控制器和请求状态；回答生成期间仍可继续输入、发送下一条消息，切换对话也不会把增量内容写错会话。
- **更稳定的流式回复**：握手前可安全回退 REST；心跳、停滞检测、断线错误和 partial 内容保留完整；已开始输出后不会自动重放而导致重复回答或重复计费。
- **正确上下文**：失败、取消、流式未完成的助手消息不会进入下一轮；完成的图片助手消息会保留为后续视觉/图片追问上下文；图片/PDF 引用会随历史保留；历史按字符预算裁剪。
- **稳定模型身份**：系统会明确说明 Nova 和实际模型 ID，降低模型错误自称 DeepSeek 的概率。模型自身仍可能产生错误陈述，客户端不能从技术上绝对保证其自我描述。
- **注册、登录和用户管理**：首次管理员初始化、用户注册/登录/退出、Session 恢复、禁用账户、角色管理、最后一个管理员保护。
- **管理员统一配置模型服务**：管理员在控制台填写中转/代理 Base URL、API Key 和协议，点击“获取模型”会从服务商同步完整模型目录并立即发布；普通用户看不到第三方 API Key，Key 在 SQLite 中使用 AES-256-GCM 加密，Session Token 只保存哈希。
- **聊天页快捷设置**：普通用户无需填写模型服务，在聊天页即可从管理员发布的完整模型目录中选择模型、推理强度和回答详略；服务端仍会再次校验模型白名单。
- **自动生图与模型降级**：用户说“生图/生成图片/画图”等表达，或在上一张生成图后说“不满意、改成全身、换背景”等修改要求时，自动调用 `/images/generations`；会携带原始创作要求和修改链，图片模型和文本模型分别在各自候选中降级。
- **图片与 PDF**：支持 JPG、PNG、WebP、GIF 和 PDF，单文件默认不超过 25 MB；服务端校验真实文件头和文件所有权。
- **Codex 风格工具入口**：Responses 协议可请求 Web Search、Code Interpreter、图片和 PDF。实际可用性取决于第三方服务商是否兼容对应工具。
- **Android/iOS**：同一套 Expo/React Native 代码支持两端；Windows 可产出 Android APK 和 iOS bundle，签名 IPA 仍需 EAS 或 macOS/Xcode。

## 安全架构

```text
Android / iOS App
  ├─ Session Token（SecureStore）
  └─ HTTPS / WSS
          ↓
Nova Gateway
  ├─ 注册、登录、角色、限流、并发、附件权限
  ├─ SQLite（用户、Session 哈希、加密后的模型 Key）
  └─ 管理员配置的第三方模型服务
          ↓
OpenAI-compatible Responses / Chat Completions API
```

普通用户绝不需要填写或读取管理员的第三方 API Key。所有聊天、模型和附件请求统一经由 Nova Gateway 转发，第三方服务配置只由管理员维护。

## 目录

```text
apps/mobile/              Expo Android/iOS 应用
packages/protocol/        App 与网关共享协议和校验
services/gateway/         Fastify 网关、SQLite、附件和模型代理
docs/ARCHITECTURE.md      数据流、并发、上下文与能力边界
docs/DEPLOYMENT.md        生产部署、HTTPS、构建和分发
SECURITY.md               威胁模型与运维安全要求
artifacts/                本地构建产物（默认不提交）
```

## 本地开发

### 环境

- Node.js 22 或更高版本（构建镜像使用 Node 24）
- npm 10+
- Android 构建：JDK 17、Android SDK
- iOS 原生签名：macOS/Xcode 或 EAS Build

### 安装与验证

```powershell
cd E:\gptapp
npm ci
npm run build
npm run verify
```

### 启动网关

开发环境仍应设置固定的主密钥和初始化口令：

```powershell
Copy-Item services\gateway\.env.example services\gateway\.env
# 编辑 .env，将 NODE_ENV 改为 development，并设置 SERVER_MASTER_KEY / ADMIN_BOOTSTRAP_TOKEN
npm run dev:gateway
```

默认监听 `http://127.0.0.1:8787`。首次启动会按 `ADMIN_AUTO_CREATE=true` 自动创建预设管理员账户（默认邮箱由 `ADMIN_EMAIL` 配置，当前默认值为 `admin@qq.com`）；如果该邮箱已经存在，网关不会覆盖现有账户。普通用户直接使用注册功能创建账户。

### 启动 App

```powershell
npm run dev:mobile
```

Android 模拟器访问电脑本机通常使用 `http://10.0.2.2:8787`。真机访问局域网电脑时使用电脑的局域网 IP，并且测试构建必须允许明文 HTTP；生产包应只连接 HTTPS。

正式安装包应在构建时内置网关地址，普通用户打开 App 后无需填写服务器。构建前设置公开变量 EXPO_PUBLIC_GATEWAY_URL=https://chat.example.com；该值会进入 App bundle，绝不能包含 Key、Token 或密码。未设置该变量时，登录页只通过“服务器连接设置”高级入口允许开发者配置局域网或测试网关。

## 管理员首次配置

1. 部署网关并确认 `/health` 正常。
2. 如果构建时没有预置 `EXPO_PUBLIC_GATEWAY_URL`，开发者才需要在登录页的“服务器连接设置”中配置网关地址，例如 `https://chat.example.com`。
3. 使用网关首次启动时创建的管理员账户登录；只有关闭自动创建且数据库没有管理员时，才使用“创建管理员”流程和 `ADMIN_BOOTSTRAP_TOKEN`。
4. 进入“管理控制台 → 模型服务”。
5. 填写第三方中转/代理配置，例如：

```text
API Base URL: https://kxai.cc/v1
协议: Responses
鉴权: Bearer
默认模型: gpt-5.6-sol
允许模型: gpt-5.6-sol
API Key: 只在此处输入一次
```

6. 点击“获取模型”验证当前草稿配置。成功后，服务商返回的完整去重模型 ID 列表会立即保存并发布到网关（无需再点一次“保存”）；普通用户注册并登录后会自动读取这份列表，不需要也看不到 API Key。
7. 普通用户在聊天页点击顶部模型条，即可选择模型、推理强度和回答详略；设置只影响后续消息。当前目录可能同时包含文本模型和 `gpt-image-*` 图片模型。

如果第三方只兼容 `/chat/completions`，将协议改为 Chat Completions。此模式可以文字聊天，但 PDF 和 Responses 原生工具通常不可用；图片生成仍取决于服务商是否实现并开放 `/images/generations`。

App 只有一种连接模式：统一 Gateway 模式。App 负责登录和发起请求，Gateway 统一保存第三方 Key、模型白名单、登录和附件权限；普通用户不需要填写服务器地址，也不接触第三方 API Key。

## 模型目录、图片输入与自动生图

管理员点击“获取模型”后，网关会请求当前草稿配置的 `/models`，去重后立即保存为允许模型；普通用户通过 `/v1/models` 获取同一份已发布列表。服务商返回的模型目录可能包含文本模型（例如 `gpt-5.6-sol`）和图片模型（例如 `gpt-image-1`、`gpt-image-1.5`、`gpt-image-2`）。模型出现在 `/models` 中不代表该 Key 一定拥有对应的图片生成权限，最终仍以 `/images/generations` 的实际响应为准。

- **图片输入**：上传 JPG、PNG、WebP、GIF 或 PDF，让支持视觉/文件输入的文本模型读取已有内容。
- **图片生成**：用户说“生图、生成图片、画一张、画图、配图、出图”等，或手动选择 `gpt-image-*`，客户端会调用 `/images/generations`，并把 Base64、data URL 或远程图片保存为附件后显示。
- **自动降级**：图片请求只在图片模型之间切换，文本请求只在文本模型之间切换；模型不存在、未启用或服务商临时不可用时才尝试备用模型。鉴权、权限、限流和参数错误不会盲目换模型；已经收到部分文字输出后也不会重放并切换，以避免重复回答和重复计费。

## 附件与工具能力

| 能力 | Gateway Responses | Gateway Chat Completions |
|---|---:|---:|
| 文字/流式回复 | 是 | 是 |
| 多对话并发 | 是 | 是 |
| 图片输入 | 取决于服务商 | 取决于服务商 |
| 图片生成（`/images/generations`） | 取决于服务商 | 取决于服务商 |
| PDF 输入 | 取决于服务商 | 否 |
| Web Search | 取决于服务商 | 通常否 |
| Code Interpreter | 取决于服务商 | 通常否 |
| 管理员统一 Key | 是 | 是 |

Nova 网关不会直接执行服务器 Shell。真正的 Codex 工作流还包括代码仓库访问、补丁应用、命令沙箱、权限审批、长任务编排和专有界面；这些不能仅靠一个聊天接口安全地“完全复制”。当前实现提供可靠的移动聊天、附件和兼容工具入口，不会以未隔离的远程命令执行冒充 Codex。

## 生产部署

最短路径：

```bash
cp services/gateway/.env.example services/gateway/.env
# 设置强 SERVER_MASTER_KEY、ADMIN_BOOTSTRAP_TOKEN 等
mkdir -p data
docker compose up -d --build
```

Compose 只把网关绑定到服务器本机 `127.0.0.1:8787`。使用 Caddy/Nginx 在公网提供固定域名的 HTTPS/WSS，不要直接暴露 8787。详细步骤见 `docs/DEPLOYMENT.md`。

## 构建移动端

```powershell
cd E:\gptapp\apps\mobile
npx expo-doctor
npx expo export --platform android --output-dir dist/android-bundle --clear
npx expo export --platform ios --output-dir dist/ios-bundle --clear
```

Android 本机 Release APK：

```powershell
cd E:\gptapp\apps\mobile\android
$env:ANDROID_HOME='D:\Android\Sdk'
$env:ANDROID_SDK_ROOT='D:\Android\Sdk'
.\gradlew.bat :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
```

iOS 签名包：

```bash
cd apps/mobile
npx eas-cli build --platform ios --profile production
```

## APK 下载到 40% 经常中断

这通常是 **APK 文件分发链路** 的问题，不是模型网关是否已部署造成的。正式分享 APK 时应放到支持以下能力的对象存储/CDN：

- HTTPS；
- HTTP Range/断点续传；
- 稳定公网带宽和就近 CDN；
- 正确的 `Content-Length`、APK MIME 类型和长连接；
- 可选的 SHA-256 校验值。

不要把临时内网穿透或开发电脑上的简易文件服务器当作正式下载源。模型网关负责登录和聊天，APK/CDN 负责安装包下载，两者是独立服务。

## 常用命令

```powershell
npm run build
npm run typecheck
npm run test
npm run lint
npm run verify
npm run dev:gateway
npm run dev:mobile
```

## 安全底线

- 不把管理员第三方 Key、`SERVER_MASTER_KEY` 或初始化口令写入源码、APK、截图或日志。
- 生产环境只使用 HTTPS/WSS。
- 为第三方模型账户设置预算、速率限制和费用告警。
- 定期备份 Nova 数据卷；主密钥与数据库必须一起安全保存。
- 不向公网提供未隔离、无审批的 Shell 或任意代码执行。
- App 商店文案必须明确这是第三方客户端。

更多信息见 `SECURITY.md`、`docs/ARCHITECTURE.md` 和 `docs/DEPLOYMENT.md`。

## License

MIT

