# Nova Chat 1.1.38 — 发布与服务器更新记录（2026-11-02）

## 结论

本地代码已提交并推送到公开仓库，生产服务器已从 1.1.36 更新到 1.1.38 并保持运行，更新前后的代码与数据库均已在服务器留下可校验备份。

- GitHub：`dyhxxs/nova-chat` 分支 `main`，提交 `a3d2127`（`db05189..a3d2127`）。推送前 `npm run verify` 全绿（mobile 523 + gateway 477 + scripts 85 项测试、typecheck、lint）。
- 生产：`https://134.175.139.81`，容器 `nova-chat-gateway-1`，镜像内 `package.json` 版本 **1.1.38**，状态 healthy。
- 历次静态 APK `NovaChat-1.1.38-android-universal.apk` 保持可下载（HTTP 200，64,763,438 字节）。

## 本次提交范围

76 个文件、+2982/−336。主要内容：

- mobile：语言学习与背词卡（`LanguageLearningScreen`、`studyDeck`、`StudyPracticePanel`）、会话同步客户端与桌面侧栏；
- gateway：`conversationSyncRoutes`、`languageLearningRoutes`、同源网页托管 `webStatic`；
- compose：新增 `WEB_DIR=/app/web` 与 `./apps/mobile/dist/web` 只读挂载；
- 文档：部署、陪伴与安全说明同步。

未提交（保持公开仓库原有的排除策略）：`services/gateway/.env`、SQLite 与上传目录、`key.txt`、以及本次新增到 `.gitignore` 的本机临时文件 `NUL;`、`image.png`、`ocr_result.json`、`.tmp-gw-test/`。

## 服务器变更

| 项目 | 变更前 | 变更后 |
| --- | --- | --- |
| 代码目录 | 纯文件拷贝，非 Git 仓库 | `/www/dyh/nova-chat` 为 `origin/main` 的 Git 检出（`a3d2127`） |
| 后端版本 | 1.1.36 | 1.1.38 |
| 容器端口 | `0.0.0.0:8787`（对公网可达） | `127.0.0.1:8787`（仅本机，由 Nginx 反代） |
| 网关监听 | `HOST=0.0.0.0`（.env 未改） | 不变；对外只暴露 443 |

端口收敛通过项目根新增 `.env`（`GATEWAY_BIND_ADDRESS=127.0.0.1`，600 权限，已被 `.gitignore` 忽略）实现。Nginx 反代目标本就是 `http://127.0.0.1:8787`，因此对外行为不变。

服务器原有的 `DEPLOYMENT_LIVE_2026-09-29.md`、`DEPLOY_BAOTA.md`、`DEPLOY_MANIFEST.json`、`web/` 为未跟踪文件，本次检出未改动它们。

## 备份（均在服务器，root 0700）

更新前的安全快照：

```text
/www/backup/nova-chat-pre-1.1.38-20261102T011542Z/
  code-before-1.1.38.tar.gz    20,295,738 字节（已排除 .env、data、node_modules）
  db/nova-chat.sqlite          548,864 字节，integrity_check=ok，user_version=1
  gateway.env.bak              3,485 字节（含密钥，600）
  uploads-index/count.txt      69 个文件 / 46 MB（仅清单，未复制）
  pre-state.txt, running-image.txt
```

回滚镜像标签：`nova-chat-gateway:pre-1.1.38-20261102T011542Z`（原运行镜像 `4f3f29cab891`）。

从本机迁移的代码与本地数据库备份：

```text
/www/backup/nova-chat-code-20261102T011542Z/     ← sha256sum -c 全部 OK
  nova-chat-1.1.38-20261102T011542Z.bundle                完整 Git 历史（git bundle --all）
  nova-chat-source-1.1.38-20261102T011542Z.tar.gz         HEAD 源码快照
  nova-chat-local-databases-20261102T011542Z.tar.gz       本机开发库与上传目录
  SHA256SUMS.txt
```

## 更新后验收

| 检查项 | 结果 |
| --- | --- |
| 容器状态 / 镜像内版本 | running / healthy，1.1.38 |
| `127.0.0.1:8787/health` | 200 `{"ok":true,...,"defaultModel":"gpt-5.6-sol"}` |
| `127.0.0.1:8787/readyz` | 200 |
| 公网 `https://134.175.139.81/health` | 200 |
| 公网 `/readyz` | 200 |
| APK HEAD（1.1.38 universal） | 200 |
| 数据卷 SQLite | integrity ok，users 7，conversations 15，uploads 69 个文件 |
| 日志 error/fatal | 无 |

## 两个非故障现象

- 未知路径（含 `/.env` 探测）现在返回 **200 + 网页外壳 `index.html`**：1.1.38 新增同源网页托管，未命中文件时回退到 SPA 首页。响应体不包含任何 `.env` 内容，与旧版"探测返回 404"的差异只是路由回退行为。
- 匿名访问 `/v1/auth/sessions` 返回 **426 `upgrade_required`**：这是应用内最低版本闸门（`NOVA_MINIMUM_APP_VERSION_CODE=40`，最新 1.1.38），不是鉴权失效，也不是 200。

## 回滚步骤

```bash
cd /www/dyh/nova-chat
sudo git -c safe.directory=/www/dyh/nova-chat log --oneline -1     # 当前 a3d2127
# 1) 回到旧代码
sudo git -c safe.directory=/www/dyh/nova-chat checkout -f <旧提交>
# 2) 或用更新前快照
sudo tar xzf /www/backup/nova-chat-pre-1.1.38-20261102T011542Z/code-before-1.1.38.tar.gz -C /www/dyh/nova-chat
# 3) 用旧镜像直接起
sudo docker tag nova-chat-gateway:pre-1.1.38-20261102T011542Z nova-chat-gateway:latest
sudo docker compose up -d gateway
```

数据库仅在 `DATABASE_SCHEMA_VERSION` 未变（仍为 1）时可直接回退；**不要**把 `db/nova-chat.sqlite` 覆盖回数据卷，否则会丢失更新后产生的新数据。

## 后续日常更新

服务器已是 Git 检出，后续更新不再需要拷贝文件：

```bash
cd /www/dyh/nova-chat
sudo git -c safe.directory=/www/dyh/nova-chat fetch origin main
sudo git -c safe.directory=/www/dyh/nova-chat checkout -f main
sudo git -c safe.directory=/www/dyh/nova-chat pull --ff-only
sudo docker compose build gateway && sudo docker compose up -d gateway
```
