# 自主完善第二轮交付报告

日期按工作机 Asia/Shanghai 本地时间记录为 2026-09-09；用户要求继续后，在第一轮结果上开展本轮。项目仍是 1.1.14 / Android versionCode 16 的**未发布工作树**。

## 1. 本轮结果

本轮重点不是堆砌入口，而是解决上一轮明确留下的三个可靠性缺口：大历史存储、凭据故障不可见、助手无法独立迁移。

### A. 原生大历史存储与安全迁移

- 新增 expo-sqlite ~57.0.2。Android/iOS 的账户快照与恢复记录使用 SQLite，Web 继续使用原 AsyncStorage 适配。
- 每个账号/网关沿用原独立 key，令牌不进入历史数据库；全局 bootstrap 仍不包含私有系统指令。
- 原始旧字符串与活动快照在同一 exclusive transaction 中保存并核对；提交后才将旧值换为小标记。首次档案不被后续写入覆盖。
- SQLite 读失败不回退过期 AsyncStorage 副本；有迁移标记但无活动记录时不把空白状态写回。
- 数据页展示后端和降级风险，并提供迁移前原文导出；清空对话的提示说明其不会删除助手、恢复/迁移档案、外部备份。

主要实现：sqliteSnapshotRepository.ts、snapshotStorage.native.ts / snapshotStorage.ts、useAppStore.ts。

### B. 凭据读写错误、可靠退出与网关绑定

- 新凭据 envelope 在 SecureStore 中保存 token、认证时网关和随机 nonce；普通存储仅写非秘密 intent/state/nonce，不写令牌。
- 登录先写 blocked fence，验证凭据写入后再激活匹配 nonce；启动恢复使用凭据绑定的网关，避免过期 bootstrap 地址重定向认证请求。
- 读、写、删除失败不再被静默吞掉；全局提示提供重试，退出后的登录页仍展示清理失败。
- 退出分别尝试 fence 和删除，任一成功可阻止本次旧登录自动恢复；两者都失败时明确提示持久退出尚未可靠完成。
- 保留串行写入和会话 generation 防护；过期异步结果不会覆盖新会话或清掉其告警。

主要实现：credentialVault.ts、credentialStorage.ts、CredentialNotice.tsx、useAppStore.ts。

### C. 独立助手模板备份与安全增量导入

- 新格式 nova-chat-assistants / v1，最大 10 MiB，最多 100 模板。与标准聊天备份不通用。
- 显式导出模板白名单字段：名称、说明、完整指令、开场草稿、时间和来源标识；不导出账户、凭据、网关或聊天。
- 因其包含私有指令/草稿，UI 特别提醒明文敏感性；导入展示指令和草稿预览，长内容标明截断，要求确认来源可信。
- 按来源标识或完全相同内容跳过重复，不覆盖本地编辑；编辑保留来源标识，重导出/重导入仍能去重。
- 完整校验后才应用；容量超限整体拒绝，确认时重验当前账号/网关/会话。只新增本地模板，不创建聊天、发送消息或调用模型。
- 助手库增加备份入口，系统分享文件名区分 conversations / assistants / recovery。

主要实现：assistantBackup.ts、AssistantBackupSection.tsx、assistantPresets.ts、accountScope.ts、useAppStore.ts。

## 2. 实际验证

| 项目 | 第二轮结果 |
|---|---|
| 移动端 Vitest | 21 文件 / 143 测试通过 |
| 网关 Vitest | 8 文件 / 71 测试通过 |
| Node 脚本测试 | 3 测试通过 |
| 合计 | 217，较第二轮开始时的 169 增加 48 |
| 全仓 TypeScript / lint | 通过 |
| protocol + gateway 构建 | 通过 |
| Expo 57 依赖检查 | dependencies up to date |
| Android / iOS / Web 导出 | 全部通过 |
| 原生/网页适配器选择 | Android/iOS bundle 含 SQLite 后端，Web 不含 SQLite 后端 |
| 独立 Android arm64 构建 | BUILD SUCCESSFUL，2m56s，439 tasks |
| APK | v2 签名校验、16 KiB ZIP 对齐、20 个 ELF 库 LOAD 段静态检查通过 |
| 依赖审计 | 6 moderate，0 high / critical，与第一轮相同 |
| 浏览器 / 原生 UI / 真机 | 未执行；可用 surface 为空，@oai/sky 无法加载 |
| iOS 原生构建 | 未执行；只完成 bundle 导出 |
| 生产部署 / 上游真实模型调用 | 未执行 |

新增测试聚焦：大于 6 MiB 原文、文件型 SQLite 关闭/重开后的快照和档案一致性、真实 SQL 事务回滚/提交失败、marker 写入与验证失败、数据库读失败、已迁移记录丢失、并发顺序、账号/恢复 key 隔离、store 通过 native 适配器恢复、SecureStore 故障、双保护失败、重试、网关绑定、模板字段白名单/去重/容量/会话隔离。

**测试边界：**SQL 测试桥使用 Node 内置 SQLite 执行真实语句，模拟 Expo async 接口形状；它不是 Android/iOS native 驱动或 OS 持久性测试。打包/静态对齐通过不代表真机运行或页面布局通过。本轮未重新启动第一轮网关 HTTP 冒烟服务；网关以全量自动化回归验证，第一轮 HTTP/WS 证据保持历史记录。

## 3. 安装包与证据

- APK：artifacts/autonomous-20260909-r2/NovaChat-1.1.14-qa-r2-arm64.apk
- 应用名：Nova QA R2
- 包名：com.novachat.mobile.qa.r2，独立于正式包与第一轮 QA
- 版本：1.1.14 / code 16，arm64-v8a，minSdk 24 / targetSdk 36
- 大小：37,863,877 bytes
- SHA-256：c7c1beac94c2194e38a5190092211cd68b347c1912b5cbe37a37d1e5d2729c4a
- 签名：Android Debug，非正式发布签名；QA 允许可信本地 HTTP，无内置网关地址。
- 独立 staging：.run/q2；69 个移动源码/资源文件与 staging 逐字节一致，app.json 的 QA 身份差异单独记录。
- 第一轮 APK 哈希仍为 6e8f619f41881b97be9da928eada5bcab5176f874b34bc0682205b6c4789dcdf，未覆盖或改动。

同目录的 README.md、SHA256SUMS.txt、build-manifest.json 和 changes-from-baseline.json 提供身份、构建与文件变更信息。最终全仓验证于工作机本地时间 2026-09-09 00:59:31（UTC+08:00）完成，exit code 0；以 verify-final.log 和 verify-result.json 为准。关键证据副本随包置于 verification/。完整日志位于 .run/autonomous-20260909-r2/：verify-final.log、verify-result.json、build.log、expo-check.log、expo-export.log、qa-prebuild.log、qa-android-build.log、qa-apk-*.log/json、platform-resolution.json、dependency-audit.json、ui-availability.json。较早的 verify.log 为新增最后一项回归测试前的记录；verify-reopen-lint-failure.log 保留随后一次已修复的测试清理 lint 失败，不是最终结果。

这些目录为本地忽略产物，不会因普通 git 提交自动上传。源码/文档尚未提交或推送，未创建 Git release。

## 4. 仍需重视的风险与后续方向

1. **不能直接降级旧客户端。**旧版不认识新的 SQLite marker 和版本化凭据。先导出标准聊天/助手文件，在同测试 applicationId 上验证升级与回滚；独立 R2 新装包无法自动读取第一轮或生产沙盒。
2. SQLite 仍为明文整体 JSON 快照，档案增加磁盘占用，解析受内存限制；不是无限容量、加密备份、消息级数据库或云同步。已大到 AsyncStorage 无法读取的旧行不能保证自动迁移。
3. 迁移/故障恢复原文可能含任意私有配置；不等同于标准可导入备份，清空聊天不会安全擦除这些档案。
4. 两种存储都失败时，任何本地退出方案都无法保证持久状态；必须观察警告、重试或服务端撤销会话。Web 不使用明文 token 持久化回退。
5. 附件二进制迁移、加密备份、后台自动备份、云同步、MFA 与共享助手市场未实现。
6. 导航依赖链的 6 个 moderate 仍需兼容性方案；未执行强制大版本降级或不兼容 override。
7. 下一优先级建议是同包原生升级真机验证、存储规模性能测量、可审计的档案生命周期/清理机制，再考虑附件打包和加密备份。

## 5. 工作边界

第二轮开始前单独保留了用户/第一轮工作树基线：.run/autonomous-20260909-r2/baseline/。对照该基线列本轮修改，避免将第一轮或用户原有工作重复计入新增。

没有读取真实 .env / 生产凭据 / 生产数据库，没有重启用户已有网关或隧道，没有向生产写数据、付费调用、安装设备、发布应用、提交或推送。八小时被视为用户提供的自主工作上限；本报告按实际完成的第二轮检查点交付，不声称后台运行满八小时或完成未执行的验收。

详见 [使用指南](USABILITY_AND_SECURITY.md)、[迁移/恢复/回滚说明](STORAGE_MIGRATION.md)、[待执行人工清单](QA_CHECKLIST.md)。
