# 自主完善交付报告（2026-09-08 启动）

本轮工作跨过本机午夜，收尾记录为 2026-09-09（Asia/Shanghai）。这是**实际已实现、已验证的一轮交付**，不表示已经连续运行满用户授权的八小时。

## 1. 交付结论

在原有未提交的 1.1.14 工作树上，完成了「本地数据可靠性」「账户安全」「聊天工作流」三个方向的修复和扩展。交付源代码、测试、独立 Android QA 安装包、校验值和使用/验收文档。

- 自动化验证从基线 **122 项（59 mobile + 60 gateway + 3 scripts）** 增至 **169 项（95 + 71 + 3）**，新增 47 项回归，全部通过。
- 全工作区 TypeScript 检查、lint、protocol/gateway build、Android/iOS/Web Expo export 通过。
- 独立 arm64 Android QA APK 原生编译、签名验证、ZIP 对齐和原生库静态对齐检查通过。
- 构建后的网关通过隔离的真实 HTTP/WebSocket 冒烟；没有调用上游模型或消耗模型额度。
- **未完成实际 GUI/真机验收，未执行 iOS 原生构建，未生产部署，未修改版本号，未 commit/push 或创建 Release。**

## 2. 修复的核心问题

| 问题 | 本轮处理 | 回归依据 |
|---|---|---|
| 保存历史静默截断到 100 个对话 | 去掉截断，保留更旧历史 | storePersistence：106 个对话退出/恢复 |
| 流式增量尚未保存就退出/换账户 | 排队保存最后状态、提供 flush、后台刷新 | 最后 delta 保留测试 |
| 可编辑网关地址与数据归属混在一起 | 增加已认证网关归属；快照不能重定向会话 | 两网关同 userId、恶意 savedServer、账户设置隔离 |
| 全局 bootstrap 泄漏/继承私有指令 | 全局仅保留连接/设备信息；设置按账户隔离 | 指令不进入全局记录/另一账户 |
| 慢 SecureStore 登录写入发生在退出之后 | 串行令牌写入和会话 generation guards | 慢写入不复活已退出 token |
| 本地写入失败无明显告警，损坏 JSON 可导致历史丢失 | 保存失败提示/重试；逐记录恢复、原始副本保护、阻止危险覆盖 | 读写失败、坏 JSON、未知版本、旧恢复副本、导出跨账户竞态 |
| WebSocket hello 后长期使用旧会话/角色 | 每帧/心跳复核，撤销/改密/禁用触发失效检查，定时清扫到期任务 | logout、revoke、expiry、disable、demotion、普通断线 durable 测试 |
| 异步 WS 帧异常与任务保留计时器生命周期不完整 | 捕获异常、关闭异常连接；app.close 清理任务计时器 | 网关全套回归及构建检查 |
| 安全操作仅凭 HTTP 200 就视为成功 | 校验成功响应 schema | 错误成功体拒绝、会话字段剥离/路径编码测试 |

## 3. 可直接使用的新功能

### 数据与备份

全量 JSON 导出、选择文件后预览/确认导入、来源 ID 去重、增量合并；单对话 JSON/Markdown 导出。最多 20 MiB UTF-8，完整验证后才改变数据，不覆盖旧对话，不恢复生成任务。导出采用白名单，不带凭据、账户/网关配置、系统/助手指令、草稿、URI 或后台任务引用。

**限制**：文件是明文，不脱敏聊天正文；附件只有名称/元数据，没有文件本体；这不是完整设备迁移或云同步。

### 历史整理

改名、置顶、归档、最近/置顶/归档/全部筛选；规范化多关键词搜索标题、正文、模型与附件名称。生成中的对话不能归档，长菜单可滚动，历史摘要显示未发送草稿。

### 草稿与助手库

每对话文字草稿，账户/网关隔离，发送时只清理一致草稿，避免覆盖新输入。新增四个内置助手和自定义助手 CRUD；开场内容只填草稿。对话冻结创建时的助手指令，之后修改模板不影响已有会话。

### 账户安全中心

查看自己的有效会话、退出指定会话/其他设备、验证旧密码并修改密码。改密成功撤销所有会话，包括当前设备；客户端不会把 200 的非确认响应误认为成功。设备标识仅是客户端自报信息，不是可信硬件身份。

### 无付费连接诊断

只检查地址、/health、/v1/models 和实时 hello/ready，不发送 start/生成请求。支持逐项超时、取消和复制脱敏报告。网关健康不等于上游模型、Key、额度、附件或工具可用。

详细入口、文件格式、API、恢复流程及隐私边界见 [使用指南](USABILITY_AND_SECURITY.md)。

## 4. Android 测试包

| 项目 | 实际产物 |
|---|---|
| 文件 | artifacts/autonomous-20260908/NovaChat-1.1.14-qa-arm64.apk |
| 应用名 | Nova QA |
| 独立包名 | com.novachat.mobile.qa |
| versionName / versionCode | 1.1.14 / 16 |
| ABI | arm64-v8a |
| minSdk / targetSdk | 24 / 36 |
| 大小 | 35,861,392 bytes（约 34.2 MiB） |
| 签名 | Android Debug 证书，APK Signature Scheme v2 验证通过；不是生产签名 |
| 网关配置 | 不内置网关地址；启动后填写自己的可信测试网关 |
| 明文流量 | 仅这个独立 QA 包允许 HTTP，供可信本地环境测试；不要当正式发行包 |
| 本轮运行验收 | 未安装到用户设备，未做真机/截图验收 |

SHA-256：

    6e8f619f41881b97be9da928eada5bcab5176f874b34bc0682205b6c4789dcdf

同目录提供 SHA256SUMS.txt、build-manifest.json 和 README.md。manifest 记录构建检查、APK 摘要及 59 个移动端源码/资源文件的 SHA-256；这些文件与隔离构建快照逐字节一致。测试后仅继续修改了回归测试与文档，已验证的移动端运行时代码与 APK 保持一致。

构建在 .run/qa 的独立 Expo prebuild 目录完成，未覆盖原 apps/mobile/android；使用目录 junction 复用 node_modules，原生依赖可能更新其构建缓存。不复制 .env、生产数据库或原 Android 项目。expo-sharing 已随该 APK 编入原生模块。

ZIP 16 KB 对齐验证通过；19 个 .so 的 ELF LOAD 段均满足静态 16 KB 对齐检查。**这些是静态检查，不是 16 KB 真机运行通过的声明。**

## 5. 验证证据

日志均在项目本地 .run/autonomous-20260908/，不包含需要公开的真实账号凭据；.run 与 artifacts 默认不进 Git。

| 检查 | 结果 | 日志/位置 |
|---|---|---|
| 初始 npm run verify | 122 项测试 + types/lint 通过 | baseline-verify.log |
| 最终 npm run verify | 17 个 mobile 测试文件/95 tests；8 个 gateway 文件/71 tests；scripts 3 tests；types/lint 全通过 | final-verify.log |
| npm run build | protocol 与 gateway 构建通过 | build-2.log |
| npx expo install --check | 依赖符合当前 Expo 版本要求 | expo-dependency-check.log |
| Expo 三端 export | Android/iOS/Web bundle 通过（隔离配置） | expo-export.log、export-preview/ |
| 独立 expo prebuild android | 通过 | qa-prebuild.log |
| Gradle assembleRelease arm64 | BUILD SUCCESSFUL，439 tasks | qa-android-build.log |
| APK 元数据/权限 | 独立包名、版本、ABI；allowBackup=false、QA cleartext=true | qa-apk-badging.log；构建时 manifest 检查 |
| apksigner verify | v2 签名通过、Debug 证书 | qa-apk-signature.log |
| zipalign -c -P 16 -v 4 | Verification successful | qa-apk-alignment.log |
| ELF LOAD 段静态核验 | 19 个库通过 | qa-apk-elf.log |
| 构建网关 HTTP/WS smoke | 12 个 HTTP 请求；hello/ready；撤销关闭 4401；旧令牌/旧密码拒绝；新密码可登录 | qa-http-smoke.log |
| 依赖审计 | 6 moderate，0 high/critical，尚未消除导航链问题 | dependency-audit.json |
| 自建服务清理 | 仅停止自己的隔离 fixture；8897/8898 不再监听 | qa-cleanup.log |

全部新增网关测试使用临时数据库和 mock provider。独立运行的网关 fixture 将生成方法强制替换为抛错，且上游配置为不可用的 loopback 测试地址。HTTP/WS smoke 只操作它的测试账户，不操作真实用户或生产数据。

## 6. 仍需诚实说明的限制

1. **界面与真机未验收**：可用 UI 通道没有浏览器，原生控制依赖也不可用。没有伪造截图或将 bundle 成功当成界面验收。请按 [人工 QA 清单](QA_CHECKLIST.md) 实机检查布局、键盘、分享/文件选择、深浅色和无障碍。
2. **依赖风险仍在**：6 条 moderate 来自 React Navigation → query-string → decode-uri-component，关联 GHSA-vcc3-ghjq-m6fr。没有强制降级导航或不兼容覆盖来“刷绿”审计。当前没有外部 linking 配置，不等于可忽略风险。
3. **存储仍有容量上限**：不再截断 100 个对话，但仍以单个账户 JSON 保存；平台单行读取、总容量和内存限制未迁移解决。写入/读取失败会提示和保护原始数据，但不是无限容量保证。
4. **凭据存储异常提示尚不完善**：SecureStore 串行化解决了竞态，底层写/删失败仍缺少独立告警。
5. **备份不是全量迁移**：没有加密备份、附件打包、草稿/助手迁移、云同步或自动定时备份。恢复副本可能含更多隐私，不能随意分享。
6. **原生发布仍需另做**：QA 包使用测试签名和独立包名；iOS 未原生编译。新增 expo-sharing 需要更新原生壳，不能仅 JS 更新旧壳。正式包需要正式签名、正确网关、禁用明文及递增发布构建号。
7. **上游能力未重新验证**：本轮不测试真实付费模型。原 1.1.14 文档中的既有外网/上游验收属于原有记录，不计入本轮成果。

## 7. 工作树与操作边界

- 开始前保留了原始 dirty 状态、tracked patch、untracked 清单和源码快照，位于 .run/autonomous-20260908/baseline/ 及 initial-* 文件。
- 未执行 reset/checkout 或删用户数据；保留原注册/登录恢复、代理错误、supervisor 和朋友分享构建工作。本轮修改的重叠文件是在该基线上继续扩展，不把既有成果全部记作新增。
- 本轮独立改动清单见 .run/autonomous-20260908/changes-from-baseline.json；该清单对比初始用户工作树，而不是仅对比 git HEAD。
- 未主动读取真实 .env、生产凭据或生产数据库；隔离 Expo 构建使用 EXPO_NO_DOTENV=1。未调用付费模型、修改真实账户密码或撤销真实会话。
- 未重启原有生产/开发网关、下载服务或隧道。仅创建并停止本轮 loopback 测试服务；测试数据库和日志保留用于复查，没有后台测试进程继续监听。
- 未 commit/push、发版、修改应用版本号或上传 APK 到外部服务。安装包留在本地 artifacts 供用户验收。

## 8. 后续优先级（未冒充已实现）

1. 先完成真机交互验收，再准备正式签名和网关滚动升级。
2. 将单条账户 JSON 迁移为分片/SQLite，增加事务、容量指标、失败回滚和大历史性能测试。
3. 增加可见 SecureStore 故障处理，再设计可选择范围的加密备份/助手导入导出。
4. 在兼容分支解决导航依赖安全链，保留所有账户隔离和备份回归。
5. 云同步、附件归档、密码找回/MFA 属于更大的隐私/运维设计，本轮未为了功能数量仓促上线。

本轮选择的是可用性收益较大、可以本地验证且不会新增上游费用或生产风险的扩展，不是简单堆页面或未经验证的大规模重构。
