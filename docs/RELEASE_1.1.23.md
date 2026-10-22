# Nova Chat 1.1.23 — AI 陪伴与界面改版验收（2026-10-12）

> 最新安装包和工具修复请看 [R5 验收记录](RELEASE_1.1.23_R5.md)。本文保留 R4 的历史验收结果。

## 已交付内容

新版已覆盖安装到 MuMu 的 dyh 设备，保留现有应用数据。全局配色改为暖白、灰绿，重新整理普通聊天首页、消息气泡、陪伴联系人、角色编辑与设置页面。陪伴使用独立聊天界面，用户无需选择模型，也不显示思考强度和普通助手工具栏。

## 本轮问题与修复

- 首次回复保存失败：React Navigation 7 的 navigate('Chat') 会创建重复聊天实例，两个页面同时恢复同一请求。各入口改用 popTo('Chat')，Chat 注册固定 ID，并以真实 StackRouter 测试连续打开陪伴只保留一个实例。恢复旧代码时同一回归测试会失败。
- 陪伴列表返回绕圈：返回时恢复最近的普通会话，或创建普通会话；打开陪伴时跳过该恢复操作。已在 dyh 点按验证。
- 头像不显示：陪伴头像使用认证下载与本地图片缓存，替换照片时丢弃旧异步结果。已验证联系人、聊天和角色编辑头像。
- 陪伴回复僵硬及泄露模型身份：陪伴提示独立于普通助手模型身份，按角色设定自然聊天，允许连续的虚构角色日常；被直接问及真实性时仍说明 AI 角色，服务端不把模型 ID 附加到陪伴提示中。
- 图片和会话恢复：首次照片调用 images/generations，后续携带参考脸调用 images/edits；角色修订与按用户/角色串行生成防止旧结果覆盖新长相。任务持久化，可在 App 重启后恢复同一请求。

## 管理员独立配置

- 陪伴文字：DeepSeek 官方接口，默认 deepseek-chat，Chat Completions，Bearer。
- 陪伴图片：采用已有管理员图片上游的地址与 Key，独立默认模型 gpt-image-2；上游需支持 generations 与 edits。
- 用户提供的文字 Key 已加密写入本机服务端配置。两套配置均保存于 QA 数据库及项目 data-lan 数据库。没有将 Key 写入源码、APK、截图或本记录。
- 管理端仅显示已配置状态，已保存地址与 Key 留空保留；普通用户看不到陪伴模型和配置。运行配置保存与公网服务器部署是不同事项，本轮没有更新远程服务器。

## dyh 实际操作结果

1. 全新角色小雨首次发送“今天过得怎么样？”，真实 DeepSeek 回复：“挺好的，下午泡了壶白茶，翻了几页书。你呢，今天忙不忙？”保存完成，无重复页面造成的保存失败。
2. 实际询问模型身份，回复说明模型由管理员配置，没有暴露模型名或响应模型元数据。
3. 未设置长相的 Lumi 生成第一张窗边读书照片，服务端自动保存为参考脸。
4. 再生成花园喝茶照片，实际使用第一张照片作为编辑参考；检查两张照片为同一脸部形象。
5. 在模拟器内修改长相为短棕红发、绿眼睛、淡雀斑，再生成公园散步照片。旧参考脸被清除，新照片符合描述并成为新参考脸。
6. 第三张照片生成中覆盖安装并重启 App；返回后恢复原任务，显示完成照片与头像。
7. 实际打开系统相册，选择图片、裁剪、上传并保存替换脸部照片；服务端 avatarFileId 已更新，联系人头像正常。此次选用上一项生成的照片，未再额外调用上游生图。
8. 陪伴列表返回普通聊天正常。管理员文字和照片配置页分别显示已配置，模型分别为 deepseek-chat 和 gpt-image-2。

普通聊天的 QA 上游仍使用 fixture；上述陪伴文字和三张陪伴图片均为真实上游调用。自动化测试中的 mock 不计作真实模型验收。

## 自动检查与构建

- npm run verify 通过：Mobile 424、Gateway 254、Scripts 57，共 735 项；类型检查、lint 均通过。
- Expo 清缓存导出与 Android release 构建通过，版本 1.1.23 / versionCode 25。
- APK 签名校验（v2）和 zipalign 16 KiB 对齐检查通过；应用包名 com.novachat.mobile，ABI x86_64。
- 本机 QA 构建临时允许本地 HTTP，源码 AndroidManifest 的 usesCleartextTraffic 已恢复为 false。
- 未执行 commit、push 或远程部署，保留工作区原有修改。

## 安装包与证据

- APK：[NovaChat-1.1.23-MuMu-dyh-QA.apk](../artifacts/redesign-1.1.23/NovaChat-1.1.23-MuMu-dyh-QA.apk)
- 大小：38,646,730 bytes。
- SHA-256：3DABAF327825EAA0C38F5FB77E0640697D9939BF7C37EB213591B06276B1B0FE。
- 结构化结果：[verification.json](../artifacts/redesign-1.1.23/verification.json)。
- 实际截图：[首次聊天](../artifacts/redesign-1.1.23/01-companion-chat.png)、[修改长相后的照片](../artifacts/redesign-1.1.23/02-face-description-generated.png)、[系统相册](../artifacts/redesign-1.1.23/03-system-face-picker.png)、[上传保存后的联系人](../artifacts/redesign-1.1.23/04-face-upload-saved.png)、[普通首页](../artifacts/redesign-1.1.23/05-home.png)、[文字配置](../artifacts/redesign-1.1.23/06-admin-companion-chat.png)、[图片配置](../artifacts/redesign-1.1.23/07-admin-companion-image.png)。
- 实际生成图片：[第一参考脸](../artifacts/redesign-1.1.23/face-first.png)、[换场景保留脸部](../artifacts/redesign-1.1.23/face-second-same-identity.png)、[新描述建立新脸](../artifacts/redesign-1.1.23/face-new-appearance.png)。
- 完整验证日志：.run/redesign-r4-verify.log、.run/redesign-r4-export.log、.run/redesign-r4-android-build.log。

## 此安装包的使用范围

此包内置 http://127.0.0.1:8788，通过 dyh 的 ADB reverse 连接电脑上的 QA 网关，已安装并登录。本机服务和 ADB 转发需要保持运行。它是 MuMu 本机验收包，不能作为公网手机发布包分发；现有远程服务器没有应用本轮源码与配置。
