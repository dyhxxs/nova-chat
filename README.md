<p align="center">
  <img src="docs/assets/nova-chat-hero.svg" alt="Nova Chat：陪你聊生活，也陪你把事做好。角色定制、角色照片、多模型聊天与自托管。" width="100%">
</p>

<h1 align="center">Nova Chat</h1>
<p align="center"><strong>有性格的 AI 陪伴，也有能把事做好的日常助手。</strong></p>
<p align="center">自定义角色 · 情绪延续 · 角色照片 · 多模型聊天 · 个人资料库 · 自托管</p>

<p align="center">
  <a href="https://github.com/dyhxxs/nova-chat/actions/workflows/ci.yml"><img src="https://github.com/dyhxxs/nova-chat/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <img src="https://img.shields.io/badge/source-v1.1.27-356859" alt="Source version 1.1.27">
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

界面采用暖白与灰绿，给对话留出空间。你可以给角色取名、调整性格、设置长相，也可以接入自己的模型服务，把应用部署给自己或朋友使用。

### 一个有性格的聊天对象

默认角色 Lumi 是 **20 岁的女大二学生**，学中文，有自己的课程、朋友和小习惯；有点孤高，熟悉后偶尔露出一点腹黑。回复偏短，少些固定追问、长篇安慰和对话分析。

她会沿着当前聊天延续情绪：被冒犯时可以不高兴，道歉后也不必立刻热情起来。人物背景、说话方式和你允许使用的记忆都可以编辑，默认人设升级会保留你的自定义内容。

这是一种基于人物设定和上下文的 AI 角色体验。情绪与日常经历由模型生成；实际风格会随所选模型变化。想了解怎么调出自己的角色，见 [陪伴与人设指南](docs/COMPANION.md)。

### 从聊天延伸到角色照片

在“TA 的长相”里上传或替换参考照片，配上可选的外貌描述。聊天时说“拍张照片给我看看”，就能请求一张当前场景的角色图片。

后续照片会继续使用参考脸，尽量延续人物外观。图片生成需要兼容的图片服务，人物一致性取决于模型能力；失败的照片请求支持修改描述后再试。

### 陪你闲聊，也帮你处理正事

| 你想做的事 | Nova 能提供什么 |
| --- | --- |
| 日常聊天 | 独立陪伴对话、角色定制、短口语风格与上下文中的情绪延续 |
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

当前源码为 **1.1.27 / Android versionCode 29**。本版重点更新默认人物、日常短回复、情绪延续、角色照片与管理员模型选择，纳入此前的资料库、账户安全、备份和聊天分支功能。

Android 已完成 MuMu 安装与实际聊天、照片验证。项目包含 iOS / Web 客户端代码；iOS 原生安装与完整真机覆盖仍需继续验证。

本次发布的是源码更新。安装包请以 [GitHub Releases](https://github.com/dyhxxs/nova-chat/releases) 中实际提供的版本与说明为准。详见 [1.1.27 更新说明](docs/RELEASE_1.1.27.md) 和 [更新记录](CHANGELOG.md)。

## 五分钟开始

需要 **Node.js 24** 与 npm。移动端开发使用 Expo，生产网关可以使用 Docker Compose。

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

Android 开发模拟器通常通过 http://10.0.2.2:8787 访问电脑网关；真机使用同一局域网中的电脑地址。自行构建分发包时，可通过 EXPO_PUBLIC_GATEWAY_URL 预设自己的 HTTPS 网关，普通用户只需登录。

### 3. 配置模型，开始聊天

1. 连接网关，通过首次管理员初始化流程建立管理员账户。
2. 在管理控制台配置普通聊天服务；地址通常包含 /v1，以服务商说明为准。
3. 在“AI 陪伴专用服务”分别配置陪伴聊天与陪伴照片。
4. 获取可用模型、选择并保存。进入 AI 陪伴即可创建或编辑角色。

生产环境使用固定 HTTPS/WSS 网关。Docker 部署、反向代理和 Android 构建步骤见 [部署指南](docs/DEPLOYMENT.md)。

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

当前版本通过 **782 项自动化检查**：移动端 437、网关 287、脚本 58，另通过全工作区类型检查、lint 和构建。CI 会执行验证、构建以及 Android / iOS 的 Expo bundle 导出；bundle 导出不等于原生设备安装验证。

欢迎通过 [Issues](https://github.com/dyhxxs/nova-chat/issues) 提交反馈，或通过 Pull Request 改进角色体验、模型兼容、界面与文档。

- [使用与数据指南](docs/USABILITY_AND_SECURITY.md)
- [陪伴、人设与模型配置](docs/COMPANION.md)
- [架构说明](docs/ARCHITECTURE.md)
- [存储迁移与升级](docs/STORAGE_MIGRATION.md)
- [安全策略](SECURITY.md)

代码采用 [MIT License](LICENSE)。如果 Nova 对你有用，欢迎点一颗 Star，让更多人发现它。
