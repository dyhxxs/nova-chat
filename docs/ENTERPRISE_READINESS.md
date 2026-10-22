# Nova Chat 企业级运行说明

本文记录当前源码已经实现的运行保障边界，面向部署、运维和面试验收使用。它不把单机 Docker 部署描述成已经验证过的大规模生产集群。

## 探针和请求关联

网关提供三个用途不同的 HTTP 检查接口：

| 接口 | 用途 | 失败含义 | 是否访问上游模型 |
| --- | --- | --- | --- |
| `/health` | 兼容旧客户端的服务摘要 | 进程未能响应 | 否 |
| `/healthz` | 存活探针 | 进程或 HTTP 服务不可用 | 否 |
| `/readyz` | 就绪检查 | SQLite 不可用时返回 `503`；数据库可用但尚未配置模型时返回配置状态 | 否 |

`/readyz` 会执行 `SELECT 1`，并检查数据库中的模型服务是否具备 Base URL、默认模型、允许模型列表以及所需鉴权 Key。首次管理员初始化前，数据库可用而模型尚未配置是允许启动的状态；响应会明确标记 `provider: unconfigured`，不会把 Key 或 URL 中的凭据返回给客户端。收到 `SIGTERM` 或 `SIGINT` 时，进程先进入 draining 状态：`/healthz` 仍报告进程存活，`/readyz` 返回 `503`，新的业务请求返回可重试的 `server_draining`，随后才关闭 WebSocket、正在运行的任务和数据库连接，适合反向代理执行滚动更新。

每一个 HTTP 响应都会返回 `X-Request-ID`。客户端可以传入由字母、数字、点、下划线、冒号和短横线组成的最多 128 个字符的值；不符合格式的值会被网关替换为随机 UUID。发生错误时，响应体也会带同一个 `requestId`，便于把用户看到的错误和网关日志关联起来。

部署完成后可运行 `npm run gateway:smoke -- http://127.0.0.1:8787` 做无凭据运行时验收。脚本设置请求超时，限制响应体大小，禁止重定向，验证两个探针的 JSON、服务名、数据库状态和请求 ID；它不会访问模型，也不会要求 Session Token。Provider 尚未配置时，只要 SQLite 正常，脚本会报告 `provider: unconfigured` 并通过，便于先验收容器和数据卷再完成管理员初始化。

管理员可以通过 `GET /v1/admin/audit?limit=50&before=<id>` 查看认证、账户、模型配置和陪伴角色等关键操作的分页审计记录。接口只允许管理员访问，返回操作类型、目标标识、操作者邮箱和时间，不返回密码、Token、模型 Key 或消息正文；`nextBefore` 可作为下一页游标。

## 日志和指标

Fastify 日志会脱敏 `Authorization`、Cookie、`X-API-Key`、密码、管理员初始化口令、模型 Key、Base URL、消息正文和工具指令。日志中可以记录请求 ID、错误类型和 HTTP 状态码，不能据此恢复第三方凭据或用户正文。

Prometheus 指标默认关闭：

```dotenv
METRICS_ENABLED=true
METRICS_TOKEN=<至少 24 个字符的随机值>
```

开启后访问：

```bash
curl -H "Authorization: Bearer $METRICS_TOKEN" https://chat.example.com/metrics
```

生产环境开启指标而没有至少 24 个字符的 `METRICS_TOKEN` 时，配置校验会拒绝启动。指标只包含按 HTTP 方法、Fastify 路由模板和状态码聚合的计数、累计耗时、活跃请求数和进程运行时间；无法匹配到路由模板的请求统一记为 `/unknown`，不会把用户 ID、文件名或完整动态 URL 写进标签。

## 反向代理和真实来源地址

`TRUST_PROXY` 默认是 `false`。只有当网关前面确实存在会覆盖转发头、并且来源受防火墙限制的 Caddy、Nginx 或负载均衡器时才设置为 `true`。登录失败限流按来源 IP 和邮箱组合计算；在不可信代理后面开启 `TRUST_PROXY` 会让客户端伪造 `X-Forwarded-For`，削弱这层保护。

Compose 默认把 Gateway 以非 root 用户运行，并启用了只读根文件系统、`/tmp` 临时内存盘、`no-new-privileges` 和 capability drop；只有命名卷 `/app/data` 可写。若以后新增运行时需要写入的目录，必须显式挂载专用卷并重新执行启动、上传和恢复验收。

反向代理需要：

- 对外只开放 HTTPS 和 WSS；
- 正确传递 `X-Forwarded-For`、`X-Forwarded-Proto` 和 WebSocket Upgrade；
- 将网关端口只绑定到本机或私有网络；
- 为长连接设置足够的读取超时；
- 不把 `/metrics` 暴露到公共互联网，或同时使用网络层限制和 Token。

## 数据、密钥和备份

命名卷 `nova-chat-data` 中包含 SQLite 数据库、WAL 文件和用户上传目录。备份必须覆盖整个数据目录，不能只复制主 `.sqlite` 文件。`SERVER_MASTER_KEY` 与备份数据共同决定已保存 Provider Key 能否解密，因此需要纳入秘密管理和恢复演练，但不要把它写入仓库、镜像或移动端包。生产环境必须显式使用该变量；旧版 `APP_ACCESS_TOKEN` 仅保留为兼容共享登录口令，不能替代数据库加密主密钥。

仓库提供了可审计的备份、校验和隔离恢复脚本。脚本不会读取或输出 `.env`、主密钥或模型 Key；备份目录应由部署人员另行加密并限制访问。建议在网关停止或已暂停写入时执行：

```bash
npm run gateway:backup -- \
  --data-dir /path/to/nova-chat-data \
  --output-dir /path/to/backups/nova-chat-2026-10-19T120000Z

npm run gateway:backup:verify -- \
  --backup-dir /path/to/backups/nova-chat-2026-10-19T120000Z
```

备份工具使用 SQLite `VACUUM INTO` 生成一致的数据库副本，复制 `uploads/`，将旧的绝对附件路径转换为相对路径，并校验 SQLite 完整性、外键、附件数量、附件大小、附件 SHA-256 和清单中的数据库哈希。目标目录必须位于 `DATA_DIR` 之外，且已存在的目标目录不会被覆盖。

恢复必须先在隔离目录执行，目标 `DATA_DIR` 需要是尚不存在的新目录：

```bash
npm run gateway:backup:restore -- \
  --backup-dir /path/to/backups/nova-chat-2026-10-19T120000Z \
  --data-dir /path/to/recovery/nova-chat-data
```

恢复脚本会先校验清单，再复制数据库和附件，并在目标目录内再次执行完整性和附件校验。恢复后使用同一 `SERVER_MASTER_KEY` 启动临时网关，检查 `/readyz`、管理员登录、资料查询和附件下载；确认成功后再决定是否切换正式数据目录。

建议的单机流程是：

1. 暂停网关写入或停止容器；
2. 使用上述脚本生成并校验备份；
3. 加密保存备份，并记录备份时间和源码版本；
4. 在隔离目录使用同一主密钥恢复副本；
5. 检查 `/readyz`、管理员登录、模型配置和一条资料库查询；
6. 通过恢复演练确认附件可以读取，再更新备份保留策略。

备份频率、保留周期和恢复点目标应根据真实业务数据决定。当前仓库没有自动把备份上传到云端，也没有声称已经验证某个云厂商的灾备目标。

## 更新和恢复验收

更新前应运行：

```bash
npm ci
npm run verify
npm run build
docker compose build --pull gateway
docker compose up -d gateway
```

容器更新后至少检查：

```bash
docker compose ps
npm run gateway:smoke -- http://127.0.0.1:8787
docker compose logs --tail=100 gateway
```

使用反向代理或编排平台时，应把 `SIGTERM` 后的排空窗口设置为长于最长允许的模型请求时间，并以 `/readyz` 从 `200` 变为 `503` 作为摘流信号。不要只依赖进程退出码判断滚动更新是否安全。 Compose 已为网关配置 90 秒停止宽限期；如果实际模型请求可能超过该时长，应同步调整 Compose 和反向代理的超时。

若 `/readyz` 返回 `provider: unconfigured`，这表示网关和数据库已经可用，但管理员还没有保存完整的模型服务配置；完成初始化和配置后重新检查。若数据库检查失败，先停止反复重启，保留容器日志和数据卷快照，再按恢复流程处理。

## 当前限制

当前实现适合单机或小规模自托管部署：SQLite、单进程内存限流和内存指标不会自动扩展成多副本共享状态；没有自动故障转移、MFA、后台备份、集中式日志或云监控配置。知识库默认是 SQLite FTS5 词法排序 baseline，另有可通过 `KNOWLEDGE_RETRIEVAL_STRATEGY` 切换的 FTS5 BM25 实验策略；当前还没有向量检索、混合检索或生产规模评测证据。模型可用性、延迟、成本和回答质量仍受上游服务商影响，必须通过实际部署和评测数据单独验证。

## 依赖审计

Gateway 是生产容器的安全边界，CI 对它单独执行：

```powershell
npm run security:audit:gateway
```

2026-10-19 的 Gateway 生产依赖审计通过，未发现高危或更高等级漏洞。完整工作区审计仍会报告移动端 Expo / React Native 依赖树中的 45 个高危项，主要涉及 Metro、`node-forge`、`braces` 和 React Native 工具链；当前 `npm audit fix --force` 建议把 Expo 降到 44，和本项目的 Expo 57 运行时不兼容，因此没有执行。移动端依赖升级需要按 Expo SDK 兼容矩阵单独验证，并在下一次移动端发布前关闭这项审计债务。Gateway Docker 镜像只安装 Protocol 和 Gateway workspace，不会把移动端依赖带入服务端镜像。
