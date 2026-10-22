# Nova Chat 1.1.22 服务器所有者测试包（2026-09-29）

## 交付范围

本版本是绑定新服务器 `https://134.175.139.81` 的 Android ARM64 安装包，用于服务器所有者在手机上测试安装、覆盖升级和连接流程。它不是“朋友发布版”验收包：构建时管理员与模型服务尚未配置。2026-09-30管理员已由用户创建，并根据用户确认的平台修正了匹配的模型入口；模型列表和一次公网认证WSS真实合成聊天通过，默认模型返回OK。完整手机真机交互与运营商网络验收仍未完成。

## 实际产物

- APK：`artifacts/server-test-1.1.22/NovaChat-1.1.22-android-arm64-server-test.apk`
- 版本：1.1.22，Android versionCode 24，包名 `com.novachat.mobile`
- 服务器地址：`https://134.175.139.81`
- WebSocket：`wss://134.175.139.81/v1/chat/stream`
- 同签名覆盖升级：已与 1.1.21 候选包的签名证书一致，不需要为了升级先卸载旧版
- APK 内置地址、HTTPS、ARM64、签名、权限、ZIP/16 KiB 对齐和本地敏感文件扫描均已通过独立检查

## 本轮修复

- 新 APK 更新后以内置服务器地址为准，避免继续使用旧临时地址。
- 无来源绑定的旧版登录凭据不会被发送到新服务器；需要重新登录。
- 有来源绑定的凭据仅在来源与新服务器一致时保留。
- 切换服务器时不混入旧账号聊天记录；旧本地记录仍保留在原账号/服务器作用域。
- 公网 IPv4 地址校验不再误拒绝本服务器，同时继续拒绝内网、回环、保留和临时隧道地址。
- npm 审计中的 4 个中等级传递依赖问题已修复；`npm audit` 当前为 0 vulnerabilities。

## 手机测试

1. 手机可使用流量或任意可正常访问公网的 Wi-Fi，**不需要与电脑处于同一局域网**。
2. 在手机浏览器打开 `https://134.175.139.81/download/` 下载 APK；也可使用直链 `https://134.175.139.81/downloads/NovaChat-1.1.22-android-arm64.apk`。
3. 安装时如果 Android 提示允许浏览器/文件管理器安装未知应用，按系统提示临时允许。
4. **不要先卸载旧版，不要清除数据**，直接覆盖安装，用来验证迁移保护。
5. 管理员已由所有者创建，现应使用自己的应用账号登录；无需再次填写初始化口令。初始化口令不是 SSH 密码，也不是宝塔密码。
6. 当前管理员及模型配置已存在，模型接口与公网认证聊天测试通过。直接回聊天页发送一条消息，不用重装或重复保存旧配置；不要把SSH密码、管理员初始化口令或第三方API Key发到聊天中。

## 验收边界

- `check_owner_gateway.mjs`：健康检查、HTTPS、匿名保护接口和初始化状态通过。
- WSS 匿名握手：按预期返回 `unauthorized`/4401，通过；这不是已登录真实聊天验收。
- 尚未连接 Android 真机进行安装和点击交互，`physicalDeviceTested=false`。
- `authenticatedChatVerified=false`、`adminAndProviderSetupPending=true`；这是构建时的历史状态；现在长期SSH授权有效，无需重新授权。后续已完成模型入口修正与公网认证合成聊天；仍需手机真机验收。

## 证据文件

- `artifacts/server-test-1.1.22/verification.json`
- `artifacts/server-test-1.1.22/SHA256SUMS.txt`
- `artifacts/server-test-1.1.22/gateway-check.json`
- `.run/server-apk-1.1.22-android-build.log`
- `.run/server-apk-1.1.22-dependency-audit-final.json`


## 公网下载已发布（2026-09-30）

此前等待 SSH 授权的问题已解决。长期可撤销维护密钥连接与 sudo 均成功，不再使用2小时临时授权，也不在本次交付后撤销长期密钥。

已将同一 APK 字节发布到服务器固定 HTTPS 下载入口。本轮只增加静态分发，没有修改移动端源码、重新打包或重启网关。下载页面200、APK HEAD200、实际完整下载38,006,882字节、SHA256一致、Range206、未列出的文件和敏感路径404；API健康和匿名WSS鉴权未受影响。

SHA256：`308a8b523ccc5373fb70e3f0ad2b5c068556f34aebe2729e02c12a2995638c16`。

公网下载证据在 `artifacts/public-download-1.1.22/deployment-verified.json`、`public-verification.json` 和 `server-postcheck.json`。维护规则见 `docs/LONG_TERM_MAINTENANCE_2026-09-30.md`。

当前管理员已初始化；后续已完成模型配置与真实认证合成聊天，完整手机真机验收仍待完成。2026-09-30模型列表诊断修复仅更新后端，没有重打APK，原下载文件及SHA256不变。下载上线不等于朋友聊天发布验收通过。

## 2026-09-30 后端模型列表诊断补丁

已部署脱敏错误分类与20秒上游超时，250项后端测试通过；旧500的具体上游原因仍待用户重新触发获取模型后确认。详情及证据见 `LONG_TERM_MAINTENANCE_2026-09-30.md`，本APK版本/签名/文件哈希不变。

## 2026-09-30 保存后状态更新

用户已保存模型配置（providerConfigured=true）；实际模型目标的网络连接失败，Key/模型有效性及真实聊天尚未验证。这不是APK或下载入口验收失败；本轮未重打包。详细脱敏证据与待确认的Key发行平台信息见长期维护文档最新补充。

## 2026-09-30 模型入口修正与真实聊天验证

已按用户确认的服务商修正持久入口，管理员模型测试200、12个模型，现有默认模型不变。公网HTTPS认证与WSS流式聊天通过，单条固定测试文本约8秒返回OK。没有改源码、重启服务或重打APK，原包与SHA256保持不变。认证测试从服务器进程访问公网地址，独立电脑另外验证health/setup200和匿名保护401；不将其等同完整手机真机验收。证据见`artifacts/deployment/provider-kxai-fix/`，备份与安全操作记录见长期维护文档。
