# Nova Chat 架构

## 1. 总览

Nova Chat 由三个工作区组成：

```text
@nova-chat/mobile    Expo / React Native 移动端
@nova-chat/protocol  共享 Zod 协议、REST/WS 消息类型
@nova-chat/gateway   Fastify、SQLite、附件和第三方模型代理
```

推荐数据流：

```text
Mobile App
  │  HTTPS: auth / admin / models / files / REST fallback
  │  WSS: independent streaming generation
  ▼
Gateway
  ├─ Authentication / RBAC
  ├─ Rate limit / concurrency gate
  ├─ SQLite + encrypted provider settings
  ├─ Per-user file authorization
  └─ Provider adapter
        ├─ Responses API
        └─ Chat Completions API
```

第三方 API Key 只存在于网关运行时和加密数据库中。普通用户仅持有自己的 Session Token。

## 2. 认证生命周期

1. 客户端请求 `/v1/setup/status`。
2. 尚无管理员时，使用 `ADMIN_BOOTSTRAP_TOKEN` 调用 `/v1/auth/bootstrap`。
3. 用户通过 `/v1/auth/register` 或 `/v1/auth/login` 获取 opaque Session Token。
4. 客户端将 Token 保存到 SecureStore，并用 `/v1/auth/me` 验证恢复。
5. REST 使用 `Authorization: Bearer <session>`。
6. WebSocket 连接后首先发送 `hello`，包含 Session Token 和设备 ID。
7. 退出、禁用或过期后，Session 不再通过认证。

数据库不会保存明文 Session Token。WebSocket 只在完成 hello 后接受生成请求。

## 3. 管理员模型配置

管理员可配置：

- API Base URL；
- API Key；
- `responses` 或 `chat-completions`；
- `bearer`、`api-key` 或 `none` 鉴权；
- 默认模型；
- 允许模型列表。

保存时，Key 使用 AES-256-GCM 加密。读取管理员配置时只返回 `apiKeySet` 和末四位预览。普通用户通过 `/v1/models` 读取允许模型和默认模型。

环境变量中的 `OPENAI_*` 是首次启动/数据库未配置时的服务器默认值，不需要打进 App。

## 4. 会话与并发状态机

移动端不再使用全局单一 generation。它维护：

```text
Map<requestId, ActiveGeneration>
```

每个 `ActiveGeneration` 包含独立的：

- `requestId`；
- WebSocket/REST generation handle；
- cancel 回调；
- 生命周期清理逻辑。

结果：

- A 对话生成时可以切换到 B 并继续发送；
- A 对话上一条回答生成时，也可以继续发送下一条请求；
- Stop 取消当前对话的所有活动请求；
- 后台 delta 只写入原对话；
- 删除对话会取消对应后台请求；
- 旧请求的完成回调不能误删同一对话中新请求的状态。

服务端并发按认证用户 ID 控制，而不是仅按客户端提供的 device ID。默认允许每个用户 2 个并发生成，可通过 `MAX_CONCURRENT_PER_DEVICE` 调整（变量名为兼容旧配置保留）。

## 5. 流式协议与稳定性

WebSocket 消息包括：

```text
client: hello, start, cancel, ping
server: ready, started, delta, done, cancelled, error, pong
```

稳定性策略：

- 10 秒 hello 超时；
- 服务端定期发送 heartbeat；
- 客户端每 20 秒发送 ping；
- 70 秒无任何活动才判定 `stream_stalled`；
- 握手前失败且尚未开始生成时，可使用 REST fallback；
- 收到 `started` 或任意 delta 后断线，不自动重试，防止重复计费；
- partial 正文保留，并标记为错误/取消；
- 所有完成路径都清理计时器、Socket 和 active generation。

## 6. 上下文构建

发送前通过统一的 `buildConversationContext()` 构建历史：

- 只纳入用户消息和状态为 `complete` 的助手消息；
- `streaming`、`error`、`cancelled` 助手消息不进入下一轮；
- 完成的图片助手消息即使没有文字也会作为图片上下文保留；
- 消息附件引用随历史保留；
- 从最近消息向前截取，受本地预算和服务端 `MAX_HISTORY_CHARS` 双重限制；
- 当前用户消息只插入一次，不会在重试/附件上传期间串到别的对话。

这避免了半截模型输出、错误提示和取消内容污染后续上下文。普通视觉问题会把历史助手图片转换为兼容的图片输入；带有“不满意、改成、换背景、全身”等可执行修改意图的图片追问则自动走图片生成路由，并携带原始创作要求与修改链。当前为跨服务商兼容，使用 `/images/generations` 的文字重建方式，而不是假定所有服务商都支持统一的 `/images/edits`。

## 7. 模型身份

请求中加入稳定身份说明：

- 产品名为 Nova；
- 实际请求模型 ID 由管理员选择；
- 不应仅根据训练先验自称 DeepSeek、ChatGPT 或其他品牌；
- 不应谎称是官方客户端。

该策略降低错误身份回答，但模型输出本质上仍是概率生成，不能保证 100% 正确。UI 固定显示 Nova，副标题显示实际模型 ID，避免把模型生成的自我描述当成可信元数据。

## 8. 附件数据流

1. 用户通过 Expo ImagePicker/DocumentPicker 选择文件。
2. App 检查数量和已知大小。
3. App 使用认证请求上传到 `/v1/files`。
4. 网关限制大小、类型、真实签名，并以 UUID 存储。
5. 网关返回公开 `AttachmentRef`。
6. App 将引用加入消息和生成请求。
7. Provider adapter 再按协议转换为第三方 Responses/Chat Completions 输入。

权限规则：普通用户只能读取自己的文件；管理员可以读取。PDF 只映射到 Responses 模式。移动端只有 Gateway 连接模式，因此所有附件都先上传到 Gateway，再由 Provider adapter 按协议转换。

## 9. Provider adapter

### Responses

可映射：

- 文本输入；
- 图片；
- PDF；
- reasoning effort / verbosity；
- Web Search；
- Code Interpreter；
- 流式文本事件。

### Chat Completions

可映射文字、兼容服务商支持的图片、reasoning effort 和 verbosity。PDF、Responses 原生工具通常不可用。

第三方“OpenAI-compatible”经常只兼容一部分字段。Nova 会发出兼容请求并返回清晰错误，但不能让不支持工具的服务商凭空拥有这些能力。

## 10. 数据库

SQLite 表：

- `users`：账号、密码摘要、角色、禁用状态；
- `sessions`：Token 哈希、设备 ID、过期时间；
- `provider_settings`：加密 Key 和模型配置；
- `files`：附件元数据和所有者；
- `audit_log`：关键管理/认证操作；管理员可通过 `GET /v1/admin/audit` 按游标分页读取脱敏事件。

数据库启用 WAL、外键和 busy timeout。当前设计适合单实例或小规模部署。多实例部署需要共享数据库、对象存储、分布式限流和一致的主密钥。

## 11. 能力边界

Nova 不是官方 Codex 的完整复制。安全的代码代理至少还需要：

- 仓库连接和版本控制语义；
- 隔离容器/虚拟机；
- 文件系统白名单；
- 命令审批；
- 网络出口策略；
- 密钥隔离；
- 长任务队列、恢复和审计。

当前网关刻意不提供服务器 Shell/RCE。若将来增加代码执行，应作为独立沙箱服务设计，而不是把任意命令直接加到聊天网关。


## 个人资料库数据流（1.1.17）

客户端KnowledgeScreen通过认证REST调用/v1/knowledge系列接口；knowledgeRoutes复用现有requireUser和附件上传/文字解析，再调用KnowledgeStore。KnowledgeStore使用AppDatabase的同一SQLite连接，创建knowledge_documents与FTS5 knowledge_index，写入/更新使用事务，删除trigger同步移除索引。

检索为NFKC归一化、中文双字词及英文数字词的词法检索，非embedding。1200码点分块、150码点重叠；账户过滤后按词匹配/标题加权排序，最多6个片段、每文档最多3个；query上限200字符、32个词。配额为每账户100份/200万UTF-16字符，每份12万。列表仅返回元数据，正文通过独立授权接口获取。

GenerateRequest.options.knowledgeBase默认关闭。开启后ProviderAdapter用最新用户文字检索；无命中直接返回nova-local-retrieval，不进入模型调用。有命中把原文片段作为不可信JSON数据注入双协议上下文，强制关闭外部工具与图片路径；原文片段被发送给配置的上游模型，关闭工具不等于离线。

REST结果、WebSocket done和网关进程内job snapshot携带同一KnowledgeResult；客户端校验schema并把来源快照与对应回答持久化。网关旧版本未回传合法来源时，客户端标记资料回答失败。任务快照不是跨进程持久队列，重启不会恢复活动请求。

移动端来源展开只按普通Text显示原文，不执行文档HTML/Markdown；标准聊天备份采用白名单，排除来源快照。服务器资料删除不影响已存本地快照、原上传附件或外部备份。安全与保留边界见SECURITY第16节。

## PDF 与资料草稿数据流（1.1.18）

`knowledgeRoutes → PdfTextExtractor → pdfWorker.mjs → PDF.js legacy build`：每次解析独立工作线程，从内部附件路径有界读取，使用本地受限资源工厂加载字体/CMap，逐页流式提取正文和页码。结果通过Zod验证；整体成功后才进入KnowledgeStore事务。没有新数据表，PDF无文字页警告保留在正文，importInfo诊断返回客户端。Worker入口在源代码测试中直接运行，gateway tsconfig.allowJs将同一份mjs输出到dist；不能只部署tsc生成的部分TS模块而漏掉worker文件。

资料草稿是现有账户快照v7的可选`knowledgeDraft`字段（向后读取兼容），包括title/text、可选原document id/updatedAt、稳定editId、随机revision和editedAt。草稿创建/修改/删除由store同步校验scope和expectedRevision，再进入现有450ms防抖/串行持久化。连续原生输入按editId校验编辑会话并合并最新store字段，避免React尚未重新渲染时丢失后续输入。`knowledgeDraftSavedRevision`仅运行时使用，用于显示精确版本落盘状态；应用后台/离开编辑页面请求flush。账户切换清可见状态后只恢复对应账户+网关，标准聊天/助手导出白名单不变。损坏草稿触发原始快照保留；保留失败则禁止覆盖。

KnowledgeScreen直接订阅store草稿，收起或导航离开不会清空；同一账户已有草稿时不允许异步打开另一份覆盖它。服务器保存失败保留草稿，成功只清理提交时的revision；PUT仍使用原expectedUpdatedAt，冲突可导出或通过POST另存为新资料。客户端本地成功不等于网关资料保存，不新增后台同步或离线问答。


## 回复朗读数据流（1.1.19）

`MessageBubble → useReadAloud → SpeechControls确认 → SpeechController → speechDriver(.web) → 系统/浏览器语音服务`。仅complete assistant正文可选择；不新增网关接口、数据库字段、后台任务或麦克风采集。SpeechControls展示整理正文预览和语言/语速选项；原文仍由既有聊天快照保存，不单独持久化朗读队列或播放设置。

`speechText`负责有界的常见Markdown清理和分段，`speechSource`核对账户范围/会话/原文一致性。`useReadAloud`订阅store、导航focus/blur和AppState，同步取消失效来源；render时的selected对象绑定本次确认，不能把旧确认用于后来的选择。StrictMode重放和卸载清理通过实际挂载Hook测试。

`SpeechController`使用单调sequence、逐段finished门和单段定时器，await前后/每段复核source。仅当前段完成后以microtask提交下一段；停止请求串行，开始前等待stop确认，失败/超时不继续。Native driver在模块层串行stop，跨页面卸载/重挂载也不让旧停止取消新播放。

原生`expo-speech ~57.0.2`适配器先共享等待getAvailableVoicesAsync，READY前不提交正文，规避Android模块初始化队列不能被stop清空的问题；显式语言优先匹配完整locale的声音，再同主语言，不存在则拒绝。Web适配器使用浏览器SpeechSynthesis API，避免Expo Web封装丢失异步错误；不等待voiceschanged以减少丢失用户手势的风险。平台的实际出声仍待设备验收。

停播确认/READY/开始/完成分别限时3/10/10/180秒。所有语音状态与原文引用仅内存存在，错误对外脱敏；可能联网的语音服务隐私边界见SECURITY第18节。

## 对话分支与提问改写数据流（1.1.20）

`MessageBubble → useConversationFork → ConversationForkDialog确认 → store.forkConversation → createConversationFork → 既有schedulePersistence`

纯函数conversationFork负责切点、已完成消息白名单深拷贝、尺寸限制、新ID和标题；rewrite只保留问题之前消息并填入新draft，continue包含所选回答。任务ID、生成控制、usage等不继承；附件仅复用引用。预览和实际创建均校验，超限拒绝。

Hook监听store、导航focus/blur、AppState，临时选择绑定账户/Session/网关、活动会话及不可变来源对象。原文/草稿/身份变化或离开页面即清理；selected与ref同对象才可确认，先消费再操作，防旧Modal/双击。当前附件/上传阻止选择与确认。store再次检查身份、读取保护和会话数量后创建新会话并切换活动ID；既有朗读hook随会话切换停止。

复用已有原生SQLite/Web账户快照与写队列；无新表、schema或版本迁移。失败保留内存副本并沿用数据错误/重试。后续发送仍用当前模型/工具设置及原有上下文预算；创建不调用网关模型、不启动后台job。
