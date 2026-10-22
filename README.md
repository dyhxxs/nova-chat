<p align="center">
  <img src="docs/assets/nova-chat-hero.svg" alt="Nova Chat：陪你聊生活，也陪你把事做好。角色定制、角色照片、多模型聊天与自托管。" width="100%">
</p>

<h1 align="center">Nova Chat</h1>
<p align="center"><strong>有性格的 AI 陪伴，也有能把事做好的日常助手。</strong></p>
<p align="center">自定义人设 · 多话题对话 · 情绪延续 · 角色照片 · 多模型聊天 · 个人资料库 · 自托管</p>

<p align="center">
  <a href="https://github.com/dyhxxs/nova-chat/actions/workflows/ci.yml"><img src="https://github.com/dyhxxs/nova-chat/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <img src="https://img.shields.io/badge/source-v1.1.31-356859" alt="Source version 1.1.31">
  <img src="https://img.shields.io/badge/Android-first-668975" alt="Android first">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-556b60" alt="MIT license"></a>
  <a href="https://github.com/dyhxxs/nova-chat/stargazers"><img src="https://img.shields.io/github/stars/dyhxxs/nova-chat?style=flat&color=356859" alt="GitHub stars"></a>
</p>

<p align="center">
  <strong>简体中文</strong> · <a href="README.en.md">English</a><br>
  <a href="#先认识-nova">功能亮点</a> · <a href="#五分钟开始">快速开始</a> · <a href="docs/COMPANION.md">陪伴指南</a> · <a href="docs/DEPLOYMENT.md">部署文档</a> · <a href="https://github.com/dyhxxs/nova-chat/issues">反馈与建议</a>
</p>

## 先认识 Nova

想有人陪你说两句，也想在需要的时候认真解决一个问题。Nova 把这两种体验放进同一个应用：陪伴有自己的角色和聊天节奏，普通聊天保留模型、工具和资料问答的完整能力。

界面采用暖白与灰绿，给对话留出空间。你可以给角色取名、粘贴完整人设提示词、设置长相，也可以接入自己的模型服务，把应用部署给自己或朋友使用。

### 和不同的人设聊不同话题

进入 AI 陪伴先选人设，再选择或新建该人设的对话。一个人设可以聊多个话题，各对话分别保存上下文；人物设定、参考脸和主动保存的长期记忆共用。内置 Lumi 和沈知意，也支持粘贴完整提示词新建自己的角色。

默认角色 Lumi 是 **20 岁的女大二学生**，学中文，有自己的课程、朋友和小习惯；有点孤高，熟悉后偶尔露出一点腹黑。回复偏短，少些固定追问、长篇安慰和对话分析。

回复只呈现手机上会发出去的话，不写括号动作或心理旁白。人物保留自己的喜好和判断，普通问候可以几个字结束，对感兴趣的事再多聊。日常短句少用句号、逗号，必要时用短行分开表达，不固定补解释和追问。她会沿着当前聊天延续情绪：被冒犯时可以不高兴，道歉后也不必立刻热情起来。人物背景、说话方式和你允许使用的记忆都可以编辑，默认人设升级会保留你的自定义内容。

这是一种基于人物设定和上下文的 AI 角色体验。情绪与日常经历由模型生成；实际风格会随所选模型变化。想了解怎么调出自己的角色，见 [陪伴与人设指南](docs/COMPANION.md)。

### 从聊天延伸到角色照片

在“TA 的长相”里上传或替换参考照片，配上可选的外貌描述。聊天时说“拍张照片给我看看”，就能请求一张当前场景的角色图片。

不上传照片时，首张形象按完整人设的年龄、外貌、背景、性格与喜好建立，并保存为该人物共用的参考脸。照片读取当前话题最近多轮内容：正在改稿，就表现改稿动作与稿子、电脑等场景；明确要求换地点时再改变场景。后续照片继续使用参考脸，尽量延续人物外观。图片生成需要兼容的图片服务，人物一致性取决于模型能力；失败的照片请求支持修改描述后再试。

### 像聊天软件一样发语音

聊天输入框支持按住录音、松开发送、上滑取消，也可以先转成文字再编辑。语音气泡可播放并展开文字；AI 可按会话选择自动、语音或文字回复，并固定音色。需要升级网关并配置兼容的语音中转，使用方式和本轮验证范围见 [语音聊天说明](docs/VOICE_CHAT_2026-10-14.md)。

### 陪你闲聊，也帮你处理正事

| 你想做的事 | Nova 能提供什么 |
| --- | --- |
| 日常聊天 | 多个人设与各自的独立对话、完整人设提示词、短口语风格与上下文中的情绪延续 |
| 写作与思考 | 多模型普通聊天、自定义助手、流式回复、Markdown 与代码展示 |
| 读自己的资料 | 个人资料库、文档导入、原文搜索、带来源片段的资料问答 |
| 查实时信息 | 时间、天气、计算、单位、日期、参考汇率、搜索与公开网页阅读 |
| 整理聊天 | 历史搜索、置顶、归档、草稿、收藏、独立对话分支与备份导入 |
| 管理自己的服务 | 多用户账户、会话管理、模型白名单、Docker 部署与连接诊断 |

回复朗读使用设备或浏览器语音服务，可能联网。资料来源帮助你核对回答；天气、搜索等外部工具的可用性取决于数据服务。

### 模型服务由你选择

管理员可以分别配置 **普通聊天、陪伴聊天、陪伴图片** 三套服务。文字接口支持 OpenAI-compatible **Chat Completions / Responses**，支持 bearer、api-key 等鉴权方式。

填写完整 API 基础地址和 Key，获取可用模型，选择模型，再保存配置即可生效。保存后的地址和 Key 不回显，普通用户直接登录使用；每套服务可以采用不同的上游。

## 当前版本

当前源码为 **1.1.31 / Android versionCode 33**。本版包含语音消息、陪伴体验、资料库、账户安全、备份和聊天分支功能，并补充 Gateway 的运行探针、请求关联、登录保护、优雅下线、管理员审计日志和可选 Prometheus 指标。

Android 已完成 MuMu 安装与实际聊天、照片验证。项目包含 iOS / Web 客户端代码；iOS 原生安装与完整真机覆盖仍需继续验证。

本次发布的是源码更新。当前公网 1.1.31 安装包可从[下载页](https://134.175.139.81/download/)获取：大多数手机推荐 [ARM64 APK](https://134.175.139.81/downloads/NovaChat-1.1.31-android-arm64.apk)，需要多架构兼容时使用[通用 APK](https://134.175.139.81/downloads/NovaChat-1.1.31-android-universal.apk)。文件大小和 SHA-256 见 [1.1.31 更新说明](docs/RELEASE_1.1.31.md)；GitHub Releases 中的版本与说明仍以实际发布内容为准。

## 五分钟开始

需要 **Node.js 22.13+** 与 npm。移动端开发使用 Expo，生产网关可以使用 Docker Compose。

~~~bash
git clone https://github.com/dyhxxs/nova-chat.git
cd nova-chat
npm ci
npm run build
~~~

### 1. 启动自己的网关

复制环境配置：

~~~bash
# macOS / Linux
cp services/gateway/.env.example services/gateway/.env
~~~

~~~powershell
# Windows PowerShell
Copy-Item services/gateway/.env.example services/gateway/.env
~~~

编辑 .env，设置随机的 SERVER_MASTER_KEY 和 ADMIN_BOOTSTRAP_TOKEN，再启动：

~~~bash
npm run dev:gateway
~~~

### 2. 打开客户端

另开一个终端：

~~~bash
npm run dev:mobile
~~~

Android 开发模拟器通常通过 http://10.0.2.2:8787 访问电脑网关；真机使用同一局域网中的电脑地址。自行构建分发包时，可通过 EXPO_PUBLIC_GATEWAY_URL 预设网关地址，普通用户只需登录。没有证书时可以使用固定公网 IPv4 + HTTP：将地址设为 http://服务器IP:8787，并使用 build_friend_android.ps1 -AllowHttpIp 构建；流式聊天会自动使用 ws://。

### 3. 配置模型，开始聊天

1. 连接网关，通过首次管理员初始化流程建立管理员账户。
2. 在管理控制台配置普通聊天服务；地址通常包含 /v1，以服务商说明为准。
3. 在“AI 陪伴专用服务”分别配置陪伴聊天与陪伴照片。
4. 获取可用模型、选择并保存。进入 AI 陪伴即可创建或编辑角色。

当前没有证书时可以直接使用公网 IP + HTTP 部署；取得证书后再切换到 HTTPS/WSS。Docker、公网端口、Android 明文构建和后续证书升级步骤见 [部署指南](docs/DEPLOYMENT.md)。

## 项目结构

~~~text
apps/mobile        React Native / Expo 客户端
services/gateway   Fastify 网关、账户、模型路由、资料库与工具
packages/protocol  共享协议与默认角色定义
docs               部署、使用、人设与升级文档
scripts            构建、验证、诊断与分发工具
~~~

聊天记录保存在本设备，原生端使用 SQLite；账户、角色和模型配置由网关管理。请求的消息、附件和必要上下文会发送到所选模型服务，自托管并不等于模型推理离线。

## 验证与贡献

~~~bash
npm run verify
npm run build
node scripts/check_release_metadata.mjs
~~~

验证请以当前提交实际运行的 `npm run verify` 和 `npm run build` 输出为准；测试数量会随代码变化，不在 README 中固定容易过期的快照数字。CI 会执行验证、构建以及 Android / iOS 的 Expo bundle 导出；bundle 导出不等于原生设备安装验证。知识库 baseline 评测使用 `npm run knowledge:evaluate`；`npm run knowledge:compare` 会对比 lexical 与 FTS5 BM25。结果为合成数据的检索层指标，不代表线上性能。

欢迎通过 [Issues](https://github.com/dyhxxs/nova-chat/issues) 提交反馈，或通过 Pull Request 改进角色体验、模型兼容、界面与文档。

- [使用与数据指南](docs/USABILITY_AND_SECURITY.md)
- [陪伴、人设与模型配置](docs/COMPANION.md)
- [架构说明](docs/ARCHITECTURE.md)
- [企业级运行说明](docs/ENTERPRISE_READINESS.md)
- [知识库评测](docs/EVALUATION.md)
- [技术案例说明](docs/PORTFOLIO_CASE_STUDY.md)
- [演示脚本](docs/DEMO_SCRIPT.md)
- [存储迁移与升级](docs/STORAGE_MIGRATION.md)
- [安全策略](SECURITY.md)

代码采用 [MIT License](LICENSE)。如果 Nova 对你有用，欢迎点一颗 Star，让更多人发现它。
