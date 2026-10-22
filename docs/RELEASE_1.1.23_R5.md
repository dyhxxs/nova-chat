# Nova Chat 1.1.23 R5 — 陪伴工具与独立模型配置验收（2026-10-12）

> 最新公网手机版本见 [1.1.24 发布记录](RELEASE_1.1.24.md)。下文保留 R5 本机验收时的事实。

最新 R5 已覆盖安装到 MuMu 的 dyh，保留账户和历史对话。布局继续采用暖白和灰绿；陪伴聊天仅显示角色、消息和照片入口，隐藏模型、推理强度与工具设置。

## 本轮修复

- 陪伴工具曾在客户端请求、网关请求处理和上游模型调用三处被关闭，导致真实天气等查询不可用。本轮恢复完整工具调用链，并要求依据真实工具结果回答，失败时如实说明。
- 已验证八项日常工具：天气、当前时间、计算、单位换算、日期计算、参考汇率、联网搜索、网页阅读。
- 修复备用搜索对 Open-Meteo 等名称的错误拆分；过滤与指定名称无关的结果，最多重试一次核心名称，保留站点和排除词约束。仍无匹配结果时返回失败，不把无关来源当作证据。中英文混合查询已在真实 Bing RSS 上返回官方主页和文档。
- 管理员填写专用服务地址和 Key 后，可获取模型、搜索模型名称并选择，点保存后生效。普通聊天、陪伴文字、陪伴照片各自独立。模型发现不会自动保存草稿，也不会借用普通聊天的服务。更换地址不允许沿用旧地址的密钥。
- 角色编辑页将照片上传、替换和可选描述合并到“TA 的长相”。未上传参考脸时首张生成照片建立长相；后续照片沿用参考，修改长相或上传新照片可替换。
- 陪伴回复复用已有的安全 Markdown 渲染，修复链接露出格式符号、无法点击的问题，同时保留简洁聊天气泡。

## 本机实际配置

| 用途 | 配置与验证 |
| --- | --- |
| 普通聊天 | 项目现有 GPT 中转，Responses/Bearer；默认 gpt-5.6-sol；当前上游可用 22 个模型；模拟器选择 gpt-5.5 获得真实回复。 |
| 陪伴文字 | 用户提供的 DeepSeek 官方 Key 在服务端加密保存；管理员 UI 获取官方模型列表并选择、保存 deepseek-flash。 |
| 陪伴照片 | 现有图片中转，gpt-image-2；管理员 UI 获取模型、筛选、选择并明确保存。 |

普通聊天切换 gpt-5.5 后，陪伴仍使用管理员独立配置，并完成计算和搜索。用户端陪伴响应不返回模型名称，管理员保存后不回显 Key。本次 UI 选择 deepseek-flash 应用于 QA 数据库；data-lan 的历史陪伴设置仍为 deepseek-chat。

## 验收结果

- npm run verify：749 项通过（Mobile 427、Gateway 265、Scripts 57），类型检查及 lint 通过。
- 清缓存 Expo Android 导出、Gradle offline release 构建、APK v2 签名和 zipalign 16 KiB 检查通过。
- dyh 实际操作：原先失败的长沙天气会话重查成功；普通 GPT 中转聊天成功；DeepSeek 模型发现、选择和保存成功；图片模型发现、选择和保存成功；切换普通模型后陪伴计算与官网搜索成功；角色长相页与最终链接渲染已检查，点击官网链接成功打开浏览器，返回后最终安装包再次取得中文回复。
- 前轮 R4 的三张真实图片、首张建立参考脸、同脸换场景、修改长相换脸、生成任务重启恢复、系统相册裁剪上传保存证据保留在 [R4 记录](RELEASE_1.1.23.md)。R5 不将这些历史验收写成重新执行。
- 早期搜索曾返回无关结果，未作为成功验收；以最终相关性修复后的 API、模拟器与真实工具结果为准。

## 安装包与截图

- [最新 R5 安装包](../artifacts/redesign-1.1.23-r5/NovaChat-1.1.23-R5-MuMu-dyh-QA.apk)，包名 com.novachat.mobile，版本 1.1.23 / code 25，x86_64。
- 大小：38652186 bytes；SHA-256：F9329282887986F8621F04BA472BF8B4BEF5577807150AC823FD92A856F00779。
- [结构化结果](../artifacts/redesign-1.1.23-r5/verification.json) 与 [SHA256SUMS](../artifacts/redesign-1.1.23-r5/SHA256SUMS.txt) 记录最终包大小和哈希。
- [天气重查成功](../artifacts/redesign-1.1.23-r5/01-companion-weather-fixed.png)、[长相编辑页](../artifacts/redesign-1.1.23-r5/02-face-upload-and-description.png)、[普通 GPT 真实回复](../artifacts/redesign-1.1.23-r5/04-ordinary-real-gpt-reply.png)、[DeepSeek 可选模型](../artifacts/redesign-1.1.23-r5/05-admin-deepseek-model-list.png)、[陪伴文字保存](../artifacts/redesign-1.1.23-r5/06-admin-companion-chat-saved.png)、[图片模型列表](../artifacts/redesign-1.1.23-r5/07-admin-image-model-list.png)、[图片配置保存](../artifacts/redesign-1.1.23-r5/08-admin-companion-image-saved.png)、[切换普通模型后的陪伴计算](../artifacts/redesign-1.1.23-r5/09-companion-after-gpt-switch.png)、[修复后的链接显示](../artifacts/redesign-1.1.23-r5/11-companion-search-link-rendered.png)、[最终覆盖安装后的真实回复](../artifacts/redesign-1.1.23-r5/12-final-installed-companion-reply.png)。
- 10-companion-search-verified.png 为链接渲染修复前的诊断截图；最终渲染以 11 开头的截图为准。
- 日志：.run/redesign-r5-verify.log、.run/redesign-r5-final-export.log、.run/redesign-r5-final-android-build.log、.run/r5-tools-probe-final.json。

## 使用范围

此包连接 http://127.0.0.1:8788，通过 dyh 的 ADB reverse 访问电脑上的 QA 网关。普通聊天和陪伴文字/图片当前均使用真实上游。本机服务及 ADB 转发需要运行，它是 MuMu 本机验收包，不能作为公网手机发布包分发。

远程服务器未更新；源码 AndroidManifest 的 usesCleartextTraffic 已恢复为 false。工作区原有修改保留，未 commit、push 或远程部署。
