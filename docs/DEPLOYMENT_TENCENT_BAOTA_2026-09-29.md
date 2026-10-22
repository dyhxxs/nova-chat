# Nova Chat 腾讯云 / 宝塔部署记录

验证日期：2026-09-29（Asia/Shanghai）。这是部署快照，不是持续监控或完整安全审计。

## 当前状态

- 公网 API 入口：`https://134.175.139.81`。
- 健康检查：`https://134.175.139.81/health`，外部 TLS 正常校验后返回 HTTP 200。
- WebSocket：`wss://134.175.139.81/v1/chat/stream`。已从外网完成 TLS、升级与帧收发；未登录消息得到 `unauthorized` 并以 4401 关闭，符合鉴权设计。
- 已部署的是 API 后端，不是网页聊天界面；根路径 `/` 不承诺有页面。
- **尚未创建首个管理员、未配置上游模型服务；未完成真实认证聊天、附件、移动端端到端验收。**
- 这次没有更改移动端源码、内置网关地址或生成新 APK。当前本地客户端版本为 1.1.21/code23，旧候选包是否仍指向旧地址需要单独确认。

## 运行结构与路径

```text
Ubuntu 26.04
  宝塔 Nginx: 80 -> 308 HTTPS（ACME 挑战除外）
               443 TLS -> 127.0.0.1:8787
  Docker Compose gateway
               -> nova-chat_nova-chat-data 持久卷
```

| 项目 | 路径 / 标识 |
| --- | --- |
| 项目目录 | `/www/dyh/nova-chat` |
| Compose 服务 / 容器 | `gateway` / `nova-chat-gateway-1` |
| 数据卷 | `nova-chat_nova-chat-data` |
| 服务器秘密配置 | `/www/dyh/nova-chat/services/gateway/.env`（600 root:root） |
| 宝塔站点 | `134.175.139.81`，站点 ID 1 |
| 宝塔反代记录 | `nova-gateway`，目标 `http://127.0.0.1:8787`，关闭缓存 |
| Nginx 站点配置 | `/www/server/panel/vhost/nginx/134.175.139.81.conf` |
| Nginx 反代配置目录 | `/www/server/panel/vhost/nginx/proxy/134.175.139.81/` |
| 不记录查询字符串的日志格式 | `/www/server/panel/vhost/nginx/0.nova-chat-log-format.conf` |
| 站点访问日志 | `/www/wwwlogs/134.175.139.81.log` |
| ACME webroot | `/www/wwwroot/134.175.139.81` |
| 证书 lineage | `/etc/letsencrypt/live/nova-chat-ip` |
| 宝塔证书目录 | `/www/server/panel/vhost/cert/134.175.139.81`，指向上述 lineage 的软链接 |
| 续期部署 hook | `/etc/letsencrypt/renewal-hooks/deploy/nova-chat-nginx.sh` |

API 反代已关闭响应缓冲、请求缓冲和缓存，配置 Upgrade/Connection、长连接超时；覆盖转发 IP 而不是信任客户端传入的 X-Forwarded-For。实际完整聊天流式行为仍待管理员与上游配置后验证。

Docker 服务为 enabled/active，容器为 healthy，重启策略 `unless-stopped`。Nginx 由宝塔 init 脚本管理，进程和 80/443 监听正常，rc2/3/4/5 启动链接已存在；`systemctl is-active nginx` 本次返回 inactive，不能单独据此判断宝塔管理的 Nginx 已停止。未为验证而重启机器。

## HTTPS 与续期

已签发公开可信的 Let's Encrypt IP 证书，SAN 包含 `134.175.139.81`；验证未使用 `-k` 或关闭 TLS 校验。

初次证书到期时间为 **2026-10-06 07:29:22（中国标准时间）**。IP 证书是短期证书，不能当作普通 90 天证书处理，必须保持自动续期。

- 安装版本：Certbot snap 5.8.0。
- `snap.certbot.renew.timer` 已 enabled/active。
- 使用 HTTP-01 webroot 和 `shortlived` profile；80 端口及 `/.well-known/acme-challenge/` 必须保持可用。
- 续期成功后 hook 先做 `nginx -t`，再平滑 reload。
- 已实际运行 `renew --dry-run --run-deploy-hooks`，所有模拟续期成功，hook 检查与 reload 后健康接口正常。
- 未额外启用宝塔的另一套证书续期，避免互相覆盖。不要替换证书软链接。

维护时的检查命令（无需用户现在执行；不会显示网关秘密）：

```sh
sudo /www/server/nginx/sbin/nginx -t
sudo systemctl list-timers --all --no-pager | grep certbot
sudo journalctl -u snap.certbot.renew.service --since '7 days ago' --no-pager
sudo /snap/bin/certbot certificates --cert-name nova-chat-ip
curl --fail https://134.175.139.81/health
```

需要再次检查续期时，避免频繁重复执行：

```sh
sudo /snap/bin/certbot renew --cert-name nova-chat-ip \
  --dry-run --run-deploy-hooks --non-interactive \
  --no-random-sleep-on-renew
```

## 备份与未改动内容

操作前备份位置：

```text
/www/backup/nova-chat-deploy/20260929T082208Z
```

包含宝塔数据库一致性备份、原 Nginx 配置、Compose、网关 `.env` 和 SQLite 一致性快照；目录为 root 限制访问。此处包含秘密，不得直接下载到公开目录或附进报告。

这只是**本次部署前的同机快照**，不是已配置的每日自动备份，也不是异地备份。后续需要单独安排数据库、上传附件与主密钥配套备份并验证恢复。不要盲目还原整个宝塔数据库或运行 `docker compose down -v`。

本次没有重建/重启网关容器，没有重新生成 SERVER_MASTER_KEY 或 bootstrap token；`.env` 与部署前备份逐字节比较一致。容器的数据卷保持不变。

## 安全边界

- 网关 8787 仅绑定到 `127.0.0.1`，外部连接测试不可达。
- 已验证匿名受保护接口返回 401，`.env`、源码配置探测返回 404。
- 注册关闭、自动管理员关闭，首个管理员初始化需要 bootstrap token。
- 本次未登录腾讯云控制台，未独立核验或修改云安全组；不能把本报告当作“所有端口都已经收紧”。主机 UFW/firewalld inactive，存在宝塔/YJ iptables 链，不能只凭管理器状态断言所有网络访问被拒绝。
- 主机还存在宝塔默认 Nginx 888 监听，本次未改动它。后续应复核云安全组只公开业务所需入口，管理端口按实际管理来源限制；不要全端口放开。
- 聊天记录中曾出现的服务器密码应由所有者另行更换，本次未修改密码、未使用该密码登录。
- 临时 SSH 密钥只服务于本次部署，交付前只撤销这一把授权，不影响其它 authorized_keys 条目。最终撤销结果以本地 `nova-chat-authorization-revocation.json` 为准。

## 仍需完成的应用初始化

1. 在支持自定义网关地址的 Nova Chat App 中使用 `https://134.175.139.81`，不要使用 HTTP 或公网 8787。
2. 使用服务器上的 bootstrap token 初始化首个管理员。管理员账号由用户自己决定，不使用示例邮箱充当真实账号。
3. 在管理员控制台填写真实上游 Base URL、API Key、协议与模型并测试。不得将 token、API Key 或管理员密码粘贴到聊天、截图、版本库或日志。
4. 完成真正登录、WSS 流式回复与手机端验证；如需默认连此服务器的新 APK，另行修改移动端网关配置并重新构建验收。

## 本地证据与操作脚本

位于 `E:\gptapp\artifacts\deployment\`（被 Git 忽略）：

- `nova-chat-live-verification.json`：HTTPS/HTTP、鉴权、文件泄漏探测、8787 外部测试。
- `nova-chat-wss-verification.json`：外部 WSS 握手、帧响应和 4401 鉴权关闭。
- `nova-chat-final-server-checks.txt`：服务、权限、环境文件一致性和宝塔记录快照。
- `nova-chat-renewal-verification.json`：续期 dry-run 结果记录。
- `nova-chat-authorization-revocation.json`：临时授权移除及新 SSH 连接拒绝结果。
- `nova-chat-final-health.json`：撤销后外部 HTTPS 健康状态。

目录内的部署 `.sh` 为本次运行记录，部分只适用于初次安装，**不要批量重跑**。

官方依据（供维护人员核对）：

```text
https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability/
https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates
```

## 交付收尾确认

2026-09-29：已撤销本次临时公钥授权，其他授权条目逐字节保留；以同一私钥全新 SSH 连接返回 Permission denied。撤销后外部 HTTPS 健康检查仍为 200。此段为本地交付补记，服务器说明副本以撤销前的维护信息为准。


## 2026-09-30 后续：长期授权与公网安装包下载

本节是后续新增记录，覆盖前文“之后每次用临时授权”的维护方式；2026-09-29 那把临时密钥仍保持已撤销。用户另行明确批准的长期可撤销 SSH 专用密钥已成功安装和验证，交付后保持有效，不要自动删除。

- HTTPS 下载页：`https://134.175.139.81/download/`。
- APK：`https://134.175.139.81/downloads/NovaChat-1.1.22-android-arm64.apk`，1.1.22/code24 ARM64，38,006,882字节。
- SHA256：`308a8b523ccc5373fb70e3f0ad2b5c068556f34aebe2729e02c12a2995638c16`，公网完整下载核验一致。
- 仅将三个公开文件发布到 `/www/nova-public/releases/1.1.22/`，在现有 extension include 下添加 `nova-chat-downloads.conf`。原站点与API反代配置的SHA256保持不变；没有修改证书/ACME、网关环境或数据库、没有重启网关。
- 本次配置备份 `/www/backup/nova-chat-public-download/20260930T030528Z-63221c3c3b/` 为 root-only 非Web目录；验收后本次私有上传暂存已清理。
- 外网TLS、完整APK/Range、负向路径404、API和匿名WSS检查通过。Docker/网关自启动策略和证书续期timer保留并复查正常；未做服务器重启测试。
- APK下载不再要求同一Wi-Fi，本轮沿用已构建并验收的同一包，没有重建。
- 管理员和上游模型仍未初始化；不代表已完成真实聊天、真机或所有云安全组/备份验收。

完整规则、证据与未完成项见 `docs/LONG_TERM_MAINTENANCE_2026-09-30.md`。不要再要求用户重复粘贴授权命令。

## 2026-09-30 最新状态补充：管理员与模型列表诊断

上文未初始化状态是各次部署时的历史快照。用户现已创建1个管理员（needsBootstrap=false），但模型配置未保存（providerConfigured=false）。获取模型的500未记录原始异常；已部署明确且不泄密的错误分类和诊断日志，容器healthy，公网API及下载验收通过。实际上游仍需再次触发以确认，不能声称聊天已修复。没有改动移动端/原下载包/环境密钥/数据卷。详情见 `LONG_TERM_MAINTENANCE_2026-09-30.md` 最新补充。
