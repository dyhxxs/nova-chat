# Nova Chat 1.1.24 — 公网手机包与升级兼容（2026-10-12）

新版包含 [1.1.23 R5](RELEASE_1.1.23_R5.md) 的暖白/灰绿布局、独立陪伴模型、参考长相、完整工具调用和链接渲染修复。本次已更新常驻公网网关，发布手机可用的 ARM64 安装包。

## 下载和覆盖安装

- APK：https://134.175.139.81/downloads/NovaChat-1.1.24-android-arm64.apk
- 下载页：https://134.175.139.81/download/
- 包名 com.novachat.mobile；版本 1.1.24 / versionCode 26；ARM64；Android 7.0+。
- 文件 38,028,430 bytes（36.27 MiB）；SHA-256：1aae461f231b8dc5960aca5e4b416094bdaa4133ba6a1eb7b5c705e492584bef。
- 沿用此前公开 1.1.23 的本地 Expo 预览签名，证书 SHA-256 fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c；不能将此签名描述为正式生产签名。
- 已安装旧版时直接覆盖安装，不要先卸载或清除应用数据。公网注册现已开放，已有账号登录，新用户在登录页点击“注册”。

## 新用户注册（2026-10-12 已开放）

- 安装后在登录页点击“注册”，填写邮箱和至少 8 位密码即可创建普通账号；不需要管理员初始化口令或模型 API Key。
- 已打开的登录页如果没有显示“注册”，重新打开应用或刷新服务状态即可；仍使用上面的 1.1.24 安装包，无需重新打包。
- 实际公网验证：新账号注册 201、重复邮箱 409、短密码 400；注册会话认证、退出失效及密码重新登录通过；普通用户管理员接口 403。新账号的真实 WSS 对话及 REST 完成快照通过，默认陪伴角色独立创建。
- 仅修改服务器 REGISTRATION_ENABLED=true 并用同一镜像重新创建 gateway，所有其他环境配置逐字节保留；原账号、会话、文件、陪伴角色和两类模型配置校验一致。测试账号和会话已精确清理。
- 私有变更前 env/SQLite 备份：/www/backup/nova-chat-signup/20261012T072015Z。下载页已同步注册说明，APK 字节、签名及旧版本下载地址不变。
- 脱敏证据：[注册和真实聊天](../artifacts/deployment/signup-2026-10-12/public-verification.json)、[数据保留与清理](../artifacts/deployment/signup-2026-10-12/cleanup-receipt.json)、[下载页更新](../artifacts/deployment/signup-2026-10-12/download-page-update.json)。以上为 API 实测，不声称完成用户手机界面操作。

## 升级和旧版数据

- 普通聊天、陪伴聊天、附件引用、收藏、草稿、助手预设及个人设置继续使用已发布的本地快照 v7 和账户/网关命名空间；安装包版本升级不清空存储。
- 原服务器地址、包名及签名保持一致；已有登录会话和服务器上的陪伴角色、长相及上传文件保留。
- 服务端迁移只增加陪伴专用配置、长相和生成任务表，未删除或重写原账号/会话/文件/角色记录。原普通 provider 配置及 SERVER_MASTER_KEY、数据卷、上传目录保持。
- 旧客户端使用原 /v1 REST/WSS 协议；未指定能力版本的陪伴资料接口返回旧版字段。1.1.24 用 x-nova-companion-profile-version: 2 获取长相/参考照片字段。旧版编辑名称不会擦除新长相。
- 不要求最低 App 版本，不强制更新。1.1.22/1.1.23 的公开 APK 和下载路径继续有效；后续提示更新和强制更新另行开发。
- 后续发布遵循 [升级兼容约定](UPGRADE_COMPATIBILITY.md)。本机记录不会因新版本自动变成跨设备云同步记录；卸载、清除数据、换手机属于不同场景。

## 公网陪伴与普通模型

| 用途 | 配置与验收 |
| --- | --- |
| 普通聊天 | 保留项目已有 GPT Responses 中转配置；发布前后真实认证 WSS 对话与 REST 任务快照均通过。 |
| 陪伴文字 | DeepSeek 官方服务，管理员单独配置 deepseek-flash；模型发现通过，2 个当前可用模型；实际公网陪伴天气对话完成。 |
| 陪伴照片 | 项目图片中转，管理员单独配置 gpt-image-2；模型发现通过，22 个当前可用模型。 |

模型地址和 Key 仅在服务器管理端设置，Key 加密保存，不进入源码、APK 或公开发布文件。用户端的陪伴完成帧及任务快照均不返回模型名称；普通用户无法访问陪伴管理员配置。

本次公网未重复收费生图；同脸续图、替换长相、上传参考脸的实际生成和模拟器证据见 R4/R5 记录。公网本轮验证独立配置与图片模型发现，不把前轮生成称作本轮重测。

## 验证证据

- npm run verify：757 项通过（Mobile 430 / Gateway 269 / Scripts 58），类型检查及 lint 通过。
- 新增旧版严格资料 schema、能力协商、旧客户端 REST/WSS 生成、旧数据库迁移回归；新增相同网关的三次启动恢复，验证两种聊天、照片引用、收藏、草稿、助手和设置完整保留。
- Expo 57 兼容补丁同步，清缓存导出、Gradle ARM64 release、APK 版本/权限/HTTPS/签名、16 KiB 对齐通过；Expo 补丁变化集中移动端依赖，网关与 protocol 锁文件条目未变。
- 公网真实陪伴 get_weather 工具完成；回复 266 字符；完成任务快照可恢复；不返回模型名称。普通聊天构建前后各一项真实请求通过。
- 对公开 APK 执行完整 GET 并核对本地 SHA-256；HEAD 200、Range 206（首 1024 bytes）通过；旧版本 HEAD 200；未发布下载路径 404。
- 发布前备份 SQLite 和原源码、保存 Docker 回滚镜像；另备份上传目录和升级后 SQLite。私有备份位于 /www/backup/nova-chat-1.1.24/20261012T063706Z，不进入公开下载目录。
- 发布验证的 2 个临时会话及专用验证用户已清理；原 users/sessions/files/companion_profiles 均为 1，原记录逐行校验一致，原会话及普通 provider 保留。
- 手机包没有在用户自己的真机上操作验收；前轮 dyh 为 x86_64 本机 QA 包，本次为公网 ARM64 包。

结构化记录：[下载校验](../artifacts/public-download-1.1.24/public-verification.json)、[上传清单](../artifacts/public-download-1.1.24/upload-manifest.json)、[陪伴配置](../artifacts/deployment/phone-1.1.24/provider-verification.json)、[陪伴真实对话](../artifacts/deployment/phone-1.1.24/companion-chat-receipt.json)、[验证会话清理](../artifacts/deployment/phone-1.1.24/cleanup-receipt.json)。构建日志为 .run/phone-1.1.24-build.log，未提交或推送代码。
