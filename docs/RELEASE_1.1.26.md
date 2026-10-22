# Nova Chat 1.1.26 — 照片失败恢复与场景隔离

2026-10-12发布，Android versionCode 28。下一版见 [1.1.27](RELEASE_1.1.27.md)。

照片场景改为当前用户请求、最近成功照片及近期正常角色活动，避免旧失败描述混入后续日常照片。明确审核拒绝提供“修改照片描述”，恢复原问题到草稿供用户修改，不自动重发、不截断后面消息；网络等瞬时错误仍支持重试。错误码随记录持久化，旧记录保持兼容。

全量770项检查、类型、lint和服务端构建通过。专用普通QA账户完成20项真实公网陪伴检查，两张同脸照片和照片后文字聊天成功。在 MuMu「dyh」127.0.0.1:16384覆盖安装，同一私人账号的Lumi历史保留；恢复日常照片问题并发送成功，再发比心照片成功。证据为 `.run/photo-1.1.26-dyh-first-result.png` 与 `.run/persona-v3-dyh-photo-result.png`。

- 保留下载：https://134.175.139.81/downloads/NovaChat-1.1.26-android-arm64.apk
- 手机包：`artifacts/friend-1.1.26/NovaChat-1.1.26-android-arm64-preview.apk`，38,030,718 bytes。
- 手机SHA256：`e0f1568f5b7846790ce81d57f22d35583deed294c6790dfe0cf8bf5243fb5dd7`。
- dyh包：`artifacts/mumu-1.1.26/NovaChat-1.1.26-MuMu-dyh-QA.apk`，38,656,026 bytes。
- dyh SHA256：`07a402e4a3cf6bf156c260e89ed2efd8a57eed643b21765de5e6c632904c574b`。
- 沿用既有预览签名；不是正式生产签名。公网整包下载hash、Range206、旧版1.1.22至1.1.25地址和注册开放均已核验。
- 服务端备份：`/www/backup/nova-chat-1.1.26/20261012T124332Z`，配置、账号、会话、人物和文件保留。

原泳装描述被实际上游审核拒绝；修复不改变图片服务审核结果，也不移除参考脸规避审核。日常照片成功不表示所有描述都能通过。
