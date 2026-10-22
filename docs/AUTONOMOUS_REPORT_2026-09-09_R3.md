# 自主完善第三轮交付报告

日期按工作机本地时间：**2026-09-09，Asia/Shanghai（UTC+08:00）**。本轮最终全仓验证完成于 01:56:13；对应 UTC 日期仍为 2026-09-08。版本保持 **1.1.14 / Android code 16**，未发布。

## 1. 相对第三轮起点，实际做了什么

本轮不是重做前两轮，而是在现有 SQLite、备份和账户隔离基础上补齐实际缺口。基线保留在 .run/autonomous-20260909-r3/baseline/，共 175 个安全范围内的源码/文档文件；变更清单对照该基线，不把用户原有工作或前两轮成果重复计入新增。

### SQLite 保存路径

- 普通保存不再先读取旧的大 JSON 正文，仅查询记录是否存在；提交前仍逐字读回新正文验证。
- 已经正确的 AsyncStorage 迁移 marker 不重复写入；不削弱迁移原文同事务归档、提交后 marker 校验、缺行拒绝空白覆盖和 SQLite 故障不回退旧副本。
- 对已完成迁移的数据，统计通过 SQL 的 UTF-8 BLOB 长度实现，不把整份旧 JSON 复制回 JS。

### 可审计的保留档案维护

- 「数据与备份 → 存储检查与保留档案」显示活动快照、故障恢复副本、主迁移档案、恢复迁移档案四项正文大小；旧恢复副本会先安全迁移后计入。
- 必须手动预览、核实需要的外部备份、勾选接受永久移除，才可以确认；不会自动清理。故障恢复区补齐三类保留原文的独立导出入口。
- **预览前、真正确认前各保存一次当前内容**，防止预览之后的新草稿/导入尚未保存就删除保留原文。未登录、读取阻止或落盘失败时拒绝。
- 新增 archive_revisions_v1 持久版本表。档案变化、重复确认、账户/网关/token/session generation 变化使旧计划失效；事务内再次校验权限，写入/提交失败整体回滚。
- 只移除当前账户的三类保留原文；不删除活动聊天、设置、助手、草稿或其他账户。恢复行保留为空字符串 tombstone，清理后重开仍可创建新的故障恢复正文；活动记录异常丢失时仍保护性拒绝覆盖。
- **逻辑删除不是安全擦除，也不保证文件立即缩小**。不跑 VACUUM，不自动删除外部文件。Web 无跨标签页原子协议，只提供统计，禁用清理。

### 分享、导入与跨账户反馈

- 对话全量/单条、助手和敏感原文分享统一加入账号/页面有效性检查，旧操作不打开新账户的分享入口、不覆盖新账户的提示。
- 原生临时文件创建/写入失败时清理自身文件；已开始系统分享仍保留约一小时，避免接收应用延迟读取失败。Web 下载失败即时移除 anchor/revoke URL，成功请求下载保留约一分钟。
- 选择器只清理应用 cache 副本，不删除用户原文档；系统已接手或用户另存的文件无法撤回。
- 导入成功进入内存但保存失败时，明确提示“尚未确认落盘、不要关闭应用、重试或先导出”，不再误报成完全没有导入。

### 大历史搜索与行预览

- 新增有界规范化缓存，正文预算 2,000,000 UTF-16 字符（约最多 4 MB 字符存储，不含对象额外开销）；按不可变对话对象缓存，替换/删除时移除旧对象、每个账户重新建选择器。
- 超预算内容仍参与搜索但不保留在缓存中。保持 NFKC、多词、标题/正文/模型/附件名及置顶/归档/排序语义，不索引草稿或助手私有指令。
- 搜索输入延后筛选并显示状态；行预览最多 280 字符，不再倒转复制整个消息列表或对整篇正文做空白替换。完整消息没有截断。

## 2. 可重跑性能基准（不是手机性能承诺）

完整安装 workspace 开发依赖后：

~~~powershell
npm run benchmark:mobile -- --output .run/mobile-performance.json
# 可选：显式加载自己信任的本地历史源码模块做保存前后对照
npm run benchmark:mobile -- --baseline-repository .run/autonomous-20260909-r3/baseline/files/apps/mobile/src/lib/sqliteSnapshotRepository.ts --output .run/autonomous-20260909-r3/performance-result.json
~~~

脚本只生成合成数据，使用 Node SQLite :memory:，不扫描用户历史、不读取真实数据库、不连接网关或模型。--baseline-repository 是显式执行本地代码模块，仅用于可信历史实现。

本机 Node v24.18.0 / Windows x64 的一次记录，每组 3 个样本，报告中位数：

| 场景 | 对照 | 本轮 | 说明 |
|---|---:|---:|---|
| 6,880,028-byte 合成快照，8 次更新耗时 | 649.67 ms | 362.86 ms | 内存 SQLite 稳态，不含首次迁移 |
| 8 次更新返回的正文数据量 | 110,080,455 B | 55,040,228 B | 约减半，只计 row.body，非全部桥接流量 |
| 8 次更新 marker 写次数 | 16 | 0 | 保留 marker 读取验证 |
| 500 会话 / 4,000 消息，18 次搜索 | 114.18 ms | 7.12 ms | 0 缓存 vs 热缓存，中位数约 16.04 倍 |
| 2,000 会话 / 16,000 消息，18 次搜索 | 445.98 ms | 261.65 ms | 超缓存预算，中位数约 1.70 倍 |

搜索结果逐项核对一致；更新断言只读新正文、marker 不重写。耗时没有作为易波动的 CI 绝对门槛。缓存修改失效、冷启动、真实 Expo bridge、Hermes、OS 磁盘和界面帧率都不能由这些数字推出。完整机器可读数据与限制随包放在 verification/performance-result.json。

## 3. 验证结果

| 验证 | 结果 |
|---|---|
| npm run verify | **264 tests passed**：mobile 24 文件 / 190，gateway 8 文件 / 71，scripts 3 |
| 与第三轮起点对照 | **新增 47 项回归测试**（起点 217） |
| TypeScript / lint | 全 workspace 通过 |
| npm run build | protocol / gateway 通过 |
| Expo 57 install --check | 通过，未添加依赖或修改锁文件 |
| 最终 Android / iOS / Web export | 通过，原生 bundle 含 SQLite/revision，Web 不含 SQLite 后端 |
| 独立 Android arm64 构建 | 最终源码增量构建成功，35s，439 tasks；此前已完成该 staging 的原生构建 |
| APK 静态校验 | v2 签名通过；16 KiB ZIP 与 20 个 ELF 库 LOAD 段对齐通过 |
| 依赖审计 | 6 moderate，0 high / critical；未强制不兼容降级 |
| UI / 真机 / 同包升级 | **未执行**，可用 apps/browsers 为空，@oai/sky 无法加载 |
| iOS 原生构建 | **未执行**，只导出 bundle |
| 生产、真实模型、安装设备 | **未执行** |

回归覆盖：逻辑字节统计、旧恢复副本迁移、清理不动活动/其他账户、revision 过期/跨仓库实例/重复确认、事务中权限变化、写入/commit 回滚、清理后文件型数据库关闭重开、tombstone 新修复、确认时保存失败、三类档案导出归属、缓存预算/失效/隔离/字段范围/预览及分享时机/临时资源清理。

**测试边界：**SQLite 测试桥使用 Node 内置 SQLite 执行真实 SQL 和事务，再模拟 Expo async 接口；不是原生驱动或设备断电测试。构建成功不代表页面布局、系统分享实际落盘、真机升级或安全存储故障场景已验收。人工门槛均保留未勾选，见 [QA 清单](QA_CHECKLIST.md)。

## 4. 交付安装包与证据

- APK：artifacts/autonomous-20260909-r3/NovaChat-1.1.14-qa-r3-arm64.apk
- 应用名 Nova QA R3；包名 com.novachat.mobile.qa.r3，独立于正式版、QA R1、QA R2。
- 1.1.14 / code 16，arm64-v8a，minSdk 24 / targetSdk 36。
- 大小 **37,885,665 bytes**。
- SHA-256：**447c7a6e37e0969aac002afe503c65a16271910d2492f15779cfb2e18242eb5a**。
- Android Debug 签名，非正式发布签名；QA 允许可信本地 HTTP、allowBackup=false、无内置网关地址。
- 独立 staging .run/q3；72 个移动运行时源码/资源与工作树逐字节一致，app.json 仅 5 项 QA 身份差异单列；原 apps/mobile/android 未触碰。
- 前两轮 APK 原样保留，R2 SHA-256 仍为 c7c1beac94c2194e38a5190092211cd68b347c1912b5cbe37a37d1e5d2729c4a；R1 仍为 6e8f619f41881b97be9da928eada5bcab5176f874b34bc0682205b6c4789dcdf。

同目录有 README.md、SHA256SUMS.txt、build-manifest.json、changes-from-baseline.json 与 verification/。完整过程日志在 .run/autonomous-20260909-r3/；这些目录为本地忽略产物，不会由普通 git 提交自动上传。

最终全仓依据 verify-final.log / verify-result.json；最终打包依据 qa-android-build.log / qa-build-result.json / expo-export.log。首次 Android 因 staging 的 mobile/node_modules 误连根依赖目录，漏掉嵌套 expo-status-bar 而失败，已仅修复该 junction；历史失败日志与修复说明保留。之后的 before-confirm-flush 日志对应最后四项回归之前，不是最终结果。首次基准脚本字符串换行语法错误、中间类型/测试问题均已修复，历史日志不作为最终失败。

## 5. 剩余边界与后续方向

1. 必须在相同的一次性测试 applicationId 做旧版 → 新版真机升级、关闭/重开和故障演练。独立 R3 新装不能读取正式版或前两轮的应用沙盒，不等于迁移验收；不能直接降级旧客户端。
2. SQLite 仍是明文整体 JSON，受解析内存与磁盘限制；清理统计不是物理占用，不提供安全擦除。原 AsyncStorage 已不可读取的旧行无法保证自动迁移。
3. 原文档案可能含私有配置；标准聊天备份不含助手、对话草稿、附件本体。清理之前必须核实所需内容已另存，系统分享返回不证明保存完成。
4. 两种凭据存储都失败仍无法保证持久退出；保留前轮明确告警与重试。导航依赖链 6 moderate 尚未解决。
5. 未增加加密备份、附件打包、自动/云备份、MFA 或共享模板市场。下一步优先做目标真机验收、冷启动/内存/输入延迟测量，再按真实需求选择附件打包与加密备份，不把堆功能替代验证。

本轮没有读取真实 .env、生产凭据或生产数据库，没有重启用户网关/隧道，没有付费调用、设备安装、发布、版本升级、commit 或 push。用户给出的八小时作为自主工作授权上限；以实际完成并验证的第三轮检查点交付，不声称运行满八小时或后台无限优化。

使用方法见 [使用与安全指南](USABILITY_AND_SECURITY.md)、[存储迁移/维护说明](STORAGE_MIGRATION.md)。
