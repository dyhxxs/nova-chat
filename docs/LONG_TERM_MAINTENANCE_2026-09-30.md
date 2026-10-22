# 长期部署与维护授权（2026-09-30）

## 当前真实状态

**长期 SSH 授权已生效，公网 APK 下载已发布并完成外网验收。无需再次执行授权命令。**

- 通过专用长期密钥多次新建 SSH 连接及 `sudo -n` 成功；服务器对应公钥正好一条，带 `restrict`，无自动到期，authorized_keys 为 ubuntu 所有且权限 0600。
- 元数据 `artifacts/deployment/nova-chat-maintenance-session.json`：`authorization_status=active`、`authorization_type=persistent_revocable`、`expiry=null`。
- 用户明确要求长期有效：本次部署后保留授权，只在用户要求撤销或轮换时处理。
- 下载页面：`https://134.175.139.81/download/`
- APK 直链：`https://134.175.139.81/downloads/NovaChat-1.1.22-android-arm64.apk`
- API 已内置 `https://134.175.139.81`。下载与连接服务器均不依赖电脑开机或同一 Wi-Fi；尚未完成真实手机运营商网络测试，不承诺任意网络无故障。

## 发布与验收

- 沿用已构建的 1.1.22/code24 ARM64 所有者初始化测试包；本轮没有改动移动端源码，没有重新构建 APK。
- 文件 38,006,882 字节；SHA256：`308a8b523ccc5373fb70e3f0ad2b5c068556f34aebe2729e02c12a2995638c16`。
- 上传暂存文件逐个核验大小与 SHA256。公开目录 `/www/nova-public/releases/1.1.22/` 只有 APK、index.html、SHA256SUMS.txt，目录 root:root/0755、文件 root:root/0644。
- 新下载配置：`/www/server/panel/vhost/nginx/extension/134.175.139.81/nova-chat-downloads.conf`。利用现有 server 扩展 include，添加精确静态路由；未修改原站点主文件、API 反代、ACME 或证书配置。
- 配置备份及部署凭据：`/www/backup/nova-chat-public-download/20260930T030528Z-63221c3c3b/`，root-only/0700，不在 Web 目录。
- `nginx -t` 成功后平滑 reload；外网 HTTPS 页面和 APK HEAD 200、完整下载 38 MB 后哈希一致、Range 206/100 字节与 Content-Range 正确、校验文本一致。
- HTTP 308 到 HTTPS；未知下载文件、配置、元数据、数据库和 .env 探测均404。只检查状态，未输出敏感内容。
- `/health` 正常；匿名受保护接口401；WSS 握手成功后按预期返回 unauthorized/4401。**这不是已登录聊天验收。**
- 已清理本次 ubuntu 私有上传暂存目录，未删除正式发布文件或回滚备份。
- Docker enabled/active，网关 running/healthy、restart=unless-stopped，8787 仅绑定127.0.0.1；Nginx 开机链接保留。只是配置检查，没有重启服务器做冷启动演练。
- 证书自动续期 timer enabled/active；保留此前已通过 dry-run 的续期 hook，本轮未强制续签。短期 IP 证书需持续自动续期，长期入口不代表单张证书永久有效。

## 后续维护

- 使用 `artifacts/deployment/maintenance_remote.py --script <已审查脚本>` 和长期 session 元数据。不要使用读取旧已撤销 session 的 remote.py，也不要再次要求用户执行临时/长期授权命令。
- 私钥只在 Windows 用户 .ssh，不能打印、上传、提交或放到公开目录。元数据也不对外公开。
- 这是已有 ubuntu 账号的维护权限，保留现有 sudo 管理能力，并非只读权限。未改 sshd、sudo 策略、密码或防火墙；未使用聊天中出现过的 root 密码。
- 用户可随时要求撤销或轮换；撤销时按公钥正文精确匹配移除，保留其他行，随后新建 SSH 验证拒绝。**不要在交付收尾自动撤销长期密钥。**
- 历史一次性安装脚本保留供审计，不要批量重跑。两把旧临时身份不用于本次连接。
- 回滚下载路由时先核对备份中的“原配置不存在”标记，仅移除本次扩展文件；`nginx -t` 后 reload，不覆盖全站/宝塔数据库，不动网关数据卷。
- 服务器续费、域名/IP保持、系统补丁和证书续期仍需维护。本次没有配置每日/异地自动备份或监控告警，不能声称全部运维工作永久免维护。
- 未独立核验或收紧腾讯云安全组；不要把下载发布视为全端口安全验收。聊天中暴露过的服务器密码需由所有者更换，不能在聊天中再次发送。

## 明确未完成

2026-09-30 最新复查：`needsBootstrap=false`、`bootstrapTokenRequired=true`、`registrationEnabled=false`、`providerConfigured=true`。首个管理员及模型配置均已由用户保存；初始化口令无需再次填写。已根据用户确认的平台修正匹配的持久入口，管理员模型测试与一次公网认证WSS真实合成聊天通过；手机真机操作仍待用户确认。

模型配置已保存，但当前官方API直连目标不可达；真实认证聊天和完整手机端安装/升级/流量网络验证仍待完成。没有迁移本地账号数据库、第三方 API Key 或其他秘密；需要用户明确确认配置来源。不要把维护 SSH 授权当作应用初始化口令，不要让用户发送密码或 Key 到聊天。

## 本地证据

- `artifacts/public-download-1.1.22/deployment-verified.json`：最终发布、清理及边界状态。
- `artifacts/public-download-1.1.22/public-verification.json`：外网完整下载、HTTP/Range/负向路径/API检查。
- `artifacts/public-download-1.1.22/server-deployment-receipt.json`：安装时的初始回执（其中 pending 外网验收状态是历史阶段，以上方最终回执为准）。
- `artifacts/public-download-1.1.22/server-postcheck.json`：服务、启动策略、端口、公钥及文件校验。
- `artifacts/deployment/nova-chat-wss-verification.json`：匿名 WSS 鉴权验证。
- `long-term-transition-pending-20260930.json` 是授权前历史快照，不代表当前仍待授权。

### 2026-09-30 管理员已初始化；模型列表错误提示热修复

- 用户已自行成功创建首个管理员：初始化接口201，数据库管理员数量1；最新 `needsBootstrap=false`、`bootstrapTokenRequired=true`、`registrationEnabled=false`、`providerConfigured=false`。无需再次填写初始化口令或再授权SSH。
- 本次截图的“服务暂时出现问题”对应 `/v1/admin/provider/test`（“获取模型”）连续4次500；不是登录失败或整个服务停机。`provider_settings` 无记录，未见PUT保存；手机草稿仍未保存。原始异常未记入旧日志，**实际上游失败原因尚未确定，不能断言Key错误、缺少/v1、网络封锁或协议不对**。
- 已核对远端路由使用 raw aborted/close 信号；`request.signal` 只出现在说明注释中，不是本次问题。后端package仍1.1.21，APK1.1.22，不能将版本号差异当作根因。
- 仅修改后端模型列表：校验地址/请求头；DNS、TLS、连接失败、20秒超时、非JSON/不支持的列表响应、404/405输出明确且脱敏的错误；保留认证、用户取消、成功列表处理。路由日志只记录固定event、公开错误code和HTTP状态，不记录原始异常、URL、Key、请求体或上游响应。
- 本地后端250项测试（17文件）、类型检查、lint及构建通过；远端镜像内使用合成上游验证DNS/HTML/TLS/鉴权/404及成功列表，不涉及真实用户会话、API Key、计费聊天。
- 采用原镜像派生的最小持久镜像，只更新provider.js及server.js内对应路由；宿主provider.ts与server.ts对应路由同步，后续Compose重建不会丢失补丁。没有整体覆盖本地其它未发布更改，未改.env、Compose、数据卷、模型/协议/密钥或移动端，未重打APK。
- 部署备份（root-only）：`/www/backup/nova-chat-provider-discovery/20260930T050015Z`，含旧源码/运行代码、SQLite一致性快照、构建日志与回执。旧镜像tag `nova-chat-gateway:pre-provider-discovery-20260930t050015z`；回滚时还原旧镜像及这两个源码文件再Compose重建，不自动回灌数据库以免丢失用户新数据。
- 容器已恢复healthy；外网校验TLS的health/setup200，匿名provider/test及tools401，下载页/APK HEAD200且APK大小不变，/.env404。没有真实上游模型列表或认证聊天验收，下一步仅需用户留在当前页面再点击一次“获取模型”，然后查看脱敏日志。不能要求把Key/密码发到聊天；也不要擅自换上游或迁移电脑秘密。
- 本机初始化口令副本已不再需要，但精准删除操作被工具策略拒绝；**尚未删除，不可声称已清理，也不改用其它工具绕过限制**。私有路径和状态见 `.run/owner-bootstrap-delivery.json`，原受限ACL保持；需所有者手动清理该本地文本。服务器ADMIN_BOOTSTRAP_TOKEN保留（生产启动要求），已有管理员时自动拒绝再次初始化；长期SSH授权继续有效。
- 证据：`artifacts/deployment/provider-admin-error-diagnostic.json`；`artifacts/deployment/provider-discovery-fix/` 内 `gateway-tests.log`、`deployment-receipt.json`、`public-verification.json`、`postcheck.json`。不同主机时钟存在差异，不用跨主机秒级时间戳推断顺序。


### 2026-09-30 后续：模型获取实际连接超时（尚未解决）

- 用户再次点击获取模型后反馈超时。新日志确认3次 `POST /v1/admin/provider/test` 均返回504，安全代码 `provider_timeout`，耗时约277/255/256毫秒；该耗时明显短于新增的20秒整体截止时间，不能把本次错误归因为20秒上限太短。
- 手机请求已到达网关，管理页和模型读取接口200；公网直连、正常校验证书的health/setup分别约312/156毫秒、均200，容器healthy。应区分“手机→网关正常”和“网关→当前模型目标连接超时”，不能笼统让用户更换Wi-Fi或重装App。
- 在容器内用独立Node进程，对不含秘密的公开控制站点www.qq.com、nodejs.org、example.com做HEAD，均200（约141/1713/611毫秒）。这只能证明非所有出站HTTPS均失败，不能证明用户的模型服务可达，也不能据此断言地域封锁、Key错误或某条DNS记录有问题。
- 运行Node v24.21.0，默认autoSelectFamily=true、尝试超时250ms。实际模型的约255ms失败值得进一步检查多地址连接选择，但当前未保存地址、没有底层错误链，**不能据数值吻合就认定根因或盲目修改全局网络设置**。控制进程没有改生产进程，不改代理/防火墙/模型协议/Key/连接时限。
- 管理员1个、`needsBootstrap=false`，`providerConfigured=false`且provider_settings仍无记录。实际配置仅在手机草稿中，当前不能在服务器独立复测真实目标。下一步让用户保留填写内容，点击“保存”（不是再点获取模型）；源码确认保存操作不先请求上游。用户确认保存后，仅在服务器内部使用已授权保存的设置诊断DNS/TCP/TLS/模型列表，不输出URL/Key、不要求发送秘密或完整截图。
- 本轮仅只读排查和文档更新，未部署新代码或重打APK。上次发布的是错误提示/诊断修复，不代表实际模型连接已修好。证据：`artifacts/deployment/provider-timeout-diagnostic/server-diagnostic.json`、`public-health.json`、`network-controls.json`。


### 2026-09-30 保存后实测：配置存在，但当前官方直连入口不可达

- 用户表示已保存，已确认 `PUT /v1/admin/provider` 200，数据库配置行存在、Base URL/加密Key均已设置。最新 `needsBootstrap=false`、`providerConfigured=true`、`registrationEnabled=false`，管理员1个。**providerConfigured=true仅代表有配置，不代表连接或聊天验收通过。**
- 仅在服务器受控子进程内读只读SQLite并解密用户主动保存的Key，凭据仅用于该已配置目标的GET /models。没有将Key/完整URL/上游IP/原始响应打印、回传电脑、写入诊断文件或迁移到其它服务。
- 实际目标被布尔核对为OpenAI官方API直连域名（未输出完整地址），不是第三方服务商入口。协议responses、Bearer，标准443、路径含/v1。Key的发行平台未知，不能凭前缀/模型名猜测，也不能替用户换成电脑上的第三方Key。
- DNS返回1个IPv4和1个IPv6；默认GET /models约303ms以ETIMEDOUT+ENETUNREACH失败。将地址族尝试时间只在独立诊断进程内从250ms改为5000ms后，仍约5004ms失败；生产进程及配置未变，不是简单提高超时即可验证修复。
- 容器按地址TLS探测：IPv4约6秒超时，IPv6立即ENETUNREACH；宿主机直接探测同一目标IPv4在TCP连接阶段9秒超时，IPv6无路由。这说明问题不只发生在App或Docker内；**尚未建立连接/收到HTTP响应，Key有效性和模型可用性都未验证，不可称OpenAI已返回地域403或密钥401。**
- 公共DNS对比返回不同IPv4，Cloudflare DoH探测ECONNRESET；该证据不足以断言DNS污染是唯一原因。没有固定DNS地址、关闭TLS、添加代理、迁移服务器、修改防火墙或购买资源。
- 2026-09-30尝试检索并打开OpenAI官方Supported countries页面，但工具未返回可读正文或可用引用，因此本轮未完成当前支持地区政策核实，不将政策写成已验证事实。若确认是官方Key，再核对官方当前支持地区与条款；当前已验证的只有网络建连失败，尚未观测到HTTP地域拒绝。
- 当前App网关外网TLS health/setup均200、容器healthy；本轮未改源码、重启服务或重打APK，未发起聊天生成/计费测试。保留现有配置和长期SSH授权。
- 下一步只需确认这把Key是在哪个平台申请/购买的（平台名称，不要Key/密码/未遮挡截图）。若是第三方Key，按该服务商官方文档核对并由用户授权输入匹配端点；不得擅自将已有Key发到猜测或无关的第三方。若是官方Key，需选择符合官方地区政策的使用/部署方案，不承诺当前华南直连可靠，也不自动新增付费资源。
- 证据目录 `artifacts/deployment/provider-saved-diagnostic/`：`saved-state.json`、`actual-provider.json`、`network-path.json`、`final-health.json`，均为脱敏结果。先前“未保存”状态仅为历史快照。


### 2026-09-30 已修复：匹配用户确认的服务商，公网认证聊天通过

- 用户确认API Key来自kxai；此前保存的官方直连目标与该服务商不匹配。已读取用户指定平台公开接入模板，确认其同域/v1及Responses方式；不是猜测未知第三方。web工具未返回可读结果，公开页面与前端资产通过HTTPS直接读取留存在证据目录。
- 仅使用服务器已有加密凭据，在服务器受控子进程内解密并发送给用户确认的平台；没有将聊天中新发出的密钥写入命令、脚本、配置副本或日志，也没有读取电脑上的其他密钥。首次模型探测HTTP200、约186ms，12个模型，包含现有默认模型gpt-5.6-sol。
- 先做服务器本地SQLite一致性备份：`/www/backup/nova-chat-provider-endpoint/20260930T065117Z`，目录0700、数据库文件0600。不应下载或公开其内容。
- 通过现有管理员PUT路由保存匹配入口，HTTP200；保持同一密钥、Responses/Bearer、默认模型及原允许模型列表不变，密钥仍使用现有SERVER_MASTER_KEY加密。配置持久写入SQLite，无需服务重启，不是临时代理或进程内覆盖。
- 管理员模型测试路由HTTP200，返回12个模型且包含默认模型；应用/v1/models仍按原允许模型列表返回，没有擅自开放全部模型。
- 已完成一次有真实上游调用的合成聊天：服务器诊断进程访问公网HTTPS/WSS入口，通过管理员认证、模型目录、流式start/delta/done；默认模型约8034ms返回OK。仅发固定测试文本，maxOutputTokens=256、所有工具关闭，不读取/发送私人聊天，不做重复计费测试。
- 为调用正式管理员路由创建的5分钟临时验证会话仅存于服务器内存/哈希数据库，finally已精确删除并确认；没有改管理员密码、注销用户手机会话或撤销长期SSH维护授权。
- 独立电脑访问公网HTTPS：health/setup均200；匿名auth/me与models均401，鉴权保护保持正常。上述认证WSS测试从服务器发起、经公网地址，不等于手机运营商端到端真机验收；真机操作仍需用户自行确认。
- 本轮仅更新模型入口配置与文档，没有改应用源码、镜像、DNS、防火墙、TLS校验或APK；原1.1.22/code24安装包及下载地址不变。
- 证据：`artifacts/deployment/provider-kxai-fix/model-probe.json`、`deployment-receipt.json`、`public-verification.json`；均为脱敏结果。服务器和工作站使用各自时钟，不据跨机器时间戳推断执行先后。
- 已提醒用户密钥发到聊天后应在平台轮换，新密钥只填App管理设置；本轮未擅自轮换/吊销。下一步直接回手机聊天页发送测试消息，不要在残留旧草稿的管理表单上重复保存。
