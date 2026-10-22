# Nova Chat 项目记忆文档

> **用途**：这是 Nova Chat 的长期上下文和交接记录。开始新的 Codex/ChatGPT 对话时，应先让助手读取本文件，再继续修改项目。
>
> **最后更新**：2026-10-15（Asia/Shanghai）
> **当前版本**：客户端1.1.31 / Android33 / iOS33已公开发布；公网陪伴运行时Agent30已部署。语音先入列、转写手动展开、播放无进度条，陪伴不显示生成占位。新增自然表达与内部资料边界，主动联系以独立调度事件生成，白天按关系提供30/60分钟首次机会；已排旧计划不迁移。App关闭后的系统推送仍缺真实EAS/FCM配置、注册设备0。原有账号、人设、会话、Provider和.env保留，长期SSH授权沿用；详情见本文末尾2026-10-15最新记录。本轮未commit/push，保留全部既有修改。


## 核心产品约定（用户明确要求，后续开发优先读取）

本节记录稳定需求；后面的按日期记录用于审计，历史状态不能覆盖本节与最新实测。每次继续开发先读取本节、当前版本和最近验收结果，再检查实际运行状态。需求变更须同步更新本文件。密钥、密码、初始化口令、会话 Token 和 SERVER_MASTER_KEY 的明文不得写入记忆、源码、截图、构建包或公开下载目录。

### 1. 整体设计与陪伴界面

- 用户明确不喜欢大量紫色和模板化的 AI 风格。全局采用暖白、灰绿、自然清爽的视觉方向，持续检查排版、留白、层级、输入框和键盘遮挡，并在真实运行界面验收。
- AI 陪伴是独立的角色聊天空间，交流方式接近日常人与人聊天。普通用户看到人物、消息、照片和必要的角色设置，不显示陪伴模型选择、路由、Key、推理强度（如“中等思考”）和杂乱的工具配置。
- 普通聊天保留自身的模型选择与相应能力设置；修改陪伴页面不能混淆或覆盖普通聊天配置。
- 2026-10-13 用户新增产品要求：AI 陪伴按“人设列表 → 该人设的多个独立对话 → 聊天”组织。同一人设每次新建都生成空白对话，各话题只使用自身历史；人物资料、长相及用户主动保存并启用的长期记忆共用。新增人设可直接粘贴完整提示词，内置沈知意使用用户提供的 人设提示词.txt 全文。

### 1.1 陪伴相处节奏（2026-10-14 用户要求）

- 人设需要保留自己的偏好、态度、情绪和边界。初识有距离，熟悉、信任、分享意愿和好感随实际交流逐步变化；不能一句表白立即变成恋人，也不能每轮重置成陌生人。保持原始人设身份与价值观，相处变化作用于关系状态、表达与习惯。
- 普通闲聊可以一条、多条、延迟或暂时不发送；不固定每条追问，不用冷落、内疚或占有要求用户回应。明确求助、危险以及直接询问身份/照片来源必须认真回应，并如实说明 AI 身份与生成图来源。
- 照片后台制作，当前文字轮次可以先说“等我一下”或不附文字，不向聊天插入“生成中”占位。完成后按照片消息送达，用户继续聊天不能导致照片丢失；失败有实际提示。角色自己提议发照片也必须进入真实投递队列。
- 熟悉后允许角色主动分享日常或联系，但须遵守用户开关、暂停要求和冷却，不反复催回复。新建角色主动联系默认开启，已有角色保留用户原设置，可在人设编辑页打开“允许 TA 主动找我聊天”。
- 自动历史检索只限同账号、同人设、同话题；跨话题只使用用户主动启用的长期记忆。关系熟悉程度属于同一人设的持续状态，不把其他话题的具体事件自动带进来。
- 当前采用持久化关系统计与关键词历史检索，没有 Provider 权重训练，也不宣称真实意识或情感。当前客户端只有前台轮询和回前台收取，没有 OS 后台推送。

### 2. 三套模型配置必须独立

| 场景 | 管理和使用方式 | 最近已验收配置（状态快照，不是永久写死的型号） |
| --- | --- | --- |
| 普通聊天文字模型 | 管理员配置项目中正确的 GPT 中转地址、Key、协议及允许模型；普通用户可选允许使用的模型。 | 使用既有普通 GPT 中转配置；后续修改前须读取管理员实际配置。 |
| AI 陪伴文字模型 | 管理员单独设置地址、Key，获取模型列表并选择具体型号；用户只选择角色，不能看到或修改底层模型。 | 用户配置的 OpenAI-compatible 中转，deepseek-flash；2026-10-13 已保存并实测，不按旧快照还原成官方服务。 |
| AI 陪伴照片模型 | 管理员单独设置图片中转地址、Key，获取列表并选择图片模型；照片由陪伴对话触发。 | 项目图片中转，gpt-image-2。 |

- 用户最初要求陪伴文字默认使用提供的 DeepSeek 官方 Key，图片使用管理员填写的 image 配置。凭据仅在服务端加密存储；本文只记录用途，不记录明文。
- 管理员填好 endpoint / Key 后应能测试连接、获取可用模型、选择并明确保存。普通聊天模型列表、陪伴文字和陪伴图片配置不可互相覆盖；独立字段即使指向同一中转也要保持用途隔离。
- 对用户隐藏管理配置不等于关闭服务端工具。搜索、天气、记忆、照片等陪伴能力需要有实际封装、授权、调用结果和清楚的错误提示；不能只写提示词就宣称工具可用。

### 3. 长相、照片和连续性

- 用户能上传人物参考照片，配合可选的长相描述；能在 AI 人脸/长相设置中修改描述或替换照片。
- 没有参考照片时，第一次生成读取已保存的人设提示词，按明确年龄、身份、外貌、背景和喜好建立相符的形象；完整提示词缺失才使用简要性格和说话方式，明确外貌描述优先。首次成功照片保存为该人设全部独立话题共用的参考脸。后续“在干嘛”“发张照片”“再来一张”“比个心”“换姿势”等照片请求，以该人物既有参考长相为基础，结合当前场景、衣着和动作生成。
- 用户主动替换长相照片后，新照片成为后续参考。普通换姿势、换衣服或换场景不能擅自换脸；不要把另一角色或账号的照片混进当前角色。
- 文字陪伴和生图是两条路由。已知文字模型（当前 DeepSeek）的历史用照片场景文字表达，不能把不支持的 image_url 直接发送给它；生图流程仍读取授权的真实参考图片。
- 图片场景只取当前请求、最近成功照片与近期正常角色活动，不能把旧失败描述混进新请求。审核拒绝提供“修改照片描述”，把原问题恢复草稿供修改，不自动发送，不截断后续历史。
- 必须验证首次生图、连续第二次生图及图片后的文字聊天。模型/鉴权错误、参考照片错误和上游内容审核拒绝要分别提示；审核拒绝不自动重试，也不移除参考照片规避审核。

### 4. 人设和聊天体验

- 2026-10-13 用户进一步明确：手机回复不带括号动作、语气说明、心理活动或旁白；普通短问候只回一小句，不拼接解释与追问。各人物通过自己的喜好、判断和情绪形成不同回答，被追问或有兴趣时才展开，不能全部统一成冷淡短句。

- 新建角色默认是成年人，有具体偏好和自然的口语节奏，能接住用户情绪并延续当下场景。通常简短接话，避免重复机械追问、客服套话，以及每轮声明“我是 AI / 我只能打字”。
- 能真实执行照片分享时应调用对应能力；没有附件或工具结果时不能谎称已经发出照片或查到了资料。用户直接询问身份或照片来源时如实说明 AI 与生成照片。
- 用户要求默认人设有具体的成年背景、偏好、小习惯和主见，像日常发消息；不要靠堆“温柔”“像真人”标签。已实际研究AIRI、SillyTavern和小智服务端的提示及组装代码，使用原创中文，见 docs/COMPANION_PROMPT_RESEARCH.md。
- 默认 Lumi 现为20岁的成年女大二中文系学生，偏慢热、略孤高、熟悉后偶尔腹黑。本地 v9 参考用户提供的完整人设结构，增加具体生活、长短口语和多轮情绪示范，减少咨询腔、心理分析、自动建议和固定追问。自定义完整提示词不混入 Lumi 的背景或示范；直接问及身份或真实性仍如实说明 AI。27岁视觉设计设定是历史版本，不能作为当前默认。
- 用户不要建议、不要追问或想安静时遵守；允许几个字、一句话，不能每条都鸡汤或追问。服务端仅依据当前会话近三条角色回复补节奏，不用跨人物的全局计数；日常短消息在发送前去句号、把逗号换成空格并合并空段，保留人物观点内容。代码、链接、数字、列表、原文引用和详细说明保留必要格式。普通GPT仍实时流式，陪伴文字生成完成后一次发送格式化内容。
- 存量人物保存的初版/上版默认必须识别；只精确匹配旧默认，在读取时返回有效新版，自定义文本不覆盖，数据库原记录不批量重写。
- 默认行为更新应保留稳定模板 ID（当前 cyber-companion-v1），不得批量重写旧角色的自定义人格、记忆和长相。

### 5. 注册、旧版和数据保留

- 要允许朋友自行注册普通账号，管理员无需代建所有用户；普通用户无需任何第三方 API Key。账号、对话、上传文件、角色和照片按所有权隔离。
- 用户明确要求：以后更新，老版本仍可正常使用，旧用户记录仍在。保留旧客户端协议、资料字段和下载地址；更新提示与强制更新是后续需求，目前没有强制更新。
- Android 升级使用同包名 com.novachat.mobile 与既有签名覆盖安装，保持数据存储与必要的兼容迁移；不能通过卸载、清除数据、删除数据库或更换主密钥解决更新问题。
- 本地聊天、收藏、草稿、设置及服务端账号、角色、记忆、长相、文件和会话均须保留。部署保留数据卷与 SERVER_MASTER_KEY；迁移采取兼容方式，不破坏旧客户端。
- 切换网关或账号时保持数据命名空间隔离，旧记录保留；不能为了显示记录而静默合并不同账号或不同服务器。dyh 从旧本机 QA 网关切到公网后需要用公网账号重新登录，这不等于清空旧本地记录。

### 6. 模拟器与交付方式

- 用户授权操作的 MuMu 设备名称是「dyh」，ADB 序列为 127.0.0.1:16384；不要操作其他已连接设备（包括 694edea8）。
- dyh 当前需 x86_64 包；实体 Android 手机使用 ARM64 包。不能把手机 ARM64 包在 MuMu 转译环境安装成功当作能启动，它曾因缺少对应原生库而启动崩溃。
- 需要实际覆盖安装、打开应用并记录版本、前台 Activity 与截图，用户应能在模拟器看到结果；遇到 Windows 截图故障需如实说明，不得将后台验证写成已看到 Windows 窗口。
- 后续涉及手机行为的源码变更，完成适当检查后构建可安装包、校验下载与哈希，并明确交付地址。若本轮只是安装现有已验证 APK 和更新文档，无需虚构重建结果。
- 用户允许持续排查、修复、验证并沿用既有部署和发布流程。未经要求不 commit / push / reset，不覆盖工作区既有未提交修改，不清理真实用户数据。

## 最新操作记录：2026-10-12 用户要求再次更新 dyh 并保存核心约定

- 已从 Windows 工具返回的窗口中唯一选中标题「dyh」的 MuMuNxDevice，并请求切至前台。Windows.Graphics.Capture 两次失败：首次 FrameArrived 超时，恢复选择后 window capture 超时；停止 Windows UI 输入，没有声称获得 Windows 可见窗口截图。
- 核对本地 x86_64 APK 哈希与既有证书后，对 127.0.0.1:16384 执行 adb install -r，返回 Success；随后显式启动 com.novachat.mobile/.MainActivity，Status ok / COLD。未卸载、未清除应用数据、未操作其他设备。
- 安装后 versionName=1.1.25、versionCode=27、primaryCpuAbi=x86_64；首次安装时间仍为 2026-10-12 11:27:52，本次 lastUpdateTime=2026-10-12 18:35:11。前台 Activity 是 Nova Chat，进程正常存在。
- 设备截图已目视确认：显示“版本 1.1.25”“服务器已连接，可以登录或注册”，登录与注册入口均可见。当前停在登录页，未使用用户私人账号登录或声称验收其私人对话。
- MuMu 包：artifacts/mumu-1.1.25/NovaChat-1.1.25-MuMu-dyh-QA.apk；38,654,386 bytes；SHA-256 ddfc29033f2be58c1cf287b3ee052b2aceed3be81744dc89f4cb433231be2813。沿用既有预览证书，不是正式生产签名。
- 证据：artifacts/mumu-1.1.25/02-user-requested-update.png 与 artifacts/mumu-1.1.25/user-requested-update-verification.json。本轮使用既有最新版 APK，没有修改产品源码或重新打包。


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

### 2026-09-30 保存后实测：配置存在，但当时官方直连入口不可达（历史，后续已修复）

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

### 2026-09-30 后续：模型获取实际连接超时（尚未解决）

- 用户再次点击获取模型后反馈超时。新日志确认3次 `POST /v1/admin/provider/test` 均返回504，安全代码 `provider_timeout`，耗时约277/255/256毫秒；该耗时明显短于新增的20秒整体截止时间，不能把本次错误归因为20秒上限太短。
- 手机请求已到达网关，管理页和模型读取接口200；公网直连、正常校验证书的health/setup分别约312/156毫秒、均200，容器healthy。应区分“手机→网关正常”和“网关→当前模型目标连接超时”，不能笼统让用户更换Wi-Fi或重装App。
- 在容器内用独立Node进程，对不含秘密的公开控制站点www.qq.com、nodejs.org、example.com做HEAD，均200（约141/1713/611毫秒）。这只能证明非所有出站HTTPS均失败，不能证明用户的模型服务可达，也不能据此断言地域封锁、Key错误或某条DNS记录有问题。
- 运行Node v24.21.0，默认autoSelectFamily=true、尝试超时250ms。实际模型的约255ms失败值得进一步检查多地址连接选择，但当前未保存地址、没有底层错误链，**不能据数值吻合就认定根因或盲目修改全局网络设置**。控制进程没有改生产进程，不改代理/防火墙/模型协议/Key/连接时限。
- 管理员1个、`needsBootstrap=false`，`providerConfigured=false`且provider_settings仍无记录。实际配置仅在手机草稿中，当前不能在服务器独立复测真实目标。下一步让用户保留填写内容，点击“保存”（不是再点获取模型）；源码确认保存操作不先请求上游。用户确认保存后，仅在服务器内部使用已授权保存的设置诊断DNS/TCP/TLS/模型列表，不输出URL/Key、不要求发送秘密或完整截图。
- 本轮仅只读排查和文档更新，未部署新代码或重打APK。上次发布的是错误提示/诊断修复，不代表实际模型连接已修好。证据：`artifacts/deployment/provider-timeout-diagnostic/server-diagnostic.json`、`public-health.json`、`network-controls.json`。

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

> **工作区**：`E:\gptapp`


## 2026-09-29 续接记录：1.1.22 服务器所有者测试 APK

- 已将根包、移动端、网关、协议包、锁文件和 Expo 配置统一到 1.1.22/code24。
- 已修复覆盖安装后误连旧服务器、旧 legacy token 误发到新服务器和账号聊天记录跨服务器混入的问题；测试与全量验证通过。
- 已修复公网 HTTPS IPv4 地址检查对合法服务器 IP 的误拒绝；仍拒绝私网/回环/保留/临时隧道地址。
- 已用 `npm audit fix` 修复传递依赖安全告警；最终 `npm audit` 为 0 vulnerabilities。
- 已真实构建 ARM64 release APK：`artifacts/server-test-1.1.22/NovaChat-1.1.22-android-arm64-server-test.apk`，并复制同一字节到 `artifacts/NovaChat-1.1.22-android-arm64-lan.apk`。
- 独立 APK 检查通过：包名/版本/签名与 1.1.21 一致、HTTPS、非 debug、禁用备份、权限、ZIP 与原生 16 KiB 对齐、无项目敏感文件/环境密钥。
- 打包/部署时的历史快照（现状以上方热修复节为准）：服务器外网健康检查和 WSS 匿名鉴权检查通过；当时 `needsBootstrap=true`、`bootstrapTokenRequired=true`、`registrationEnabled=false`、`providerConfigured=false`。没有写入管理员、模型配置、API Key 或服务器密钥。
- `authenticatedChatVerified=false`、`physicalDeviceTested=false`；不要把该包称为已验收聊天包，也不要声称已在真机安装。
- 证据：`docs/RELEASE_1.1.22.md`、`artifacts/server-test-1.1.22/verification.json`、`SHA256SUMS.txt`、`gateway-check.json`、`.run/server-apk-1.1.22-android-build.log`。


## 2026-09-29 公网 APK 下载准备（历史：已由09-30发布完成覆盖）

> 以下为当时未发布的历史记录；当前已发布、长期授权已生效，不要执行其中临时授权步骤。

- 用户要求把 APK 放到公网，让用户从流量/任意 Wi-Fi 下载并使用。App 的内置 API 已是公网 HTTPS，与局域网下载服务独立；尚未部署公网 APK 下载路径。
- 已再次测试上一轮 ubuntu 临时 SSH key：Permission denied/255，原授权确实撤销；未尝试旧聊天密码。浏览器工具状态没有可用浏览器/标签页或已登录宝塔会话。
- 已生成独立的新临时 SSH key（私钥只在 Windows 用户 .ssh 目录，不要读取或输出），授权记录 `artifacts/deployment/nova-chat-public-download-ssh-session.json` 当前为 pending。用户需在宝塔服务器终端执行 `artifacts/deployment/authorize-nova-public-download.sh`；执行后仅有效2小时，部署验收后应精准移除本次公钥条目，并验证旧/其他授权不受影响。不得重新启用旧 revoked key。
- 已准备 `artifacts/public-download-1.1.22/`：静态下载页、SHA256SUMS、仅明确文件路由的 Nginx include 草稿与 deployment-pending.json。**未上传、未修改远端 Nginx、未发布**。计划路径 /download/ 与 /downloads/NovaChat-1.1.22-android-arm64.apk；实际HEAD复查均404，不可发给用户称可用下载地址。
- APK仍为1.1.22/code24，SHA256 `308a8b523ccc5373fb70e3f0ad2b5c068556f34aebe2729e02c12a2995638c16`。不需要为了分发再次修改App/重打包。
- 获得新授权后：先检查实际站点/代理配置，备份相关配置到 root-only 非Web目录；上传三个公开文件到专用目录 /www/nova-public/releases/1.1.22/ 并校验哈希；在现有server块加入精确静态路由，保持现有API/WSS、ACME/证书续期不变；nginx -t 后平滑reload；从外网完整下载APK比对SHA256，并测试Range/HTTPS/未知文件404、health及WSS。禁止将项目.env、数据库、SSH材料或deployment元数据放入公开目录。
- 本轮公网 health/setup 复查成功，但仍 needsBootstrap=true / providerConfigured=false / registrationEnabled=false。账号初始化与第三方模型配置未完成，未获得迁移本地账号和Key的明确确认；不要随发布APK顺便迁移秘密或称“任何用户已可聊天”。


## 2026-09-30 当前状态：长期授权已激活，公网 APK 已发布验收

**用户的短行授权已执行成功；已多次建立全新 SSH/sudo 连接。不要再让用户重复授权，也不要自动撤销本次长期密钥。**

- 用户明确批准长期有效、可随时撤销的专用 SSH 维护密钥。服务器公钥恰好一条、带restrict、无expiry-time；authorized_keys为ubuntu所有、0600。现有sudo权限保留，属于管理权限而不是只读下载权限。
- `artifacts/deployment/nova-chat-maintenance-session.json` 为active/persistent_revocable/expiry=null，`must_not_auto_revoke_after_deployment=true`。私钥只在Windows用户.ssh，不可打印、上传或提交。未使用聊天中出现过的root密码。
- 使用 `artifacts/deployment/maintenance_remote.py --script <已审查脚本>`，固定主机、严格host key、BatchMode和bytes stdin。不要用读取旧已撤销session的remote.py；不使用旧临时key。
- 下载页面 `https://134.175.139.81/download/`；APK直链 `https://134.175.139.81/downloads/NovaChat-1.1.22-android-arm64.apk`。不再要求同一Wi-Fi，不依赖电脑开机或临时隧道。
- 沿用已构建的1.1.22/code24 ARM64 APK，本轮没有改移动端源码/重建包。38,006,882字节，SHA256 `308a8b523ccc5373fb70e3f0ad2b5c068556f34aebe2729e02c12a2995638c16`。
- 专用公开目录 `/www/nova-public/releases/1.1.22/` 只有APK、index.html、SHA256SUMS.txt。root目录0755/文件0644；配置、metadata、SSH材料、数据库、.env未公开。
- 路由 `/www/server/panel/vhost/nginx/extension/134.175.139.81/nova-chat-downloads.conf` 使用原server扩展include。原站点/API代理文件哈希不变，nginx -t通过后平滑reload；未改ACME/证书/环境/主密钥/数据卷，未重启网关。
- 备份与服务端回执 `/www/backup/nova-chat-public-download/20260930T030528Z-63221c3c3b/` 为root-only非Web目录。已清理本次私有上传stage；不要重跑依赖stage存在的一次性发布脚本。
- 外网验收：页面/HEAD200，完整下载APK哈希一致，Range206/100字节，SHA256SUMS一致，HTTP308到HTTPS，未知下载及秘密路径404；health200、匿名tools401、WSS握手后unauthorized/4401均通过。
- Docker enabled/active，网关running/healthy、restart=unless-stopped，8787仅127.0.0.1；Nginx开机链接及certbot续期timer enabled/active复查正常。没有服务器重启演练；公开可信短期IP证书依赖持续自动续期，不可自签或关闭TLS。
- **仍未完成**：needsBootstrap=true、bootstrapTokenRequired=true、registrationEnabled=false、providerConfigured=false。未迁移本地账号或第三方Key，需明确确认配置来源；真实认证聊天和手机安装/流量网络未验收，不能称为朋友已验收聊天版。
- 本次没有配置每日/异地备份或监控告警，也未核验/收紧云安全组；“长期”不等于无需续费/补丁/续期或全端口安全。泄露过的密码需所有者更换，不在聊天中传递新密码。
- 最终证据 `artifacts/public-download-1.1.22/deployment-verified.json`、`public-verification.json`、`server-postcheck.json`、`artifacts/deployment/nova-chat-wss-verification.json`。deployment-pending.json已更新为published_and_verified；long-term-transition-pending-20260930.json仍是历史快照。
- 详见 `docs/LONG_TERM_MAINTENANCE_2026-09-30.md` 与 `docs/RELEASE_1.1.22.md`。

### 2026-09-30 首位管理员口令交付（历史交付时尚未创建，现已由用户创建）

- 用户明确表示App正要求填写初始化口令但不知道内容。已用现有长期SSH，仅从运行中网关读取ADMIN_BOOTSTRAP_TOKEN，并在受控子进程内直接写入Windows本机私有文件；未把值打印到聊天/日志、未上传公网、未读取/输出其他环境变量。
- 本机交付位置见 `.run/owner-bootstrap-delivery.json` 中privateFilePath（仅路径等非秘密元数据）。目录ACL禁用继承，只允许当前Windows用户和SYSTEM；文件继承该受限ACL。**该文本文件包含秘密，不可截图、输出、提交、放入项目/公开下载目录或打包。**
- 文件只有原口令，无BOM、换行、引号或等号前缀，可整体复制到App“管理员初始化口令”。管理员邮箱/名称/登录密码由用户自己填写，密码和初始化口令是两回事。
- 没有旋转口令、修改服务器配置、创建账号或迁移Key。操作前setup仍needsBootstrap=true/providerConfigured=false；用户完成后需实际复查。
- 待用户成功创建管理员后，核对交付元数据指向本次私有目录，再精准清理这个本地口令副本；不撤销长期SSH、不删除服务器.env或主密钥。不要通过读取文件正文来再次显示秘密。

### 2026-09-30 下载慢排查（只读，尚未确认云套餐带宽）

- 用户反馈APK下载慢；只读检查没有发现Nginx limit_rate/limit_rate_after或主机流量整形限速，sendfile已开，CPU约1%、网关healthy。服务器本机HTTPS读取4MiB仅0.019秒，未发现静态文件服务瓶颈。
- 先前公网整包38,006,882字节/104.98秒约2.896Mbps；本次经电脑既有HTTP代理的4MiB请求89.916秒、首包30.367秒。检测到电脑配置了HTTP/HTTPS代理，**不能把这些测速直接当作购买的服务器带宽**。
- 绕过HTTP代理的health HEAD200/0.942秒；4MiB文件测试读取超过60秒后主动停止，未完成、未记录已读字节数。没有把超时测量伪称完整下载；上一轮完整APK哈希验收仍有效。
- eth0四秒采样总出站约1.995Mbps、3条已建立HTTPS连接；这不是套餐查询或多人下载的确证，也不能凭单点测试断言所有手机网络速度。
- 初步方向为公网出口/网络线路/并发争用，需要用户提供腾讯云“公网带宽/峰值带宽”栏或相关监控后再确认。**未确认实际套餐，不得写死3Mbps原因；不能承诺改Nginx就加速。**
- 未改服务、未重打APK、未升级套餐或新增付费资源。证据：`artifacts/public-download-1.1.22/download-speed-diagnostic.json`、`download-speed-server-inspection.json`、`network-throughput-sample.json`、`download-speed-client-path.json`。

### 授权命令粘贴问题（已解决，仅保留原因）

此前宝塔终端多行here-document未正确闭合导致 `>`，长单行粘贴也被插入真实换行。最终短行版本安装同一长期公钥成功；本次SSH/sudo、公钥选项和文件权限均已实测。用户无需再输入命令，后续直接使用既有长期维护身份。历史安装脚本只供审计，不要再次发送或批量重跑。

## 0. 新对话首先执行

可以把下面这句话直接发给新的编程助手：

```text
请先完整阅读 E:\gptapp\PROJECT_MEMORY.md、README.md、docs/ARCHITECTURE.md、docs/DEPLOYMENT.md 和 SECURITY.md，再检查当前工作区与运行状态后继续。不要打印、复制或提交任何 API Key、管理员密码、初始化口令、Session Token 或 SERVER_MASTER_KEY。完成修改后必须更新 PROJECT_MEMORY.md。
```

新助手不得仅凭本文中的“运行快照”判断当前状态，因为局域网 IP、进程、端口占用和第三方接口能力可能变化。必须先实际检查。

涉及 Mobile 的页面、交互、权限、模型行为或其他会影响手机测试的修改时，完成代码验证后必须重新构建当前版本的 ARM64 LAN APK、覆盖 `artifacts/` 中对应文件，并实际校验 8790 下载直链与本地 APK 哈希一致；除非用户明确表示本轮不需要测试包。最终回复必须说明 APK 是否已重建，不能只完成 Metro 导出。

---

## 1. 产品目标

Nova Chat 是一个面向 Android/iOS 的自托管、多用户、GPT 风格聊天客户端：

- 管理员统一配置第三方 OpenAI-compatible API 地址、API Key、协议和可用模型。
- 普通用户只使用 Nova 网关地址、账号和密码，不接触第三方 API Key。
- 支持多对话、流式输出、上下文、取消和重新生成。
- 支持常见图片、文本/代码、PDF、Office/OpenDocument 和 EPUB/MOBI 等附件。
- 在第三方接口兼容时，支持 Responses API、Web Search、Code Interpreter 等工具。
- 当前已部署固定 IP HTTPS/WSS 公网服务器及 APK 下载入口；管理员与模型初始化、普通聊天及陪伴真实公网验收已完成。最新 dyh 安装启动已验证；用户实体手机验收仍由实际操作确认。

### 必须长期保留的边界说明

- Nova Chat **不是** OpenAI、ChatGPT 或 Codex 官方产品。
- 第三方服务商提供的 `gpt-5.6-*` 等模型名只是服务商声明，客户端无法独立证明它与任何官方同名模型完全一致。
- Nova Chat 可以实现相似的聊天、附件、工具和多用户体验，但不能承诺“完整复制官方 ChatGPT/Codex 的所有内部功能”。
- Web Search、Code Interpreter、图片理解、PDF 阅读、上下文上限和输出上限最终取决于第三方服务商的真实兼容程度。

---

## 2. 当前技术架构

```text
Android / iOS Nova Chat App
  ├─ React Native 0.86.2 + Expo 57
  ├─ Zustand 本地状态
  ├─ SecureStore 保存登录 Session
  ├─ REST：认证、模型目录、管理、附件上传
  └─ WebSocket：聊天流式生成
                  ↓
Nova Gateway（Fastify + Node.js）
  ├─ 注册、登录、Session、角色和用户管理
  ├─ 设备并发、速率限制、输入/输出限制
  ├─ SQLite 持久化
  ├─ AES-256-GCM 加密第三方 API Key
  ├─ 附件所有权、真实文件头和大小校验
  ├─ Responses / Chat Completions 协议转换
  └─ 模型和工具兼容性降级
                  ↓
管理员配置的第三方 OpenAI-compatible 服务
```

### 工作区结构

```text
E:\gptapp
├─ apps/mobile/               Expo / React Native Android+iOS 客户端
├─ services/gateway/          Fastify 网关
├─ packages/protocol/         App 与网关共享的 Zod 协议和类型
├─ scripts/                   LAN 启停、构建、下载和 CC Switch 导入脚本
├─ docs/ARCHITECTURE.md       详细数据流和并发设计
├─ docs/DEPLOYMENT.md         部署和构建说明
├─ SECURITY.md                安全边界
├─ PROJECT_MEMORY.md          本文件
├─ artifacts/                 构建出的 APK 和校验信息
├─ services/gateway/data/     本地 SQLite 与上传文件
└─ .run/                      PID、运行日志和临时验证文件
```

### 重要源码入口

#### Mobile

- `apps/mobile/src/screens/ChatScreen.tsx`
  - 发送流程、附件选择、多会话生成状态、键盘避让。
- `apps/mobile/src/components/Composer.tsx`
  - 输入框、附件预览、发送/停止按钮、键盘回车发送。
- `apps/mobile/src/components/ChatOptionsModal.tsx`
  - 聊天页模型搜索、模型选择、推理强度和回答详略设置。
- `apps/mobile/src/services/chatClient.ts`
  - 网关 WebSocket/REST 生成连接与回退。
- `apps/mobile/src/services/gatewayApiClient.ts`
  - 登录、模型、管理接口和原生附件上传。
- `apps/mobile/src/services/gatewayUploadResponse.ts`
  - 附件上传响应解析和错误分类。
- `apps/mobile/src/services/gatewayImageCache.ts`
  - 使用认证请求下载网关图片到 App 私有缓存；完整性校验、并发去重、超时和失败重试。
- `apps/mobile/src/lib/conversationContext.ts`
  - 历史上下文构建和裁剪。
- `apps/mobile/src/lib/modelSelection.ts`
  - 登录/恢复 Session 后的模型安全选择和旧模型迁移。
- `apps/mobile/src/store/useAppStore.ts`
  - 用户、Session、设置、对话和消息状态。

#### Gateway

- `services/gateway/src/server.ts`
  - Fastify 路由、WebSocket、认证、附件和管理入口。
- `services/gateway/src/provider.ts`
  - 第三方请求、流解析、模型和工具兼容性处理。
- `services/gateway/src/database.ts`
  - SQLite、用户、Session、模型配置和加密存储。
- `services/gateway/src/auth.ts`
  - 密码、Token 和权限相关逻辑。
- `services/gateway/src/config.ts`
  - 环境变量、限制和默认设置。
- `packages/protocol/src/index.ts`
  - App/网关共享协议；改变请求或消息结构时两端必须同步。

---

## 3. 当前版本和已实现能力

### 版本

```text
根/workspace package 版本：1.1.3
移动端/LAN app 版本：1.1.8
Android versionCode：10
iOS buildNumber：10
LAN versionName：1.1.8-lan
LAN 包名：com.novachat.mobile.lan
最低 Android SDK：24
目标 Android SDK：36
```

### 用户和管理员

- 首次管理员初始化已经完成：`needsBootstrap=false`。
- 服务器仍要求初始化口令机制：`bootstrapTokenRequired=true`。
- 当前允许普通用户注册：`registrationEnabled=true`。
- 已有登录、注册、退出和 Session 恢复。
- 已有管理员用户列表、角色调整、禁用账户和“不得删除/降级最后一个管理员”的保护。
- 管理员统一配置第三方接口；普通用户无法读取完整 API Key。
- 网关默认启用自动创建管理员账户，默认邮箱由 `ADMIN_EMAIL` 控制；已存在同邮箱账户时不会覆盖密码。
- `ADMIN_PASSWORD` 支持通过环境变量覆盖；凭据不记录在本文档中。

**严禁在本文记录管理员邮箱、密码、初始化口令或 Session Token。**

### 当前第三方服务配置

当前本地网关曾从 CC Switch 自动导入以下非秘密配置：

```text
服务商名称：My Codex
API Base URL：https://ai.kxai.cc/v1
API 模式：responses
认证模式：bearer
默认模型：gpt-5.6-sol
已发布模型数量：13
当前已发布模型：
- codex-auto-review
- gpt-5.2
- gpt-5.3-codex-spark
- gpt-5.4
- gpt-5.4-mini
- gpt-5.5
- gpt-5.6
- gpt-5.6-luna
- gpt-5.6-sol
- gpt-5.6-terra
- gpt-image-1
- gpt-image-1.5
- gpt-image-2
```

- API Key 已存在，但只以加密形式保存。
- 不得从 CC Switch、`.env` 或数据库中打印完整 Key。
- 第三方配置可能变化；操作前应通过管理员页面或安全脚本重新核对。

### 聊天能力

- 每个对话有独立的生成控制器、请求 ID 和 WebSocket 状态。
- 切换对话不会把流式增量写到另一个会话。
- 一个对话生成时，其他没有生成任务的对话仍可独立使用。
- 支持停止生成、失败状态、保留 partial 内容和重新生成。
- WebSocket 握手前可以安全回退 REST。
- 已开始输出后不会自动重放请求，避免重复回答或重复计费。
- 上下文会排除失败、取消和仍在流式输出的助手消息。
- 历史附件引用会随上下文保留，并按字符预算裁剪。
- 登录和恢复 Session 后会同步服务器模型目录；失效旧模型会迁移到管理员默认模型。
- 聊天页新增紧凑模型控制条和“对话设置”弹窗，可选择管理员发布的模型、推理强度和回答详略；设置通过现有生成请求发送，只影响后续消息。
- 网关会对模型名做安全兜底，避免客户端发送管理员未允许的模型。
- 第三方不支持工具时，网关会按兼容策略移除不支持工具后重试。
- 系统提示会说明客户端名称 Nova 和实际模型 ID，以减少错误自称 DeepSeek；模型仍可能产生错误陈述。

### 长上下文、推理强度与生图路由

- 客户端和网关统一使用 `MAX_HISTORY_CHARS=600000`、`MAX_HISTORY_MESSAGES=400` 的有界历史窗口；协议允许最多 512 条消息，网关请求体上限为 4 MB。
- 客户端先裁剪旧历史，网关再次裁剪作为安全兜底；聊天不会因为超过旧的较小阈值直接返回 `413 history_too_large`。
- 600000 字符是应用层预算，不代表无限上下文，也不能覆盖第三方模型自身更小的 token 上限；模型、服务商和输出长度仍可能限制实际可用上下文。
- Responses 模式发送 `reasoning.effort` 与 `text.verbosity`；Chat Completions 只向看起来支持推理的模型发送 `reasoning_effort`，不发送通用性不足的 `verbosity`；图片请求不发送这些文本推理参数。
- UI 的 `xhigh`/`max` 会映射为兼容的 `high`；第三方拒绝不支持的参数时，网关会移除参数后重试。
- 选择 `gpt-image-*` 或表达“生图/生成图片/画图”等意图时，网关自动调用 `/images/generations`，而不是把生图要求当作普通文字回答。
- 图片接口兼容 `b64_json`、data URL、远程 URL 和直接二进制图片响应；`response_format=b64_json` 不兼容时会自动移除后重试。图片模型和文本模型分别执行降级。
- 生图成功后图片保存为网关附件，REST 与 WebSocket 都返回 `attachments`；移动端使用带认证的本地缓存下载并显示，失败时可点按重试。

### 附件能力

支持：

- JPG / JPEG
- PNG
- WebP
- GIF
- PDF
- 每条消息最多 8 个附件
- 单个文件默认不超过 25 MB

服务器会检查：

- 登录状态和附件所有权
- 声明 MIME 类型
- 真实文件头
- 文件大小
- 文件 ID 是否属于当前用户

### 1.1.8 的关键修复

1. **修复 LAN APK 原生版本仍显示旧值的问题**
   - `apps/mobile/android/app/build.gradle` 不再硬编码旧的 `versionCode 5` / `versionName 1.1.3`。
   - `scripts/build_lan_android.ps1` 从 `apps/mobile/app.json` 读取 `version=1.1.8`、`android.versionCode=10`，并通过 Gradle 参数写入原生 APK 元数据。
   - 最终 APK 已用 `aapt2 dump badging` 验证为 `com.novachat.mobile.lan`、`versionCode=10`、`versionName=1.1.8-lan`，可覆盖安装旧 LAN 包。

2. **确认生图链路已实际返回图片**
   - 当前运行中的网关对 `gpt-image-2` 进行了真实端到端请求，HTTP 200，返回 1 个图片附件，格式为 PNG，约 1.19 MB。
   - 通过带授权的 `/v1/files/{id}` 读取返回 HTTP 200，并校验 PNG 文件头成功。
   - 因此之前“只有文字、没有图片”更可能是手机仍安装旧 APK，或 8787 仍运行旧网关进程，而不是当前图片链路本身没有实现。

3. **长对话不再因应用旧阈值直接失效**
   - 客户端/网关已统一为 600000 字符 / 400 条的有界窗口，并保留自动裁剪旧历史。
   - 该策略尽量接近长上下文体验，但不能承诺无限上下文；实际仍服从服务商模型上下文窗口、输入限制和输出限制。

### 1.1.3 的关键修复

1. **发送后的网关图片可以可靠显示**
   - 网关日志确认上传成功，但 React Native `<Image source.headers>` 在该 Android 真机上未实际携带 Authorization Header，导致 `GET /v1/files/{attachmentId}` 返回 401 和灰色占位。
   - 新增 `gatewayImageCache.ts`，使用 `expo-file-system` 的认证原生下载，把图片保存到 App 私有缓存后再用本地 `file://` URI 渲染。
   - Session Token 只进入请求 Header，不进入图片 URL、缓存文件名或日志 URL。
   - 按服务端附件大小校验下载完整性；损坏或不完整缓存会被删除。
   - 相同图片并发下载自动去重；下载超时为 60 秒；支持 JPG、PNG、WebP、GIF。
   - 消息气泡显示加载状态、失败提示和“点按重试”；本地解码失败时会清理缓存并允许重新下载。

2. **修复 Android 键盘重复避让**
   - Manifest 已使用 `windowSoftInputMode="adjustResize"`。
   - 1.1.2 同时设置 `KeyboardAvoidingView behavior="height"`，在该 Android 真机产生重复避让，反而把 Composer 推到键盘下方。
   - 现在仅 iOS 使用 `behavior="padding"`；Android 的 behavior 为 `undefined`，只依赖原生 `adjustResize`。

3. **LAN 构建和下载服务更可靠**
   - APK 文件名自动读取 `apps/mobile/app.json` 中的 `expo.version`。
   - 启停脚本根据端口监听进程和 `/health` 服务名识别真正的 Nova 下载服务，不再只依赖可能失效的 PID 文件。
   - 停止时等待端口释放；启动参数会正确传递下载端口；启动后验证服务名。

4. **新增图片缓存测试**
   - 文件：`apps/mobile/test/gatewayImageCache.test.ts`
   - 覆盖 Token 只进入 Authorization Header、使用认证原生下载、完整缓存复用、不完整缓存删除。

### 1.1.2 的关键修复（历史）

> 这里保留 1.1.2 当时的实现记录；其中 Android `behavior="height"` 已在 1.1.3 被新方案取代。

1. **Android 输入框不再被键盘遮挡**
   - `ChatScreen.tsx` 在 Android 使用 `KeyboardAvoidingView behavior="height"`。
   - Manifest 保持 `windowSoftInputMode="adjustResize"`。
   - 键盘弹出时，如果用户位于列表底部，会再次滚动到底部。

2. **键盘回车直接发送**
   - `returnKeyType="send"`
   - `enterKeyHint="send"`
   - `submitBehavior="submit"`
   - `onSubmitEditing` 和发送按钮调用同一提交函数。
   - 使用同步 ref 阻止用户快速回车造成重复发送。

3. **Android/iOS 原生附件上传**
   - 新增直接依赖 `expo-file-system ~57.0.5`。
   - 原生平台使用 `File.upload` 和 `UploadType.MULTIPART`。
   - 不再依赖容易在 React Native 本地 URI 上失败的 `fetch + FormData + { uri }`。
   - 90 秒超时；上传保持前台 Session。
   - 文件不可读、超时、服务端业务错误和局域网网络错误分别提示。

4. **上传响应测试**
   - 文件：`apps/mobile/test/gatewayUploadResponse.test.ts`
   - 覆盖成功、结构化错误、非 JSON HTTP 错误和畸形成功响应。

---

## 4. 当前 LAN 运行快照

> 以下是 **2026-09-01** 的运行快照，局域网 IP、进程和端口仍可能变化，使用前必须重新检测。

```text
电脑局域网 IP：192.168.0.113
Nova 网关：http://192.168.0.113:8787
APK 下载页：http://192.168.0.113:8790
检测到网关监听 PID：39032
检测到下载服务监听 PID：41616
```

当时健康检查：

```json
{"ok":true,"service":"nova-chat-gateway","apiMode":"responses","defaultModel":"gpt-5.6-sol"}
{"ok":true,"service":"nova-chat-lan-download"}
```

手机必须：

- 与电脑连接同一 Wi-Fi。
- 能访问 `192.168.0.113`。
- 安装 LAN 包而不是生产预览包。
- 电脑保持开机，网关和下载服务保持运行。

### 当前 APK

```text
文件：E:\gptapp\artifacts\NovaChat-1.1.8-android-arm64-lan.apk
大小：35,291,245 bytes
SHA-256：0312525EF4D52AB9692FD020E0DBC645687244ED6DEC8D8840F4F3941C6AFF78
包名：com.novachat.mobile.lan
versionCode：10
versionName：1.1.8-lan
预置网关：http://192.168.0.113:8787
```

- 1.1.8 LAN 包与此前 LAN APK 使用相同签名，可直接覆盖安装并保留 App 数据。
- LAN 变体允许明文 HTTP，只能用于可信私有 Wi-Fi。
- 下载服务支持 HTTP Range，已验证返回 `206 Partial Content`，手机浏览器中断后可尝试续传。

---

## 5. 常用操作手册

所有命令默认在：

```powershell
cd E:\gptapp
```

### 检查实际局域网 IP

```powershell
Get-NetIPConfiguration |
  Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address -and $_.NetAdapter.Status -eq 'Up' } |
  Select-Object -First 1 -ExpandProperty IPv4Address
```

### 启动 LAN 网关

```powershell
.\scripts\start_lan_gateway.ps1
```

如果代码或 `dist` 已更新而端口上仍有旧网关进程，必须显式重启以加载最新代码：

```powershell
.\scripts\start_lan_gateway.ps1 -GatewayHost 192.168.0.113 -Restart
```

脚本会：

- 检查 `services/gateway/.env`。
- 构建网关（仅在启动新进程或使用 `-Restart` 时）。
- 后台隐藏启动服务。
- 写入 `.run/lan-gateway.pid`。
- 写入 `.run/lan-gateway.stdout.log` 和 `.run/lan-gateway.stderr.log`。
- 检查 `/health`。

### 停止 LAN 网关

```powershell
.\scripts\stop_lan_gateway.ps1
```

脚本会先核对端口和健康检查，避免误杀其他程序。

### 构建 LAN Android APK

自动检测局域网 IP：

```powershell
.\scripts\build_lan_android.ps1
```

指定固定地址：

```powershell
.\scripts\build_lan_android.ps1 -GatewayHost 192.168.0.113 -Port 8787
```

每次准备给手机覆盖安装时必须：

1. 更新根包、mobile、gateway 和 protocol 版本。
2. Android `versionCode` 必须递增。
3. 更新 `scripts/build_lan_android.ps1` 的产物名。
4. 更新 `scripts/lan_download_server.mjs` 的 APK 文件名。
5. 更新 README、SECURITY 和本记忆文档。
6. 运行全量验证。
7. 构建 APK 并核对签名、包名、版本和预置网关地址。

### 启动 APK 下载服务

```powershell
.\scripts\start_lan_download.ps1
```

### 停止 APK 下载服务

```powershell
.\scripts\stop_lan_download.ps1
```

### 健康检查

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
Invoke-RestMethod http://127.0.0.1:8790/health
Invoke-RestMethod http://127.0.0.1:8787/v1/setup/status
```

### 查看端口和日志

```powershell
Get-NetTCPConnection -State Listen -LocalPort 8787,8790
Get-Content .run\lan-gateway.stdout.log -Tail 100
Get-Content .run\lan-gateway.stderr.log -Tail 100
Get-Content .run\lan-download.stdout.log -Tail 100
Get-Content .run\lan-download.stderr.log -Tail 100
```

### 安装和全量验证

```powershell
npm ci
npm run build
npm run verify
```

1.1.3 构建时的验证结果：

```text
Mobile：7 个测试文件 / 26 项测试
Gateway：6 个测试文件 / 22 项测试
总计：48 项测试通过
Mobile/Gateway/Protocol TypeScript 通过
Mobile/Gateway ESLint 通过
Android LAN Gradle 构建通过
APK v2 签名验证通过
```

### 从 CC Switch 安全导入当前服务商

先构建网关，再执行：

```powershell
npm run build -w @nova-chat/gateway
node scripts/import_cc_switch_provider.mjs
```

脚本读取：

```text
%USERPROFILE%\.cc-switch\cc-switch.db
```

并把当前 Codex 服务商写入 Nova SQLite。输出只能包含：

- 服务商名称
- Base URL
- API 模式
- 认证模式
- 默认模型
- 允许模型
- `apiKeySet`
- 脱敏预览

**绝不修改脚本去输出完整 Key。**

---

## 6. 数据和安全规则

### 永远不能提交或粘贴到聊天中的内容

- `services/gateway/.env` 的真实内容
- `SERVER_MASTER_KEY`
- `ADMIN_BOOTSTRAP_TOKEN`
- 管理员或普通用户密码
- 完整第三方 API Key
- Access Token / Session Token
- CC Switch 数据库中的认证字段
- 包含秘密的数据库导出或日志

### 本地关键数据

```text
services/gateway/.env
services/gateway/data/nova-chat.sqlite
services/gateway/data/uploads/
```

- Provider Key 在 SQLite 中使用 AES-256-GCM 加密。
- 加密依赖 `SERVER_MASTER_KEY`。只备份数据库但丢失主密钥，会无法解密 Provider Key。
- 生产环境必须使用固定、高熵主密钥，并安全备份。
- Session Token 只保存哈希；客户端 Session 保存于 SecureStore。
- LAN HTTP 包只能用于可信局域网，不应公开发布。
- 生产环境必须使用 HTTPS/WSS、正式 Android/iOS 签名和服务器备份。

### 当前版本控制风险

截至 2026-08-24，`E:\gptapp` **不是 Git 仓库**。这意味着：

- `git status` 不可用。
- 没有提交历史可恢复。
- 修改前后只能依赖文件备份和本记忆文档追踪。

建议后续建立私有 Git 仓库，并确保 `.env`、SQLite、上传目录、`.run` 和签名密钥被 `.gitignore` 排除。在用户明确同意前，不要擅自把项目推送到任何公开远程仓库。

---

## 7. 常见故障诊断

### 手机提示无法连接服务器

依次检查：

1. 电脑实际局域网 IP 是否仍是 `192.168.0.113`。
2. `8787` 是否在 `0.0.0.0` 监听。
3. `http://电脑IP:8787/health` 是否正常。
4. 手机和电脑是否同一 Wi-Fi、是否启用了访客网络隔离。
5. Windows 防火墙是否阻止 Node.js/8787。
6. 手机是否安装并打开 `Nova Chat LAN`。
7. APK bundle 中预置地址是否还是旧 IP；IP 改变后需要重新构建 LAN APK或在设置里更改地址。

### 图片/PDF 发送或显示失败

1. 查看 `.run/lan-gateway.stdout.log` 中是否出现 `POST /v1/files`。
2. 如果完全没有请求到达网关，优先检查客户端本地 URI、文件权限和网络层。
3. 1.1.2 起使用 `expo-file-system` 原生 multipart 上传，不要退回 RN `fetch + FormData + { uri }`。
4. 如果上传成功但消息内图片是灰色占位，检查 `GET /v1/files/{attachmentId}` 是否返回 401；1.1.3 必须经 `gatewayImageCache.ts` 认证下载后使用本地 URI 显示，不要依赖 `<Image source.headers>`。
5. 图片加载失败时可以点按图片区域重试；不完整缓存必须删除，不能直接渲染。
6. 如果刚更新过代码但网关日志仍显示旧启动时间，执行 `start_lan_gateway.ps1 -Restart`；普通启动命令为保护现有连接会复用健康的网关进程。
6. 如果网关返回 413/415/401，应保留服务器的中文结构化错误，不要统一误报“服务器离线”。
7. PDF 读取通常要求 Responses 模式和第三方文件输入兼容。

### 键盘挡住输入框

- 保持 Manifest `windowSoftInputMode="adjustResize"`。
- Android 的 `KeyboardAvoidingView behavior` 必须为 `undefined`，避免与 `adjustResize` 重复避让。
- iOS 继续使用 `KeyboardAvoidingView behavior="padding"`。
- 不要把 `Composer` 移出 `KeyboardAvoidingView`。
- Android edge-to-edge、导航栏或 Expo/React Native 升级后必须重新做真机键盘测试。

### 回车没有发送或重复发送

- `TextInput` 必须保留 `submitBehavior="submit"`。
- `onSubmitEditing` 和按钮必须共用同一个 `submit()`。
- `submittingRef` 用于阻止同一帧内的快速重复触发，不要只依赖异步 React state。

### 切换对话后回复串线或另一个对话不可用

- 不得把“是否生成中”设计成全局单一布尔值。
- 每个 conversation ID 必须拥有独立 `GenerationController`。
- 所有流式 delta 必须按 conversation ID 和 assistant message ID 写回。
- 删除对话时必须取消对应生成控制器。

### 模型不允许、错误模型或自称 DeepSeek

- 登录和 Session 恢复后调用 `/v1/models`。
- 使用 `selectGatewayModel` 把旧模型迁移到管理员默认模型。
- 网关必须再次校验 allowed models，客户端选择不能作为安全边界。
- 模型自我描述属于生成内容，系统提示只能降低错误概率，无法绝对保证。

### Code Interpreter / Web Search 报不支持

- 先确认当前 `apiMode=responses`。
- 能否真正使用由第三方供应商决定。
- 保留网关的工具自动降级逻辑，避免因为一个不兼容工具导致普通文本对话完全失败。
- 不得宣称第三方能力与官方 Codex 完全一致。

### APK 下载到一半中断

- 下载服务必须保留 Range 请求处理。
- 验证 `Accept-Ranges: bytes`。
- 验证 Range 请求返回 `206` 和正确 `Content-Range`。
- 手机浏览器仍反复失败时，可在同一局域网换浏览器，或通过 USB/本地文件传输安装 APK；无需为了 LAN 测试强制部署公网服务器。

---

## 8. 已知限制与下一步优先级

### P0：每次新版必须真机回归

当前 1.1.3 已完成自动化和构建验证，但每次安装到用户真机后仍应回归：

1. 选择图片后，附件预览可见。
2. 键盘弹出时，输入框文字、附件预览和发送按钮全部可见。
3. 点击键盘“发送”会发送一次且仅一次。
4. 图片可上传、发送后可在消息中显示，并能被模型读取。
5. 图片首次加载失败时，点按图片区域可以重试。
6. PDF 可上传并被兼容模型读取。
7. 快速切换两个对话时，两个生成任务互不串线。
8. 局域网短暂断开时，错误提示准确且 partial 内容不丢失。

### P1：生产化

- 部署固定域名的 HTTPS/WSS 网关。
- 正式 Android release keystore，不再使用 debug signer。
- 使用 EAS 或 macOS/Xcode 生成签名 iOS IPA。
- 数据库、上传文件和 `SERVER_MASTER_KEY` 的加密备份与恢复演练。
- 生产日志轮转、监控、崩溃收集和告警。

### P1：可靠性

- 继续测试大图片、25 MB 边界、慢 Wi-Fi、后台切换和上传取消。
- 为聊天流增加更完整的网络故障回归测试。
- 在 UI 中显示附件逐个上传进度和失败文件名称。
- 检查第三方服务对工具、图片和 PDF 的实际能力矩阵。

### P2：体验候选项

以下是候选方向，不代表已经完成或承诺：

- 服务端同步对话历史，多设备登录后恢复。
- 更细粒度的工具调用状态和结果展示。
- 相机拍照、文件管理和附件重试。
- 消息搜索、导出、收藏和对话归档。
- 语音输入/播放。
- 管理员用量、限额和审计页面。

---

## 9. 修改完成后的固定交接清单

任何后续助手完成一轮工作后，都要更新本文件，并记录：

1. 修改日期和新版本号。
2. 用户报告的问题。
3. 根因。
4. 修改过的关键文件。
5. 新增/修改的测试。
6. `npm run verify` 结果。
7. APK/IPA/Web 构建结果。
8. 新产物路径、包名、versionCode/versionName 和 SHA-256。
9. 当前运行地址和健康检查。
10. 尚未解决的问题与下一步建议。
11. 严格确认没有在文档中写入任何秘密。

### 版本升级规则

- 小修复：`1.1.2 → 1.1.3`，Android versionCode `4 → 5`。
- 新功能：按语义化版本升级。
- Android 每一个可安装新包都必须提高 versionCode。
- 下载服务的 APK 文件名必须和真实产物一致。
- 覆盖安装包必须保持相同 applicationId 和签名证书。

---

## 10. 最近一次交接记录

### 2026-08-31：管理员默认账户、注册和聊天模型设置

- 网关配置新增默认管理员邮箱、密码、显示名称和自动创建开关；生产环境可通过环境变量覆盖。
- 保留注册、登录和管理员初始化流程，密码最小长度统一为 8 位。
- 管理员模型测试支持使用当前表单草稿直接获取模型，确认后再保存。
- 普通用户在托管网关模式下不再自由编辑模型 ID，只能从管理员发布的模型中选择。
- 聊天页顶部新增模型控制条和设置弹窗，可修改模型、推理强度与回答详略。
- 本次修改完成后必须重新运行 `npm run typecheck`、`npm run test`、`npm run lint` 和 `npm run build`。

### 2026-08-24 / 1.1.3

用户真机报告：

- 键盘弹出后附件预览能看到，但输入框和输入文字被键盘挡住。
- 图片上传与模型识图成功，但发送后的图片消息只显示灰色占位。

根因：

- 网关日志显示 `POST /v1/files` 返回 201，但图片读取 `GET /v1/files/{attachmentId}` 返回 401；该 Android 环境没有可靠携带 React Native `<Image source.headers>` 中的 Authorization Header。
- Manifest 的原生 `adjustResize` 与 `KeyboardAvoidingView behavior="height"` 同时生效，发生重复键盘避让。

修改：

- 新增 `apps/mobile/src/services/gatewayImageCache.ts`。
- 修改 `apps/mobile/src/components/MessageBubble.tsx`，通过认证下载、本地缓存、完整性检查、加载状态和点按重试显示图片。
- 修改 `apps/mobile/src/screens/ChatScreen.tsx`，Android 仅依赖 `adjustResize`，iOS 使用 `padding`。
- 新增 `apps/mobile/test/gatewayImageCache.test.ts`。
- 修改 LAN 构建、下载服务和启停脚本，自动跟随版本文件名并可靠清理旧端口进程。
- 仓库版本升级到 1.1.3，Android versionCode 和 iOS buildNumber 升级到 5。

验证：

- Mobile 7 个测试文件 / 26 项测试通过。
- Gateway 6 个测试文件 / 22 项测试通过；总计 48 项。
- TypeScript、ESLint 和 Android LAN Gradle 构建通过。
- APK v2 签名、包名、版本、ARM64 ABI、cleartext LAN、`adjustResize` 和预置网关地址验证通过。
- 新旧 LAN APK 的签名证书一致，可覆盖安装并保留 App 数据。
- 下载服务 HEAD、`Accept-Ranges: bytes` 和 Range `206 Partial Content` 验证成功。

产物：

```text
E:\gptapp\artifacts\NovaChat-1.1.3-android-arm64-lan.apk
大小：35,272,021 bytes
SHA-256：04311D719383EDA2A5E16E277E66FACDAD3DFD596D7C0F7F2B37EE6F988A9DEE
包名：com.novachat.mobile.lan
versionCode：5
versionName：1.1.3-lan
```

当前局域网交付地址（使用前仍需重新检查电脑 IP 和服务状态）：

```text
网关：http://192.168.0.113:8787
APK 下载页：http://192.168.0.113:8790
```

下一步：在用户 Android 真机直接覆盖安装 1.1.3，完成本文件第 8 节的 P0 回归；不需要卸载旧版。

### 2026-08-24 / 1.1.2

用户真机报告：

- 添加图片后弹出“无法连接服务器”。
- 安卓键盘弹出后输入框被完全遮住。
- 键盘回车不能发送。

根因：

- 图片选择成功，但 React Native `fetch + FormData + 本地 URI` 在请求发出前失败，因此网关日志中没有 `POST /v1/files`。
- Android `KeyboardAvoidingView` 的 behavior 原来是 `undefined`。
- 多行 TextInput 的回车默认插入换行，没有绑定 submit。

修改：

- `apps/mobile/src/services/gatewayApiClient.ts`
- `apps/mobile/src/services/gatewayUploadResponse.ts`
- `apps/mobile/src/components/Composer.tsx`
- `apps/mobile/src/screens/ChatScreen.tsx`
- `apps/mobile/test/gatewayUploadResponse.test.ts`
- `apps/mobile/package.json`
- 版本和 LAN 构建/下载脚本

验证：

- 45 项自动化测试通过。
- TypeScript 和 ESLint 通过。
- Android ARM64 LAN APK 构建成功。
- 包名、versionCode、versionName、cleartext LAN、`adjustResize`、预置网关地址和 v2 签名均验证。
- 新旧 LAN APK 的签名证书摘要一致，支持覆盖安装。
- 下载服务 HEAD 和 Range 206 验证成功。

产物：

```text
E:\gptapp\artifacts\NovaChat-1.1.2-android-arm64-lan.apk
SHA-256：11B4D758AF976A54B04002825E4C7176F7FF1C6F96E9E5C62352AFD235390120
```

下一步：安装到用户 Android 真机，完成本文件第 8 节的 P0 回归项目。

### 2026-09-01 / 1.1.7：生图无图片返回、旧网关进程和 LAN APK

用户反馈：

- 选择 `gpt-image-2` 并发送“生成一张亚洲美女照片”后，助手只返回“已生成……风格”的文字，没有图片。
- 之前还出现过“无法连接服务”和图片附件在 REST 回退路径丢失的问题。

根因与修复：

- 本次排查发现：旧网关进程约在 10:20 启动，而包含生图路由的最新 `dist` 直到 11:41 才构建；`scripts/start_lan_gateway.ps1` 原先发现 8787 已有健康网关时只复用旧进程，不会自动重启。因此截图请求实际命中了旧代码，被当作普通文字对话处理，模型只能返回文字描述。
- 已重启网关并确认最新进程当前为 PID 45152，启动时间为 2026-09-01 11:58:49；本机和局域网 `/health` 都返回 `ok: true`、`apiMode: responses`、默认模型 `gpt-5.6-sol`。
- `services/gateway/src/provider.ts` 已按生图意图和 `gpt-image-*` 模型选择 `/images/generations`，解析 Base64、data URL 和远程 URL，保存为网关附件，并通过 WebSocket/REST 返回附件引用；图片模型和文本模型分开降级。
- `apps/mobile/src/services/chatClient.ts` 的 REST fallback 已补传 `data.attachments`，WebSocket 不可用时不会再把生成图片丢掉。
- `scripts/start_lan_gateway.ps1` 新增 `-Restart` 参数。代码或 `dist` 更新后执行 `.\scripts\start_lan_gateway.ps1 -GatewayHost 192.168.0.113 -Restart` 以停止旧进程、重新构建并启动最新网关；普通启动仍复用健康进程。

模型、托管和参数边界：

- 管理员点击“获取模型”时，网关会从当前草稿配置的 `/models` 读取完整去重模型 ID 列表并立即发布；普通用户的“对话设置”从 `/v1/models` 读取这份已发布列表。列表是否包含所有模型取决于第三方 `/models` 返回内容以及管理员发布时的实际配置，不能由客户端凭空补出模型。
- Key 的 `/models` 里出现 `gpt-image-*` 不等于该 Key 有图片生成权限，也不等于服务商实现了 `/images/generations`；生图失败时应查看结构化错误中的权限、接口、限流或返回格式原因。
- 当前移动端实际只有统一 Gateway 模式：App 登录 Nova 网关，第三方 Base URL、Key、协议和允许模型由管理员统一维护。工作区中不存在 `apps/mobile/src/services/directApiClient.ts`，不要在后续交接中把“高级直连”描述成当前已实现功能。
- “推理强度”和“回答详略”会按第三方协议兼容性发送：Responses 使用 `reasoning.effort` / `text.verbosity`；Chat Completions 仅对看起来支持推理的模型发送 `reasoning_effort`，不发送通用性不足的 `verbosity`；图片请求不发送推理参数；不支持参数时会移除后重试。UI 的 `xhigh`/`max` 映射为兼容的 `high`。

本轮修改的关键文件：

- `services/gateway/src/server.ts`：修复管理员模型测试的请求取消生命周期，并保留草稿配置测试。
- `services/gateway/src/provider.ts`：模型目录解析、图片生成路由、图片/文本分组降级、流式错误识别、reasoning/verbosity 兼容重试。
- `apps/mobile/src/services/chatClient.ts`：REST fallback 返回图片附件引用。
- `scripts/start_lan_gateway.ps1`：新增安全的显式 `-Restart` 机制，避免更新代码后误用旧进程。
- `apps/mobile/src/screens/AdminScreen.tsx`、`SettingsScreen.tsx`、`ChatScreen.tsx`、`ChatOptionsModal.tsx`：完整模型目录展示、自动选择有效模型、对话设置和生图入口。
- `services/gateway/test/provider.test.ts` 及现有移动端测试：覆盖图片路由、图片/文本降级、参数映射、流式错误和附件缓存等行为。

验证结果（2026-09-01）：

- `npm run typecheck`：通过（mobile、gateway、protocol）。
- `npm run test`：通过，Mobile 6 个测试文件 / 15 项测试；Gateway 6 个测试文件 / 26 项测试。
- `npm run lint`：通过（mobile、gateway）。
- `npm run build`：通过（protocol、gateway）。
- 已重新生成包含 REST 附件修复的 Android ARM64 局域网测试 APK：`E:\gptapp\artifacts\NovaChat-1.1.7-android-arm64-lan.apk`；预置网关为 `http://192.168.0.113:8787`，大小 35,290,421 bytes，SHA-256 为 `0FFBAA1F27861F24860DE74F783FF59E35763239DCA665CC0AC909404E206517`。该包允许可信局域网明文 HTTP，仅供测试使用。
- 下载服务 `http://192.168.0.113:8790/` 正常；APK HEAD 返回 200、`Content-Length: 35290421`、`Accept-Ranges: bytes`，Range `bytes=0-1023` 返回 206。

尚未完成：

- 尚未在用户真实 Android 设备上重新回归登录、完整模型列表、自动生图、图片显示、PDF、弱网和多对话切换；第三方服务对每个图片模型的真实权限仍需用用户实际 Key 做端到端验证。
- 如果重新安装/更新 APK、确认手机和电脑在同一 Wi-Fi 后仍无图，下一步应查看网关对该请求返回的结构化图片错误；不能仅凭“已生成”文字判断图片接口成功。


### 2026-09-01 / 1.1.8：重新打包、图片回归和长上下文

用户继续反馈：

- 生图请求仍没有返回图片，怀疑没有重新打包。
- 长对话聊到一定长度后无法继续，希望接近 Codex 的长上下文体验。

本轮处理：

- 修复原生 Android 版本同步，并重新构建 `NovaChat-1.1.8-android-arm64-lan.apk`。
- 已通过 `npm run verify`：Mobile 6 个测试文件 / 15 项测试，Gateway 6 个测试文件 / 28 项测试，TypeScript 和 ESLint 全部通过。
- 已通过 `npm run build`：protocol 和 gateway 构建通过。
- 已通过 Android LAN Gradle 构建；APK 元数据为：
  - 包名：`com.novachat.mobile.lan`
  - versionCode：`10`
  - versionName：`1.1.8-lan`
  - ARM64 LAN 测试包，允许可信局域网明文 HTTP
- 当前 APK 大小为 35,291,245 bytes，SHA-256 为 `0312525EF4D52AB9692FD020E0DBC645687244ED6DEC8D8840F4F3941C6AFF78`。
- 下载服务已经指向 1.1.8 产物；HEAD 返回 HTTP 200，Content-Length 为 35,291,245，支持 HTTP Range。
- 当前网关健康检查（本机和局域网地址）均返回 `ok: true`、`service: nova-chat-gateway`、`apiMode: responses`、默认模型 `gpt-5.6-sol`。
- 当前实际发布模型为 13 个，包含 `gpt-image-1`、`gpt-image-1.5`、`gpt-image-2`；图片模型是否可用仍取决于第三方 Key 的权限和接口实现。
- 已完成 `gpt-image-2` 真实端到端生图验证：HTTP 200、1 个 PNG 附件、网关授权文件读取 HTTP 200。

交付地址（当前局域网）：

```text
APK 下载页：http://192.168.0.113:8790
APK 直链：http://192.168.0.113:8790/NovaChat-1.1.8-android-arm64-lan.apk
网关健康检查：http://192.168.0.113:8787/health
```

安装说明：

1. 手机和电脑连接同一个 Wi-Fi。
2. 下载并安装 1.1.8 LAN APK；若系统不允许覆盖安装，先卸载旧 LAN 版本再安装。该包使用相同调试签名，正常情况下可直接覆盖安装。
3. 安装后确认 App 显示/预置网关为 `http://192.168.0.113:8787`。
4. 如果仍显示旧界面，说明手机没有实际装上新包；检查 Android 应用信息中的 versionName 是否为 `1.1.8-lan`。
5. 如果仍提示无法连接，先确认手机能访问 `192.168.0.113`，电脑上的 8787 网关和 8790 下载服务保持运行。

严格确认：本次记忆记录没有写入任何 API Key、Session Token、管理员密码、初始化口令、`SERVER_MASTER_KEY` 或 `.env` 真实内容。


### 2026-09-01 / 1.1.9：后台生成、自动生图与键盘滚动修复

用户继续反馈：

- App 退到后台后生成任务应继续执行，回到前台后不能丢失文本或图片结果。
- 选择文本模型时，生图请求应自动内部调用图片模型；图片模型不可用时应按优先级降级。
- 推理强度选项需要与实际协议一致，旧版“最大”设置需要兼容迁移。
- Android 键盘弹出、输入框变高或正在打字时，聊天记录应像微信一样自动上移，保证能看到当前消息和输入区域附近的历史内容。

本轮处理：

- 网关在 WebSocket 断开后继续执行生成任务，并保留任务结果约 30 分钟。
- 新增后台任务查询与取消接口：`GET /v1/chat/jobs/:requestId`、`POST /v1/chat/jobs/:requestId/cancel`。
- 移动端断线后轮询任务状态，支持增量文本、完整文本快照恢复、usage/model 信息和图片附件恢复；取消操作在断线时也走 REST 接口。
- 文本模型触发生图意图时自动优先调用 `gpt-image-2`，并按已配置的图片模型顺序降级；自动路由不会覆盖用户当前选择的文本模型。
- 旧版 `reasoningEffort: "max"` 迁移为 `xhigh`；UI 使用“无、低、中、高、极高”，请求层继续兼容旧值并按协议映射。
- 修复 Android 键盘布局变化后消息列表未上移的问题：输入框聚焦、键盘显示、输入框高度变化及布局变化时分阶段滚动到最新消息，并恢复底部跟随。
- 修复 LAN 下载服务仍提供旧 APK 的问题，重启服务后已切换到 1.1.9。
- Android LAN APK 版本升级为 `1.1.9-lan`，versionCode `11`，包名 `com.novachat.mobile.lan`，ARM64 测试包。

验证结果（2026-09-01）：

- `npm run verify`：通过。
- `npm run build`：通过。
- 网关健康检查：`http://192.168.0.113:8787/health` 返回 `ok: true`。
- 下载服务健康检查：`http://192.168.0.113:8790/health` 返回 `ok: true`。
- APK HEAD 请求返回 HTTP 200，Content-Length `35,297,169` bytes，支持 Range 下载。
- APK：`E:\gptapp\artifacts\NovaChat-1.1.9-android-arm64-lan.apk`。
- SHA-256：`AFC780856D27CCBB8F5288320E19EE8DEDEC1044E2CCA933CD3CB3F619E4CA55`。
- 下载页：`http://192.168.0.113:8790`。
- APK 直链：`http://192.168.0.113:8790/NovaChat-1.1.9-android-arm64-lan.apk`。

安全记录：本次记忆没有写入任何 API Key、Session Token、管理员密码、初始化口令、`SERVER_MASTER_KEY` 或真实 `.env` 内容。

### 2026-09-01 / 1.1.10：自动生图、头像显示与乱码修复

用户继续反馈：

- 即使选择文本模型，输入“生成照片/生照片/做头像/生成壁纸”等指令时仍希望自动调用图片模型。
- 头像上传后个人资料区没有正常显示；原先头像附件读取会出现鉴权失败。
- 个人资料名称、头像 initials 等位置出现黑色菱形问号（Unicode replacement character）乱码。
- 修复后需要重新打包 APK，并让下载服务提供最新包。

本轮处理：

- 扩大中文生图意图识别范围，支持“生成照片”“帮我生成一张照片”“做一个头像”“给我做一张壁纸”“生照片”“生成一张猫的图片”等自然表达。
- 增加否定/询问保护： “不要生成图片”“为什么不能生成照片”“怎么生成头像”不会误触发生图；“不要文字，生成一张照片”仍会正确进入图片生成路由。
- 文本模型继续负责普通对话；检测到生图意图后，网关内部自动调用 `/v1/images/generations`，优先使用 `gpt-image-2`，失败后按 `gpt-image-1.5`、`gpt-image-1` 降级，不要求用户手动切换模型。
- 头像改为使用带 `Authorization: Bearer <session token>` 的文件下载请求，下载到本地缓存后渲染本地 `file://` URI；新选择的头像仍立即使用本地预览。头像附件缺少服务端 `size` 时，只要本地缓存文件存在且非空即可复用，不再错误拒绝。
- 新增用户名称规范化：检测空字符串、U+FFFD（`�`）和典型 `ï¿½` 乱码；管理员回退为“管理员”，普通用户回退为邮箱 `@` 前的部分；正常中文名不改写。资料保存时若仍含乱码会提示重新输入，避免把乱码再次写回服务端。
- 相关修复已接入登录、注册、当前用户、资料更新、头像上传、设置、管理员用户列表和头像组件。
- Android LAN 版本升级为 `1.1.10-lan`，versionCode `12`，包名 `com.novachat.mobile.lan`，ARM64 测试包；已重新打包，避免手机继续使用旧版 JS bundle。

验证结果（2026-09-01）：

- `npm run verify`：通过（TypeScript、Mobile 7 个测试文件 / 20 项测试、Gateway 6 个测试文件 / 37 项测试、ESLint）。
- `npm run build`：通过（protocol、gateway）。
- Android LAN Gradle 构建：通过，APK 已生成。
- 网关健康检查：`http://192.168.0.113:8787/health` 返回 `ok: true`，`apiMode: responses`，默认模型 `gpt-5.6-sol`。
- 下载服务健康检查：`http://192.168.0.113:8790/health` 返回 `ok: true`。
- APK：`E:\gptapp\artifacts\NovaChat-1.1.10-android-arm64-lan.apk`。
- APK 大小：`35,300,797` bytes。
- SHA-256：`EF87FE76A5A5AA3EBBC6A235E599E914ED62579DDEDA4E1CCF3E8578C119E0BE`。
- APK HEAD 请求返回 HTTP 200、`Content-Length: 35300797`，并支持 Range 下载；下载服务已重启并切换到 1.1.10。
- 下载页：`http://192.168.0.113:8790`。
- APK 直链：`http://192.168.0.113:8790/NovaChat-1.1.10-android-arm64-lan.apk`。

安装/使用提示：

1. 手机和电脑连接同一个 Wi-Fi。
2. 打开下载页或 APK 直链，安装 `1.1.10-lan`；如不能覆盖安装，先卸载旧 LAN 包再安装。
3. 安装后确认网关为 `http://192.168.0.113:8787`。
4. 选择任意文本模型后直接输入“生成一张照片：……”即可；网关会内部选择图片模型并在失败时降级。图片模型是否最终可用仍取决于当前 Key 的图片接口权限和服务商实现。

安全记录：本次记忆没有写入任何 API Key、Session Token、管理员密码、初始化口令、`SERVER_MASTER_KEY` 或真实 `.env` 内容。

补充端到端验证（使用本机现有配置，输出已避免包含敏感凭据）：

- `node .run/verify_live_image_gateway.mjs`：通过。
- `/v1/models` 返回 HTTP 200，共 13 个已发布模型，包含 `gpt-image-2`。
- 发送中文“生成一张简单的蓝天白云插画，画面干净，不要文字”时，网关返回 HTTP 200，实际响应模型为 `gpt-image-2`，返回 1 个 PNG 图片附件。
- 该附件通过带鉴权的 `/v1/files/<id>` 读取返回 HTTP 200，PNG 文件签名正确；说明自动生图和图片回传链路已在网关端闭环验证。


### 2026-09-02：生成中追问、图片续作与上下文修复

用户反馈：回答生成期间无法继续发送；生成照片后说“[Image #1]”“这张不满意”“我要全身的”等要求仍被当作普通文本；历史图片和上下文记忆不稳定。

本轮修改：

- 移动端 Composer 在回答生成期间不再锁定输入；有新文本或附件时发送按钮优先发送新请求，输入为空时才显示停止。
- ChatScreen 按 `requestId` 保存多个活动生成任务，同一对话可并行发送追问；delta、完成、取消和错误都按原对话及 assistant message ID 写回。
- 完成的图片助手消息（包括无文字、只有图片附件的消息）会进入客户端和协议层上下文裁剪；未完成的图片消息仍会排除。
- 网关识别“生照片”、自然语言生图和图片修改意图；存在历史图片时，“不满意、改成全身、换背景、再来一张”等追问自动调用 `/images/generations`。图片 prompt 会带上原始创作要求、之前修改和本次修改。
- 普通视觉问题会将历史助手图片转换为 `input_image`/`image_url` 输入，不再把非法 `attachments` 字段放到 assistant 消息中；失效的历史图片引用会被忽略，不阻断普通文本请求。
- 当前图片续作采用跨服务商兼容的文字重建方式，尚未统一使用 multipart `/images/edits`，因此具体保真度仍取决于图片服务商。

验证结果（2026-09-02）：`npm run typecheck --workspaces --if-present`、`npm run test --workspaces --if-present`（Mobile 7 个测试文件 / 22 项测试，Gateway 6 个测试文件 / 40 项测试）、`npm run lint --workspaces --if-present`、`npm run build` 和 `npm run verify` 均通过。未重新构建 APK。

### 2026-09-03：回答模型归属、模型切换竞态与停止生成修复

用户反馈回答流程和模型切换不稳定，并要求一并排查其他明显问题。

本轮定位与修复：

- 修复旧回答完成后覆盖用户新模型选择的竞态：服务端返回的实际响应模型不再写回全局设置，用户手动选择只影响后续发送。
- 每条 assistant 消息新增可选的 `requestedModel` 和 `model` 元数据；发送和重新生成时冻结请求模型，完成时保存网关实际使用的模型。消息气泡会显示正在使用、请求模型或“实际模型 / 原选模型”，自动降级和图片模型路由不再看起来像串模型。
- 修复模型目录 effect 依赖当前模型导致每次切换都重拉 `/v1/models` 的问题；目录请求失败时保留已有模型，不再退化成单一模型，打开对话设置时会主动重试，并用最新设置处理异步响应。
- 修复空 body 的 POST/DELETE 请求仍携带 `Content-Type: application/json`，被 Fastify 5 以 `FST_ERR_CTP_EMPTY_JSON_BODY` 拒绝的问题。停止生成、登出、删除头像和无参数 Provider 测试现在不会发送错误的 JSON Content-Type。
- 阻止同一条 streaming assistant 消息被重复“重新生成”，并在启动前增加活动任务去重，避免两个请求的 delta 写入同一消息。
- 对活动生成任务增加消息级清理：对话被删除、重新生成截断后消息消失或消息不再 streaming 时，会取消并移除对应后台任务，避免孤儿请求继续运行。
- 修正生成启动失败后的提示和 Composer 行为：消息已经写入历史时会清空输入，避免用户再次点击造成重复发送；错误文案不再错误声称“当前对话已有回复正在生成”。
- 清理 Mobile Vitest 配置中重复的 `expo/file-system` alias。

新增回归覆盖：

- bodyless POST/DELETE 不携带 JSON Content-Type，而有 JSON body 的登录请求仍正确设置。
- 模型切换后旧回答完成不会改变新选择，消息会保留请求模型和实际模型。
- 重新生成会冻结当时的新模型并拒绝重复重新生成。
- 回答气泡的模型标识覆盖正常、生成中和实际降级场景。

验证结果（2026-09-03）：

- `npm run verify`：通过。
- Mobile：10 个测试文件 / 29 项测试通过。
- Gateway：6 个测试文件 / 40 项测试通过。
- Mobile、Gateway、Protocol TypeScript 检查通过；Mobile、Gateway ESLint 通过。
- `npm run build`：通过（Protocol、Gateway）。
- 本轮未重新构建 Android APK。

安全记录：本次记忆没有写入任何 API Key、Session Token、管理员密码、初始化口令、`SERVER_MASTER_KEY` 或真实 `.env` 内容。

### 2026-09-03：移动 App 对话页重设计、附件入口与 durable job 恢复

用户要求继续缩小与 Codex/豆包类移动对话体验的差距，重点改进 App 页面、模型下拉选择、默认思考强度、拍照/相册/文件入口和后台回答可靠性。

本轮完成：

- 聊天页删除原来的顶部“当前模型”大卡片；导航栏标题改为 `Nova + 当前思考强度 + 下拉箭头`，点击后打开“模型与回答方式”弹窗。模型 ID 只在弹窗/设置页中显示，不再占用对话页首屏。
- “模型与回答方式”弹窗改成原生移动端分组卡片设计：支持模型搜索、明显的模型选中态、完整中文思考档位、回答详略，并明确标注“中等思考”为默认值。设置页的思考档位文案同步改为“直接、轻度、中等、深度、高强度”。
- 新安装/无有效旧设置时继续默认 `reasoningEffort: medium`；不会强制覆盖用户以前主动保存的其他思考档位。旧 `max` 仍安全迁移为 `xhigh`。
- Composer 改成移动 App 风格：横向思考/网页搜索/代码工具快捷条，圆角浮动输入框，独立停止按钮、附件加号和发送按钮。回答生成时仍可输入并发送下一条消息，停止操作不会占用发送入口。
- 新增附件托盘和直接拍照入口：相机、相册、文件三项均可触达；最多 8 个附件，单个 25 MB。附件能力已在 1.1.12 扩展为常见图片、PDF、文本/代码、Office/OpenDocument、EPUB/MOBI 等；界面不再展示完整支持格式列表，由网关负责真实类型校验。
- 新增相机权限申请和 `launchCameraAsync` 流程，并复用图片 MIME、名称、大小和格式校验。`app.json` 不再阻止 Android CAMERA 权限，加入 Expo ImagePicker 的照片/相机中文权限说明，同时显式关闭麦克风权限；当前没有伪造语音或电话功能。
- 空对话页改为更轻量的 Nova 标识、推荐问题和“拍照提问或识别内容”入口；空状态现在可纵向滚动，避免小屏设备被 Composer 挤压后内容溢出。
- assistant 消息继续保存请求模型与实际模型，并新增/保留 durable generation 元数据：`generationRequestId`、冻结的思考/详略/token/工具选项、开始时间和完成时间。每轮发送及重新生成都绑定当时选择的模型与选项，旧回答完成不会覆盖用户后来选择的模型。
- App 重启/重新 hydration 后，带 durable request ID 的 streaming 消息会轮询 Gateway job 并重新附着；支持增量快照、完整文本替换、完成、取消、失败和 job 过期。页面卸载只 `dispose()` 本地监听，不取消服务器任务；用户明确停止或删除仍在生成的对话时才会取消 Gateway job。
- assistant 回答增加可折叠详情：请求模型、实际模型、是否发生网关切换、思考强度、回答详略、工具、输出 token 上限、token 用量、耗时和短任务 ID。回答详情及复制/重新生成按钮扩大触控区域，摘要文字不再抢占点击手势。
- 历史页支持同时搜索标题与消息正文，显示总数、搜索结果数和后台生成数；每条记录显示摘要、消息数、生成状态、更新时间和当前对话标记，并增加跨平台重命名与删除操作。修复三点菜单点击冒泡导致误打开对话、点击 action sheet 内部可能误关闭的问题。
- 对话标题重命名会合并多余空白、拒绝空标题并限制 80 字符。

验证结果（2026-09-03，Asia/Shanghai）：

- `git diff --check`：通过；仅有 Windows 下 LF/CRLF 转换提示，没有空白错误。
- `npx expo config --type public`：通过；Expo SDK 57 配置、相机/照片权限插件解析成功。
- `npx expo export --platform android`：通过；Metro 成功打包 1316 个模块并生成 Android Hermes bundle。
- `npm run verify`：通过。
- Mobile：11 个测试文件 / 39 项测试通过。
- Gateway：6 个测试文件 / 40 项测试通过。
- Mobile、Gateway、Protocol TypeScript 检查通过；Mobile、Gateway ESLint 通过。
- `npm run build`：通过（Protocol、Gateway）。
- 本轮未做真机像素级截图验收；后续仍需在 360px 左右手机、深浅色和软键盘场景完成真机点按回归。
- 发现仅修改 `app.json` 尚未同步到已存在的原生 Android Manifest：`apps/mobile/android/app/src/main/AndroidManifest.xml` 仍通过 `tools:node="remove"` 移除 CAMERA 权限。已改为显式声明 `android.permission.CAMERA` 并重新构建，避免“拍照”入口在安装包中无法取得相机权限。
- 已于 2026-09-03 11:09（Asia/Shanghai）重新构建并发布 `E:\gptapp\artifacts\NovaChat-1.1.11-android-arm64-lan.apk`，预置网关为 `http://192.168.0.113:8787`。
- APK 元数据：包名 `com.novachat.mobile.lan`，versionName `1.1.11-lan`，versionCode `13`，minSdk 24，targetSdk 36，仅含 `arm64-v8a`。
- APK 大小：`35,331,221` bytes；SHA-256：`7D48AAD69753AE89E3E590C5F3A020B845A42D07715DE02DEEE365CB63E9C3E9`。
- APK 权限复核：包含 `android.permission.INTERNET` 与 `android.permission.CAMERA`，不包含麦克风和旧式外部存储权限。
- `scripts/build_lan_android.ps1` 已加固：每次 LAN 构建前会同步被 Git 忽略的原生 Manifest 相机权限；构建后强制检查包名、版本、ARM64 架构、INTERNET/CAMERA 权限、无麦克风权限、APK 签名和 zipalign，任一不符合都会让构建失败，避免以后再次发布“名称是最新版但原生能力未同步”的测试包。
- 下载服务和网关健康检查均通过；直链 HEAD 返回 HTTP 200、`Content-Length: 35331221`、`Accept-Ranges: bytes`、`Cache-Control: no-store`。从 8790 完整下载后的 SHA-256 与本地构建产物完全一致。
- 当前手机下载直链：`http://192.168.0.113:8790/NovaChat-1.1.11-android-arm64-lan.apk`。

安全记录：本次记忆没有写入任何 API Key、Session Token、管理员密码、初始化口令、`SERVER_MASTER_KEY` 或真实 `.env` 内容。
### 2026-09-03：1.1.12 附件能力、字体和最新测试包

针对“文件种类太少、页面字体和移动端体验不够好、需要最新 APK 测试”的反馈，已完成并验证以下更新：

- 版本统一升级为 `1.1.12`：根项目、Mobile、Gateway、Protocol、Android `versionCode=14`、iOS `buildNumber=14`；`package-lock.json` 已同步。
- 附件支持扩展：JPEG、PNG、WebP、GIF、HEIC/HEIF、AVIF、BMP、TIFF；PDF；TXT/Markdown/CSV/TSV/JSON/JSONL/XML/HTML/CSS/JS/TS/Python/Java/Kotlin/C/C++/C#/Go/Rust/Ruby/PHP/Swift/Shell/SQL/YAML/TOML/RTF 等文本和代码；DOC/DOCX/DOT/DOTX/DOCM/DOTM、XLS/XLSX/XLT/XLTX/XLSM/XLTM、PPT/PPTX/PPS/POTX/PPTM/POTM/PPSX/PPSM；ODT/OTT、ODS/OTS、ODP/OTP；EPUB、MOBI。
- 网关增加真实文件签名校验、ZIP 解压大小限制，并支持从 Office/OpenDocument/EPUB/MOBI 提取文本；Chat Completions 对不能直接读取的文档返回通用降级提示，不再只针对 PDF。
- 移动端文件选择器使用 `*/*`，页面只显示附件数量和大小限制，不再在界面上堆叠“支持格式列表”；服务器仍会拒绝不安全或不支持的真实文件。
- 全局字体改为 Google Fonts 的 Manrope，并增加加载失败时的系统字体回退；主要页面、输入框、弹窗和消息组件已统一主题字体。
- 对话页移除重复的顶部当前模型大卡片，模型从 Nova 下拉入口选择；默认思考强度为“中等思考”。拍照、相册、文件入口均保留，并同步 Android 原生 CAMERA 权限。
- 已完成 `npm run verify`、`npm run build`、`npx expo export --platform android` 和 `git diff --check`；Mobile 11 个测试文件/39 项测试，Gateway 7 个测试文件/47 项测试全部通过。
- 最新 ARM64 LAN APK：`artifacts/NovaChat-1.1.12-android-arm64-lan.apk`；包名 `com.novachat.mobile.lan`；versionName `1.1.12-lan`；versionCode `14`；仅 `arm64-v8a`；预置网关 `http://192.168.0.113:8787`；包含 INTERNET/CAMERA 权限，不含 RECORD_AUDIO。
- APK 大小 `35,633,629` bytes；SHA-256：`C6E413D9E6D5C9C21E4BBA8B78C936EA0D0BB59DB6664B71391BEBA0E480216B`。
- 已重启局域网下载服务并切换到 1.1.12。手机下载地址：`http://192.168.0.113:8790/NovaChat-1.1.12-android-arm64-lan.apk`；HEAD 返回 HTTP 200、Content-Length `35,633,629`、支持 Range，完整下载校验与本地产物 SHA-256 一致。
- 本次未写入任何 API Key、Session Token、管理员密码、初始化口令、`SERVER_MASTER_KEY` 或真实 `.env` 内容。

> 本节关于 APK 和下载服务的记录 supersedes 之前 1.1.11 记录；以后每次功能或版本更新都要重新构建 APK、更新 `artifacts`、重启下载服务并同步本文件。

### 2026-09-03：1.1.13 会话独立性与并发生成隔离

针对“每个会话的内容必须独立、切换会话或模型不能互相影响、旧请求不能覆盖新回答”的反馈，已完成以下修复：

- 移动端生成回调统一按 `conversationId`、assistant 消息和 `requestId` 作用域写回；`appendAssistantDelta`、`replaceAssistantContent`、`completeAssistant`、`failAssistant`、`cancelAssistant` 会拒绝不匹配的旧请求，避免延迟回调污染新一代回答或其他会话。
- 正常生成、停止生成、重新生成、后台恢复任务以及恢复任务的完成/失败/取消回调全部接入同一套 requestId 校验。
- Durable generation 任务的查询和取消增加 `conversationId` 参数；网关会校验任务所属会话，错误会话返回 404，缺失或无效会话标识返回 `invalid_conversation_scope`，避免跨会话恢复或取消后台任务。
- WebSocket `cancel` 消息要求同时携带 `requestId` 和 `conversationId`，取消操作也受到会话作用域保护。
- 补充移动端和网关回归测试，覆盖两个会话互不影响、旧 requestId 不能修改新任务、错误会话恢复被拒绝，以及 durable job 查询/取消的会话参数校验。

验证结果：

- `npm run verify`：通过。
- `npm run build`：通过。
- Mobile：11 个测试文件、42 项测试通过；TypeScript 和 ESLint 通过。
- Gateway：7 个测试文件、48 项测试通过；TypeScript 和 ESLint 通过。
- 已重新导出 Android Hermes bundle 并重新构建最新版 ARM64 LAN APK。

最新版 APK：

- 文件：`artifacts/NovaChat-1.1.13-android-arm64-lan.apk`
- 包名：`com.novachat.mobile.lan`
- versionName：`1.1.13-lan`
- versionCode：`15`
- 架构：仅 `arm64-v8a`
- 预置网关：`http://192.168.0.113:8787`
- 权限：包含 INTERNET、CAMERA；不包含 RECORD_AUDIO
- 大小：`35,634,173` bytes
- SHA-256：`0848D61152E81C0A147D4210E05E4B64896028CA5ED2DD891E4FBB25C11515FC`
- 手机下载地址：`http://192.168.0.113:8790/NovaChat-1.1.13-android-arm64-lan.apk`

下载服务已切换到 1.1.13 后，需验证直链 HEAD 返回 HTTP 200、Content-Length 与 APK 大小一致、支持 Range，并校验完整下载文件的 SHA-256 与本地产物一致。

安全记录：本次记忆没有写入任何 API Key、Session Token、管理员密码、初始化口令、`SERVER_MASTER_KEY` 或真实 `.env` 内容。

下载服务补充验证（2026-09-03）：

- 已安全重启 `8790` 局域网下载服务，服务读取当前 `apps/mobile/app.json` 版本后已切换至 `1.1.13`。
- `http://192.168.0.113:8790/` 页面已列出 `NovaChat-1.1.13-android-arm64-lan.apk`。
- APK 直链 HEAD：HTTP 200；`Content-Length: 35,634,173`；`Accept-Ranges: bytes`。
- Range 请求 `bytes=0-15`：HTTP 206，`Content-Range: bytes 0-15/35634173`。
- 从下载地址完整下载后的文件大小为 `35,634,173` bytes，SHA-256 与本地产物一致：`0848D61152E81C0A147D4210E05E4B64896028CA5ED2DD891E4FBB25C11515FC`。
### 2026-09-04：账号隔离回归、注册开关/管理员/Token 测试与朋友下载包

- 复核移动端账号隔离：对话持久化按 `userId + serverUrl` 分桶；登录、登出或 `/v1/auth/me` 识别到不同账户时先清空可见本地状态；生成回调按 `conversationId + messageId + requestId` 校验，旧请求不能写入新会话。
- 新增网关回归覆盖：`REGISTRATION_ENABLED=false` 时公开注册返回 `registration_disabled`，已有管理员仍可登录；配置的 legacy `APP_ACCESS_TOKEN` 可鉴权 legacy 用户，错误 Token 返回 401，logout 不会把静态 legacy Token 误当作可撤销 Session。
- 定向测试：Gateway 管理员/注册开关/Token 18 项通过；Mobile 账号隔离与生成代际 8 项通过。
- `npm run verify`：通过；Mobile 12 个测试文件 / 44 项测试，Gateway 7 个测试文件 / 50 项测试，TypeScript 与 ESLint 均通过。
- `npm run build`：通过（Protocol、Gateway）。
- 已重新构建当前 1.1.13 ARM64 LAN APK，覆盖 `artifacts/NovaChat-1.1.13-android-arm64-lan.apk`；包名 `com.novachat.mobile.lan`，versionName `1.1.13-lan`，versionCode `15`，仅 `arm64-v8a`，预置网关 `http://192.168.0.113:8787`。
- APK 大小 `35,638,181` bytes；SHA-256：`3301FB0F50ABCF0085BF2F01E775AC8CC7B7B0690EBCB64E478573B107CB2689`；构建脚本已验证 INTERNET/CAMERA、无 RECORD_AUDIO、签名和 zipalign。
- 已准备仅包含当前 APK 的临时分享目录 `.run/friend-share`，并启动 Cloudflare Quick Tunnel。公网地址和 Token 只在当前交接消息中提供，不写入本文件；下载完成后执行 `powershell -ExecutionPolicy Bypass -File scripts\stop_download_tunnel.ps1`。
- 临时下载入口已验证：页面 HTTP 200；APK HEAD HTTP 200、Content-Length `35,638,181`、支持 Range；`bytes=0-15` 返回 206；完整公网下载文件 SHA-256 与本地产物一致。
- 该 APK 是 LAN 测试包，朋友即使能从公网下载，安装后仍需与 `192.168.0.113` 所在局域网连通，或在 App 设置中改为可访问的网关地址；当前 Quick Tunnel 仅用于 APK 下载，没有把 LAN APK 自动改成公网网关配置。

### 2026-09-04：共享图片服务账号的并发 429 排查与网关排队修复

- 运行日志确认用户截图中的 `Concurrency limit exceeded for account` 来自上游图片服务返回的 HTTP 429，而不是手机网络、Cloudflare Tunnel、用户本地账号或 Nova 自己的按用户并发限制。
- 原因是公网与局域网用户都使用管理员在同一个 Gateway 中配置的同一第三方 API Key；上游按 provider account 计算图片并发，所以一个用户正在生成图片时，另一个用户可能撞到账号级并发上限。稍后名额释放后另一请求又会成功，因此会出现“朋友失败、我们能用”的时间差。
- Gateway 新增共享图片请求 FIFO 信号量，默认 `MAX_CONCURRENT_IMAGE_REQUESTS=100`：同一 Gateway 最多允许 100 个图片请求同时进入上游；文字请求不受该队列影响，等待中的请求支持 AbortSignal 取消，取消后不会占用名额。当前上游账号已确认支持高并发，因此生产 `.env` 已设置为 100；如果服务商配额变化，应按实际配额调小。
- 上游并发 429 现在映射为 `provider_concurrency_limited` 和中文可重试提示，不再把英文错误原样显示给用户。
- 即使有 Gateway 之外的程序共用同一 Key，图片请求仍会按 `Retry-After` 或 5 秒、10 秒的有限退避自动重试；重试次数与最大等待可通过环境变量调整，默认只重试 2 次，避免无限放大请求和计费。
- 新增回归测试覆盖：并发错误中文映射、同一图片模型自动重试、不同用户共享账号时不并发调用上游、排队请求可取消、AsyncSemaphore 释放与取消、配置默认值。
- `npm run verify` 通过：Mobile 12 个测试文件 / 44 项测试；Gateway 7 个测试文件 / 58 项测试；所有 workspace TypeScript 与 ESLint 均通过。
- 最新 Gateway 已构建并重启；本机、局域网、公网 `/health` 均返回正常，公网注册开关仍为启用，Gateway stderr 为空。公网 Tunnel、局域网下载服务和公网下载服务未被重启或冲突。
- 本次仅修改服务端 Gateway；已经安装公网 APK 的朋友无需重新下载或重新配置，继续使用原公网地址即可自动获得排队与重试修复。

安全记录：本次记忆没有写入任何 API Key、Session Token、管理员密码、初始化口令、下载 Token、`SERVER_MASTER_KEY` 或真实 `.env` 内容。

### 2026-09-04：GitHub 公共发布整理

- 重写 `README.md`：增加中英文项目定位、功能矩阵、快速开始、生产部署、下载安全、分享和贡献入口，明确 Nova Chat 是第三方开源客户端，不是 OpenAI/ChatGPT/Codex 官方产品。
- 增加根 `package.json` 的 description、repository、homepage、issues 和 keywords，帮助代码托管平台与开发工具正确识别项目。
- 增加 `CONTRIBUTING.md` 以及 GitHub Bug/Feature Issue 表单，方便新用户反馈和贡献。
- 已完成本地验证：`npm run verify`（Mobile 44 项测试、Gateway 58 项测试、TypeScript、ESLint）通过；`npm run build` 通过。
- APK 继续保持不提交进 Git 历史，公开分发应使用 GitHub Releases 或支持 HTTPS/Range 的对象存储；不要分享包含局域网地址、临时 Tunnel 或秘密信息的测试包。

安全记录：本次记忆没有写入任何 API Key、Session Token、管理员密码、初始化口令、下载 Token、`SERVER_MASTER_KEY` 或真实 `.env` 内容。


### 2026-09-08 启动的自主完善（本机 2026-09-09 收尾，未发布）

- 保留了原 1.1.14 dirty 工作；未 reset/checkout、未 commit/push、未升级版本、未生产发布/重启既有服务、未调用付费模型。
- 新增：数据与备份页（JSON 增量导入/全量导出、单对话 Markdown）、历史置顶/归档/改名/搜索、各对话草稿、内置/自定义助手库、账户安全中心、无付费连接诊断。
- 修复：100 对话静默截断、最后 delta/退出保存、账户+网关设置归属、慢 SecureStore token 复活、损坏本地快照覆盖、WS 会话/权限失效、异步帧异常及保留计时器清理。
- 原始恢复快照在账户/网关范围保留，不是可直接导入的标准聊天备份；可能含系统指令/地址/草稿等隐私。标准聊天备份不含附件本体、草稿或助手配置。
- 最终 npm run verify：mobile 95 + gateway 71 + scripts 3 = 169 tests，全 types/lint 通过；protocol/gateway build、三端 Expo export、Expo install --check 通过。
- 独立 Android staging 位于 .run/qa，没有覆盖原 apps/mobile/android；已构建 com.novachat.mobile.qa（Nova QA，1.1.14/code16，arm64，Debug 签名，QA HTTP=true，无内置网关）。
- APK：artifacts/autonomous-20260908/NovaChat-1.1.14-qa-arm64.apk，35,861,392 bytes。
- SHA-256：6e8f619f41881b97be9da928eada5bcab5176f874b34bc0682205b6c4789dcdf。APK 签名/ZIP16KB/19 个 ELF 库 LOAD 段静态检查通过。59 个运行时源码/资源与 staging 一致。
- 隔离 loopback 网关 HTTP/WS 冒烟通过（12 HTTP，ready→撤销4401，改密全会话失效）。自己的 8897/8898 fixture 已停止；没有真实上游调用或用户账户变更。
- GUI 控制无浏览器且原生控制依赖不可用；未做截图/真机验收，也未做 iOS 原生编译。不可把编译通过描述为可直接正式发布。
- 仍有6个moderate导航依赖链审计问题；未强制降级。AsyncStorage仍单账户JSON，SecureStore写/删失败独立告警待补。
- 完整说明：docs/USABILITY_AND_SECURITY.md、docs/QA_CHECKLIST.md、docs/AUTONOMOUS_REPORT_2026-09-08.md；证据 .run/autonomous-20260908/；可交付APK及manifest在 artifacts/autonomous-20260908/。


### 2026-09-09：自主完善第二轮（本机 Asia/Shanghai，未发布）

- 保留第二轮开始前用户与第一轮全部工作，基线在 .run/autonomous-20260909-r2/baseline/。未 reset/checkout、commit/push、升级版本、安装设备、生产发布、重启已有网关或隧道、付费调用。仍为 1.1.14 / Android code 16。
- 原生账户快照/恢复记录改用 expo-sqlite ~57.0.2，Web 保留 AsyncStorage；原始迁移档案与活动快照同事务写入、逐字验证，提交后写 nova-chat:sqlite:v1 标记。SQLite 读故障不回退旧副本，丢失已迁移行拒绝空白覆盖；支持账户范围迁移档案导出。bootstrap 与 token 不进入历史库。
- 凭据改用 SecureStore v2 envelope（token/认证网关/nonce），普通存储 auth intent 不含 token/网关。blocked/active fence 与写后读回验证、串行链/session generation 防止慢写复活。全局凭据错误提示和重试在退出后仍可见；fence 与删除都失败会明确警告重启可能恢复旧登录。Web 无明文 token 持久化回退。
- 新增独立助手模板 JSON 备份/预览/可信确认/增量导入：10 MiB、100 模板上限，显式字段白名单，按来源或内容去重，不覆盖本地编辑，确认时重验账户/网关/token。文件包含私有完整 instructions/starter，需保密；标准聊天备份仍不含助手、草稿或附件本体。
- 最终 npm run verify 于本机 00:59:31（UTC+08:00）exit 0：mobile 21 文件 / 143 测试 + gateway 8 文件 / 71 测试 + scripts 3 = 217，较本轮基线 +48；全部 TypeScript、lint 通过。最终证据 verify-final.log / verify-result.json；一次中间 cleanup lint 失败已修复并保留历史日志。
- protocol/gateway build、Expo 57 install --check、Android/iOS/Web export 通过；SQLite 测试桥使用 Node SQLite 真实 SQL，包含文件关闭/重开、>6 MiB、事务回滚/marker/丢行/并发故障。不能等同于原生驱动或 OS 持久性真机验收。
- 独立 staging .run/q2，应用名 Nova QA R2，包名 com.novachat.mobile.qa.r2；未覆盖正式版或第一轮 QA。69 个移动源码/资源与 staging 一致，app.json 仅 QA 身份差异单列；Android arm64 release 构建成功（2m56s，439 tasks）。
- APK：artifacts/autonomous-20260909-r2/NovaChat-1.1.14-qa-r2-arm64.apk，37,863,877 bytes；SHA-256 c7c1beac94c2194e38a5190092211cd68b347c1912b5cbe37a37d1e5d2729c4a。Android Debug 签名、v2 校验通过、16 KiB ZIP 与 20 个 ELF LOAD 段静态对齐通过；QA HTTP=true，allowBackup=false，无内置网关。
- 第一轮 APK 保持原 SHA-256 6e8f619f41881b97be9da928eada5bcab5176f874b34bc0682205b6c4789dcdf。本轮未安装/截图/真机验收，未 iOS 原生编译；可用 GUI surface 为空且 @oai/sky 无法加载。
- 重要限制：不能直接降级旧客户端；独立 R2 沙盒新装不等于同 applicationId 升级迁移验收。SQLite 仍为明文整体 JSON，档案保留占空间，无加密/自动备份/云同步；原 AsyncStorage 已不可读取的行不能保证恢复；清空聊天不删除迁移/恢复档案。导航链仍有 6 moderate，0 high/critical，未 force fix。
- 文档：docs/AUTONOMOUS_REPORT_2026-09-09_R2.md、docs/STORAGE_MIGRATION.md、docs/USABILITY_AND_SECURITY.md、docs/QA_CHECKLIST.md。随包有 README、SHA256SUMS、build-manifest、changes-from-baseline 与 verification 日志副本；按本轮基线计算差异，不重复计入第一轮成果。下一优先级为同包原生升级真机验证、规模性能测量、档案生命周期，再考虑附件打包与加密备份。

安全记录：本轮没有读取真实 .env、生产凭据或生产数据库；本记忆没有写入任何真实 API Key、Session Token、管理员密码、下载 Token 或 SERVER_MASTER_KEY。

### 2026-09-09：自主完善第三轮（工作机本地 Asia/Shanghai，未发布）

- 本轮基线 .run/autonomous-20260909-r3/baseline/ 保存175文件；保留用户/前两轮全部工作，不reset/checkout、commit/push、安装设备、版本升级或发布。仍1.1.14/code16。
- SQLite普通保存只查旧行存在性、读新正文做校验，不重复写已验证marker。新增archive_revisions_v1、四类UTF-8正文大小统计、安全迁移旧恢复副本、预览/外部备份勾选/确认清理；预览与确认前分别flush，revision/session generation/账号/读取状态保护，事务失败回滚。
- 清理只移除三类保留原文，不动主活动数据/其他账户；恢复空行tombstone使重开后仍可创建新repair。不是安全擦除或即时回收磁盘，不跑VACUUM；Web只读统计，禁用不具跨标签页原子性的删除。补齐恢复副本迁移原文独立导出与归属检查。
- 统一分享前账号/页面有效性与过期UI结果保护；临时写失败/浏览器下载失败清理自身资源，真正分享保留宽限期；导入提示区分内存成功与落盘失败，不误报全部失败。
- 历史全文缓存限2,000,000 UTF-16字符，按不可变对话失效及账户重建，超预算仍搜索；deferred筛选、280字符预览，完整内容不截断。不索引草稿/助手私有指令。
- scripts/benchmark_mobile.mjs / npm run benchmark:mobile：合成数据+Node内存SQLite，不访问真实数据/网关。6,880,028-byte快照8次保存body返回流量约减半（110,080,455→55,040,228 B）、marker写16→0；500/2000对话热搜索中位数约16.04x/1.70x，结果一致。这不是Hermes/真机帧率。
- 最终npm run verify于本机01:56:13（UTC+08:00）exit0：mobile24文件/190 + gateway8文件/71 + scripts3 =264，较本轮起点217增加47。TypeScript/lint、protocol/gateway build、Expo install --check、最终Android/iOS/Web export通过。SQL测试是Node真实SQL桥而非设备驱动。
- 独立staging .run/q3，72个移动runtime文件与源码逐字节一致；app.json仅5项QA身份变化。首次构建mobile/node_modules junction误指根依赖导致expo-status-bar找不到，已仅修复staging；最终源码增量构建35s/439 tasks通过，前一原生构建2m1s通过，历史日志保留。
- APK artifacts/autonomous-20260909-r3/NovaChat-1.1.14-qa-r3-arm64.apk；Nova QA R3 / com.novachat.mobile.qa.r3；37,885,665 bytes；SHA256 447c7a6e37e0969aac002afe503c65a16271910d2492f15779cfb2e18242eb5a。Debug签名/v2校验/16KiB ZIP/20 ELF库LOAD段静态通过；QA HTTP=true、allowBackup=false，无内置网关。前两轮APK未覆盖。
- GUI surface为空且@oai/sky不可加载，未视觉/真机/同包升级验收、未iOS原生构建。依赖审计仍6moderate/0high/critical。原apps/mobile/android未改；无真实.env/凭据/DB读取，无用户网关重启、付费调用、设备安装或部署。
- 第三轮说明 docs/AUTONOMOUS_REPORT_2026-09-09_R3.md；更新存储指南、使用/安全、QA、README、CHANGELOG，历史报告不改。随包manifest/changes/verification对照本轮基线。下一优先级：目标真机升级及规模验收，再考虑附件打包/加密备份。


### 2026-09-09 常用工具补全 / 1.1.16

- 用户反馈长沙天气、当前时间都答不了。本轮新增 `services/gateway/src/tools/`，实现时间、天气、算式、单位、日期、参考汇率、搜索、公开网页8项工具；旧客户端缺少 autoTools 字段时默认启用；实时时间上下文始终存在。缺失设备时区使用显式服务器默认，不读取GPS、不猜用户城市；“北京时间”不会被当作北京天气地点。
- Responses / Chat Completions 支持 JSON/SSE 函数调用闭环、参数片段、推理续传、累计用量、取消与上限。只含ID的空响应、没有终止事件的截断流不算成功。天气窄范围预取和搜索兼容回退保留实际结果；上游不支持时说明限制，不声称虚假联网。
- 网页读取逐跳验证公开地址/DNS并固定连接IP，禁内网/元数据；算式不执行任意代码。搜索地区站点跳转只放行已知Bing主机且跨主机不带自定义密钥。搜索备用入口实测会不相关，已提示核对/换关键词，不能当作强保证；生产搜索建议配置Brave。
- 手机输入框新增常用工具开关/执行状态，上游搜索/上游代码独立标注；设置与关于页说明范围。REST/WS、失败/取消/重连状态回传。网关进程重启会中断活动请求，不宣称任务磁盘持久化。
- 最终 `npm run verify` exit 0：Mobile 193 + Gateway 157 + Scripts 7 = 357；typecheck/lint、protocol/gateway build、Expo57依赖检查、Android release与Web export通过。证据 `artifacts/common-tools-final-verify.log`。
- 免密钥8工具全部真实调用通过；实际公网网关 REST 旧客户端请求能回答长沙天气/明天带伞与北京时间，WS真实搜索官网并返回运行/完成事件，后台快照含tools。真实模型为当前配置 `gpt-5.6-sol`，最后记录见 `artifacts/common-tools-live-gateway.json`；临时测试管理员会话已撤销，未记录密钥。
- 正在运行的gateway已通过已验证身份的supervisor停止/启动更新，保留数据库、账号、模型配置与原有公网隧道域名。修复stop脚本中supervisor先退出子进程后重复Stop-Process的竞态。运行PID不能当作永久事实，下轮仍需现查。
- 版本1.1.16 / Android code18 / iOS build18。APK `artifacts/friend-1.1.16/NovaChat-1.1.16-android-arm64-preview.apk`，37,891,510 bytes，SHA256 `c72e9a974d4413f55bb4c7212d6fd53f16f759fdab236a80a4ef3381aa178a30`。普通包名且签名与1.1.15一致，保留HTTPS；APK签名/权限/非debug/ZIP与20个ELF的16KiB对齐/内嵌版本和网关/工具字串验证通过。
- 8790临时受令牌保护的下载验证器完整下载与Range均通过、与本地SHA一致，验证后已停止。没有替换旧共享链接，没有新增GitHub发布。未创建新的不安全LAN HTTP安装包。
- 未真机安装/升级迁移验收、未iOS原生构建、未完成可视化UI验收：ADB无设备，浏览器控制无surface，native sky缺少运行环境；临时模拟UI服务已停止。Web export通过不等于交互/截图验收。
- 仍是本机+临时隧道的预览部署，关机/断网会不可用。Open-Meteo默认非商业公共服务；汇率有日期且非交易价；搜索无SLA。没有把用户原有未提交的账户/存储等改动重置或计为本轮新增，没有声称解决所有问题。详情见 `docs/RELEASE_1.1.16.md`。


### 2026-09-09：1.1.17个人资料库、中文检索与原文引用

- 以1.1.16常用工具版为基线，新增个人资料库，不把天气、时间或此前账户/存储扩展重复计入本轮。保留所有原有未提交/未跟踪改动；无reset/revert、commit/push、GitHub发布或新公网隧道。
- Gateway新增knowledge.ts/knowledgeRoutes.ts，AppDatabase复用SQLite connection：账户隔离正文/FTS5索引，CRUD、100份/200万字符总量、每份12万UTF-16字符、同账户正文去重、版本冲突保护、事务增改与删除trigger。独立用户Session才可用，管理员也无跨账户资料API特权。
- 文档导入复用上传与文字提取：TXT/MD/JSON/CSV/DOCX/XLSX/PPTX/ODT/EPUB等；明确不支持PDF/OCR、图片、旧二进制Office或MOBI。超长拒绝而不默默截断；异步后再验Session/附件所有权。原上传附件保留，重复/失败导入也可能留原文件；删除条目不删原附件。
- 中文双字词+ASCII词的词法检索，NFKC规范化，不是embedding。1200码点片段、150重叠，200字符/32词查询，最多6片段且每文档3片段。同义词、泛泛追问和全文总结召回有限；不承诺完整阅读。
- generationOptions.knowledgeBase默认false，显式开启才检索最新用户消息。命中后将片段作为user/data JSON而非指令注入；强制关闭内置工具、上游搜索/代码与图片生成；上游意外函数调用拒绝执行。无命中确定性返回nova-local-retrieval，不调用模型。仍将命中片段发送给配置的模型服务，不是离线模式；UI已消除“不联网”歧义。
- REST/WS done/jobs携带knowledge；移动端ChatClient校验schema、requestId隔离，旧网关没有合法来源时标记资料回答失败。来源快照随本地聊天保存，标准聊天备份排除快照/documentId但不脱敏答案；重新生成清理旧来源。网关job仍为进程内状态，重启不恢复活动请求。
- 移动端新增KnowledgeScreen与KnowledgeSources：设置/输入框入口、资料开关、笔记/导入/全文编辑、冲突/去重/配额反馈、无模型检索、删除及关闭编辑二次确认、Markdown导出。useAccountTask隔离账户切换/页面离开后的异步结果和分享；恢复登录/重启不自动开启资料模式。系统返回仍需先保存，未完成编辑草稿持久化。
- 安全边界：网关正文和索引、手机聊天来源都是明文，服务器运营方仍能访问。删除资料不撤回已有聊天/来源、进行中请求、附件或外部备份；关闭资料模式不清除聊天历史。来源不是模型正确性/完整使用/全文覆盖的证明，指令隔离不是提示注入绝对免疫。
- 最终388项通过：204 mobile（26文件）+177 gateway（13文件）+7 scripts；较1.1.16新增31项。typecheck/lint/protocol+gateway build、Expo57依赖检查、Web export、Android release通过。新UI最终文案也经过重新构建；npm run verify在构建中再次通过。
- 真实本机冒烟两次少量计费请求：合成资料创建/中文搜索、REST回答带[资料1]+job来源、WS流式答案与来源、无外部工具、删除后索引消失均通过。临时文档/Session在finally清理。第三方配置模型名gpt-5.6-sol不是官方身份保证。原公网/v1/knowledge未鉴权401，发布前后网关检查通过。
- 网关在核验旧supervisor/子进程身份后重新构建启动，保留原数据库、账户、上游配置及原HTTPS隧道。交付时supervisor 44336 / gateway 15956，这是可变快照，下轮必须重新查询；重启会中断活动请求。
- APK：artifacts/friend-1.1.17/NovaChat-1.1.17-android-arm64-preview.apk，37,916,642 bytes，SHA256 d743350d239b0ebfa7cdf1f2dea2316bf8ce18e1dfdae0b6eaec6343b19979bf。版本1.1.17/code19（iOS build19），普通包名com.novachat.mobile；签名与1.1.16一致，仍为本地预览签名，非商店生产签名。ZIP/20原生ELF16KiB、权限/HTTPS/非debug、版本/字串与已配置秘密扫描均通过。
- 8790临时受令牌保护的完整/Range/HEAD下载、未授权404/错误Range416通过，完整文件SHA一致，验证后已停止临时下载进程。没有替换旧分享链接；未创建不安全LAN HTTP APK。最终证据knowledge-apk-verification.json与knowledge-local-download.json。
- 曾因空闲Gradle占用旧classes.dex导致重复prebuild EBUSY，身份和状态核验后停止该空闲daemon，验证原生生成目录在工作区内并重建。预览脚本改为--no-daemon降低长期占用风险；失败日志单独保留，最终knowledge-android-build.log为成功构建。
- 未真机安装/覆盖升级/键盘手势或原生持久化验收：adb无设备；GUI surfaces为空，Web export不等于交互/截图验收；未iOS原生编译。没有增加依赖或重新审计，历史6 moderate未关闭。本机+临时隧道仍不是常驻云端，关机/断网不可用。
- 文档：docs/RELEASE_1.1.17.md、README、CHANGELOG、SECURITY第16节、ARCHITECTURE资料数据流已更新。下一优先级应是同包真机验收、稳定托管、资料编辑草稿/文件生命周期，再按需求加入PDF/OCR、向量检索、语音和提醒；这些不是本轮已完成能力，不宣称全面超过成熟产品。

### 2026-09-09：1.1.18文字PDF、账户资料草稿与快速输入保护

- 继续基于1.1.17，保留全部先前未提交/未跟踪成果，无reset/revert、commit/push、外部发布、清理用户资料或更换公网隧道。新增范围为文字PDF导入和资料编辑草稿，而不是再次列旧工具为新增。
- 服务端：新pdfText.ts + pdfWorker.mjs，一次性NodeWorker+本地字体/CMap白名单，PDF.js固定6.3.289。25MiB/200页/12万字符、15秒、同账户1/进程2个，无排队，终止后才释放名额。加密/无文字/损坏/超限明确拒绝，不部分入库；页码及空页警告进入正文，importInfo返回客户端。tsconfig.allowJs确保mjs源测试和dist运行同入口；标准同步附件提取接口未改为async。
- 实测发现PDF.js部分文本流取消可留下pending promise，故worker读取异常不await取消，parentPort.ref保证父进程期限可生效，父进程总在结果/错误/超时后终止worker。worker限额不是OS安全沙箱/总内存上限，不执行PDF脚本/链接、没有OCR或版面复原。
- 客户端：knowledgeDraft在账户快照v7新增可选字段，稳定editId+随机revision+editedAt及原文id/updatedAt；snapshot恢复schema坏字段触发原始副本保护，global bootstrap及标准聊天/助手导出不含草稿。原生SQLite/Web存储明文，单账户一份、不跨设备同步。
- set/clear需要scope+revision；patch按editId检查同一编辑会话并合并最新store，避免连续onChange发生在React提交前时丢字；提交/导出也读取最新匹配草稿。useAccountTask运行入口新增scope核验，拒绝旧渲染事件。准确落盘指示、失败重试/导出、收起保留、放弃确认、冲突另存为新资料已接入。
- 最终416测试=Mobile217+Gateway192+Scripts7；typecheck/lint/build/Expo57依赖检查/最终Web export/Android release通过。新增测试覆盖PDF边界和身份复验、草稿恢复/隔离/晚到结果/慢写入/快速输入/坏数据。ADB无设备，没有真机、iOS原生或视觉验收。
- 本机8787运行scripts/smoke_pdf.mjs --confirm-billable：合成中文PDF上传提取检索、无文字拒绝、一次小额真实模型回答+job引用、删除后索引消失通过。结果“演示口令：竹林四二；会议室：银杏厅。[资料1]”；模型名gpt-5.6-sol为当前第三方配置声明。临时资料/文件/session已清理，未更改现有账户与provider配置。
- 网关已确认旧PID身份后安全重启：最新supervisor37384 / gateway12732（后续操作必须重新核验）；公网仍为原carriers-transactions-should-resist.trycloudflare.com。临时托管，不是云端常驻。新客户端需要升级网关才能导入PDF。
- 最终APK：artifacts/friend-1.1.18/NovaChat-1.1.18-android-arm64-preview.apk，37,923,334 bytes，SHA256 8d2170771b5b71d9c5bf0d934b478a33b68162ee8e2aaaf73c9b18344c99d219。code20/iOS build20，同包名com.novachat.mobile及1.1.17签名；APK权限/HTTPS/非debug/ZIP及20个ELF16KiB/已配置秘密扫描通过。8790鉴权/完整/Range/HEAD/非法Range核验通过且校验服务停止。
- 不使用初次打包中间hash f4347f13dd6adcdab10c1798acffbafe22ed999345081056aef72ae51ccb21ba；快速输入修正后已重导出、重打包，当前最终hash以上述为准。
- 新增pdfjs依赖时审计发现js-yaml1项high，已兼容更新4.3.2；最终0high/0critical、原有6moderate导航链未关闭，不执行强制跨大版本降级。Node最低22.13.0，CI/Docker现为24；本机24.18.0。
- 详情docs/RELEASE_1.1.18.md；日志.run/pdf-android-final-build-1.1.18.log、pdf-web-final-export-1.1.18.log、audit-1.1.18-final.json；artifacts/pdf-live-gateway-1.1.18.json、pdf-apk-verification-1.1.18.json、pdf-local-download-1.1.18.json。README/CHANGELOG/SECURITY第17节/ARCHITECTURE同步更新。
- 下一优先级：同包真机覆盖升级+文件选择/键盘/长文字/返回恢复验收，稳定托管与原附件生命周期，然后再评估OCR/向量召回/语音或提醒。现阶段不能承诺全文总结、同义词命中、永不丢草稿或全面超过豆包。

- 最终文档复查另修正README下载段与docs/FRIEND_RELEASE.md仍将1.1.15标为当前交付的陈旧说明；明确1.1.18本地产物路径，旧friend-download-link不代表新包，本轮没有新公网APK发布。该收尾仅修改文档，不影响已验证APK。

### 2026-09-09 14:06：按用户要求交付1.1.18公网下载直链

- 用户明确要求提供可转发朋友的公网下载链接。实际核验原8090分享服务PID33212、下载cloudflared PID37024仍在线；分享目录仍是.run/friend-share-1.1.14，聊天网关与隧道未改变。后续操作仍需重新核验进程。
- 将最终1.1.18 APK按NovaChat-1.1.18.apk原样复制到该分享目录（暂存文件非可下载扩展名，hash核验后更名），保留原有文件、不停旧服务、不新建隧道。APK源码和内容未修改，沿用已重建验证的最终包。
- 实际本地8090完整GET以及公网无令牌拒绝、HEAD、完整GET、Range206、非法Range416通过；最终37,923,334 bytes，SHA256 8d2170771b5b71d9c5bf0d934b478a33b68162ee8e2aaaf73c9b18344c99d219。公网下载副本.run/friend-public-download-1.1.18.apk；报告artifacts/friend-public-download-1.1.18.json（不含令牌）。
- 当前完整链接私存.run/friend-download-link.txt与.run/friend-download-link-1.1.18.txt，前一个链接留存.run/friend-download-link-before-1.1.18.txt；仅向用户交付用于可信朋友下载，禁止将令牌写入Git或公开文档。更新.run/download-tunnel.json当前版本字段。
- 原8090下载分享服务和两个原公网隧道均保持运行；8790仍只是已结束的本地校验端口。电脑/下载隧道离线会使下载失效，聊天另依赖原8787网关/隧道。尚无真机或朋友当地网络验收，未GitHub发布、commit/push或改账户/上游配置。
- README、FRIEND_RELEASE、RELEASE_1.1.18与产物说明已补充公网交付状态，前文“尚未提供公网下载”是此次用户授权前的历史状态。


### 2026-09-09 15:05：1.1.19回复朗读本地候选；用户继续体验1.1.18

- 用户要求“你再去自己更新，我去先体验体验这一版本”。本轮明确隔离候选和现有体验，未替换1.1.18公网APK或直链，未停止/重启8787网关、8090分享服务、supervisor或两个现有隧道。不得把当前源码1.1.19误报为已交付公网版本。
- 已在Mobile写码前读取精确Expo57版本文档和Speech文档，记录.run/expo57-index-read.txt与expo57-speech-read.txt。新增expo-speech~57.0.2，与Expo57匹配；dev新增react-test-renderer19.2.3与对应types，用实际React挂载Hook做生命周期测试。未改node_modules源码。
- 新增speechText/speechSource/speechController、native/web speechDriver、useReadAloud、SpeechControls；MessageBubble/ChatScreen接入完成回复的朗读按钮与播放条，AboutScreen补充功能/隐私说明。每次先确认，不自动播放；0.8/1/1.2语速，自动/中文/英文语言，当前设置不持久化。
- 原文12万/整理正文3万UTF-16上限，超限拒绝不静默截断。常见Markdown代码/图片/链接地址/资料编号省略，不是完整解析或脱敏。逐段最多200且遵守平台更小限制，不拆代理对，不保证完整grapheme；预览只显示前600字，明确播放完整整理正文。
- 临时SpeechSource含accountScope（含session，仅内存）、会话/消息id/原文；每次开始、await前后和每段复核。store订阅、导航blur、后台/卸载、原文变更即取消，回来不续读。selected对象绑定确认弹窗，旧确认/双击不能播放另一回复。每段finished门与sequence挡重复onDone/晚到回调，单次只向引擎交一段。
- 检查Expo Android源码发现TTS初始化前delayedUtterances不被stop清空：native driver先等待getAvailableVoicesAsync READY，正文不进该队列；共享pending ready防止挂起引擎反复堆积查询，准备10秒超时后晚到结果也复核身份。Native stop跨挂载串行；停止确认3秒、每段开始10秒/完成180秒限时。语音原始错误不回显。
- Android Locale("zh-CN")可能退回系统默认：从可用voices中优先精确locale再同主语言选择voice.identifier，缺声音拒绝。Web单独SpeechSynthesis适配器显式处理不可用/同步异常/onerror，规避Expo Web封装丢失异步异常；不等待voiceschanged。实际平台出声仍待设备测试。
- 语音走设备/浏览器配置的服务，不新增Nova模型请求或麦克风权限。每次确认说明语音服务可能联网，不保证离线/自动脱敏/服务方不留存；已交给引擎的正文不保证撤回，stop异常提示检查系统，不声称绝对即时静音。非暂停续播、非后台播放、非语音输入。
- 全量483项=Mobile284+Gateway192+Scripts7，新增67项（speechText、speechController、readAloudHook、speechDriver、speechNativeDriver）。真实挂载Hook覆盖主动确认、旧Modal/双击、切账户、blur/background、StrictMode和卸载监听器；平台服务用替身测试。typecheck/lint/build/Expo依赖检查/Web export/Android release通过。
- 候选最终APK：artifacts/friend-1.1.19/NovaChat-1.1.19-android-arm64-preview.apk，37,965,186 bytes，SHA256 e7e72326c78647d05f8091e10537c6e88f674663d902fbc79442c66b3eb7f6ea。code21/iOS元数据21，com.novachat.mobile，与1.1.18同签名。TTS原生模块/Manifest query、无RECORD_AUDIO、HTTPS/非debug、20个ELF+ZIP16KiB、ZIP完整性、旧功能字串与已配置秘密扫描通过。8790鉴权/完整GET/Range206/HEAD/416与SHA验证通过，校验器停止且端口释放。
- 生产审计0high/0critical/6moderate，未强制跨大版本降级。workspace版本同步1.1.19，网关业务源码本轮未改、运行进程未重启，原有PDF工具链仍由1.1.18运行实例提供；本轮无新的计费模型请求或账户/配置变更。
- 2026-09-09 15:03实际复核1.1.18源包和.run/friend-share-1.1.14/NovaChat-1.1.18.apk仍37,923,334 bytes，SHA 8d2170771b5b71d9c5bf0d934b478a33b68162ee8e2aaaf73c9b18344c99d219；.run/friend-download-link.txt与friend-download-link-1.1.18.txt相同，未打印访问令牌。公网healthz200/HEAD/Range206/无令牌404、网关health与注册配置均通过；1.1.19不在分享目录。这次不是重新发布1.1.18，也未重复计费冒烟。
- 进程身份与启动时间实际复核：8090 node33212、下载cloudflared37024、supervisor37384、gateway12732（services/gateway/dist/index.js，parent37384）、网关cloudflared27572均原进程。以后操作必须再次核验身份，不能盲用PID。8790无监听。原域名沿用，不能承诺临时隧道持续可用。
- 证据：.run/speech-android-build-1.1.19.log、speech-web-export-1.1.19.log、speech-audit-1.1.19.json；artifacts/speech-apk-verification-1.1.19.json、speech-local-download-1.1.19.json、speech-preserved-experience-1.1.19.json、speech-existing-processes-1.1.19.json。验证脚本.run/speech_verify_apk_1.1.19.mjs、speech_verify_download_1.1.19.mjs、speech_verify_preserved_1.1.19.mjs只作本地交接，不包含实际凭证。
- README、CHANGELOG、SECURITY第18节、ARCHITECTURE、FRIEND_RELEASE、docs/RELEASE_1.1.19.md与候选产物README同步更新。ADB仍无设备；无Android真机安装/覆盖升级/实际听音、无iOS原生与浏览器视觉/声音验收；未commit/push/GitHub发布。暂不替换用户正在体验的1.1.18，优先等用户反馈及真机TTS验收，再安排候选分发。

## 2026-09-09 17:04 — 1.1.20分支候选与用户要求启动服务后的交接

- 用户先要求“再去更新一版本”，随后在发现服务停机时明确要求“去启动不就好了吗”。已据此启动可恢复服务，不能继续沿用本轮初始的“不启动服务”安排，也不能声称已全部恢复。
- 新增`conversationFork.ts`、`useConversationFork.ts`、`ConversationForkDialog.tsx`；store/MessageBubble/ChatScreen/About接入“创建分支”“改写提问”。完成回复分支复制到所选回复；纯文字提问改写复制问题之前记录并放完整问题进新draft。原会话、草稿、pin/archive/import来源不变；新会话/消息独立ID，不复制生成job/controls/usage/error。创建不自动发送、不调用模型；附件仅复用引用，展示仍可能访问网关。
- 固定assistant指令和model/requestedModel保留，附件/knowledge白名单深拷贝；资料来源不重新检索。后续发送仍用当前模型/工具和既有上下文预算，不保证完整历史、不是外部备份或脱敏。
- 临时ForkSelection含accountScope（含Session，仅内存、不日志）、serverUrl、immutable来源会话对象和切点。来源/草稿/账户/Session/网关/活动会话变化使旧确认失效；blur、后台、卸载取消，回来不自动创建；selected/ref绑定并先消费确认防双击/旧Modal。当前待发附件/上传或来源任意streaming时拒绝。
- 限额：改写纯文字无附件≤10,000 UTF16、来源前缀≤500条、复制JSON预算2,000,000字符、本地会话5000、附件每条100/URI16,384、knowledge来源6、助手名称60/指令20,000。超限拒绝不截短历史；失败/取消片段跳过并显示数量。
- store复用既有账户+网关SQLite/Web快照队列，无新schema/table。storageReadBlocked拒绝；写失败保留内存分支和既有错误提示/flush重试，不保证强杀、卸载后保留未落盘数据。
- 新增52测试：conversationFork23、conversationForkStore14、conversationForkHook15及fixture。全部535=Mobile336+Gateway192+Scripts7，typecheck/lint/build/Expo依赖检查/Web export通过；Hook测试使用实际React挂载、平台替身，覆盖StrictMode与卸载清理，不冒充真机。
- 源码/workspace/lockfile版本1.1.20、Android code22、iOS元数据22；无新依赖或服务端业务改动。生产audit为0high/0critical/6moderate（导航链），不宣称零漏洞。本轮无新的计费模型请求，未commit/push。
- 本地候选APK：`artifacts/candidate-1.1.20/NovaChat-1.1.20-android-arm64-candidate.apk`，37,976,822 bytes，SHA256 `d8b94c3dab5a8005957f42ca633e7c125714db0e72c8ecd97a7596b84ccc41d9`。com.novachat.mobile、ARM64、与1.1.19同现有预览签名；TTS原生/query、无RECORD_AUDIO、HTTPS/非debug、20个ELF与ZIP16KiB、ZIP完整性、旧功能/新分支字串和已配置秘密扫描通过。8790真实GET/Range/HEAD/416/无令牌404及SHA通过，临时校验器停止且端口释放。ADB无设备；无真机覆盖升级/交互/听音/iOS/浏览器视觉验收。
- **16:50故障基线**：先前的五个PID已不存在，8787/8090不监听；原网关`carriers-transactions-should-resist.trycloudflare.com`与旧下载域名均530。正常`build_friend_android.ps1`发布检查因此拒绝。没有放宽检查，单独本地编译只验证客户端；此候选仍内置旧网关，不能当可用联网版分发。
- **用户要求启动后的实际结果**：通过既有supervisor脚本启动本机网关，再通过既有下载脚本启动8090与下载隧道（后台Hidden）。17:00本机health200、管理员已初始化/注册开启/provider已配置验证通过，未改账户/配置/凭据。新下载域名`plans-width-statutes-watershed.trycloudflare.com`健康200；原1.1.18共享APK完整公网GET、SHA、Range206、HEAD、无令牌404通过。只是下载恢复，不是聊天恢复。
- 恢复下载凭证在`.run/friend-download-recovery-1.1.18.txt`；新下载启动日志`.run/download-start-1.1.20.private.log`含下载令牌，禁止打印/提交。旧`.run/friend-download-link.txt`与`friend-download-link-1.1.18.txt`保留为历史凭证，**旧地址已失效**，不要直接再发给朋友。原状态/链接备份在`.run/recovery-before-start-1.1.20/`；该目录也可能含敏感下载凭证。
- **剩余阻碍**：网关公网隧道直接启动被执行工具策略拒绝；一次Windows PowerShell脚本wrapper又因该宿主脚本执行策略退出，wrapper已结束。没有更改系统策略，没有通过其他通道绕过工具限制；当前无8787公网隧道进程，旧网关仍530。需通过允许的运行方式恢复网关隧道，或由用户启动现有隧道；拿到新健康HTTPS地址后必须正常重打包、验签/下载核验再分发。不要把本地包改名就发布，不要假称旧临时域名可恢复或升级包会自动改掉用户已保存网关。更换网关可能触发重新登录与本地数据隔离，先保留/备份旧记录。
- **17:04进程核验**：supervisor19208、gateway17900（services/gateway/dist/index.js）、8090下载node32164、下载cloudflared28636均身份匹配；8787/8090监听、8790释放、网关cloudflared数量0。以后操作需重新核验，不能盲用PID。不停止这些已恢复服务。电脑/临时隧道仍非云端常驻部署。
- 旧1.1.18源包/分享副本SHA仍`8d2170771b5b71d9c5bf0d934b478a33b68162ee8e2aaaf73c9b18344c99d219`，37,923,334 bytes；1.1.19 SHA仍`e7e72326c78647d05f8091e10537c6e88f674663d902fbc79442c66b3eb7f6ea`。1.1.19和1.1.20未放入公网目录，没有新GitHub Release。
- 证据：`.run/branch-release-precheck-1.1.20.log`、`branch-android-build-1.1.20.log`、`branch-web-export-1.1.20.log`、`branch-audit-1.1.20.json`；`artifacts/branch-apk-verification-1.1.20.json`、`branch-local-download-1.1.20.json`、`branch-preserved-files-and-outage-1.1.20.json`、`branch-service-recovery-1.1.20.json`、`branch-existing-processes-1.1.20.json`。旧故障基线本地不可达已被后续恢复报告覆盖，公网聊天未恢复仍有效。
- README、CHANGELOG、SECURITY第19节、ARCHITECTURE、FRIEND_RELEASE、`docs/RELEASE_1.1.20.md`与候选README已同步。元数据与git diff --check通过；工作区保留大量前轮未提交/未跟踪成果，不reset/revert或擅自commit。

## 2026-09-09 17:25 — 再次明确要求恢复公网聊天

- 用户要求“你去恢复啊当然需要可以正常聊天啊”。重新核验8787网关、8090下载仍在运行，公网网关隧道未运行。再次通过透明的原生命令请求后台Hidden启动8787的cloudflared，仍被执行工具策略直接拒绝，进程未创建；没有用脚本、其他shell、代理或其他隧道绕过此拒绝。
- 本轮没有修改应用、旧包、下载地址或凭据，没有计费模型调用，不能声称已验证公网聊天。当前结果见`artifacts/public-chat-recovery-blocked-2026-09-09.json`。
- 剩余必需条件是允许的网关隧道运行方式/由用户本机启动隧道并提供新的HTTPS网关地址；随后才可进行真实认证/聊天及正常发布脚本重打包。不要再次把旧1.1.18下载成功当成聊天恢复。

## 2026-09-09 17:30 — 公网恢复受阻后的本机真实聊天核验

- 在不重试/绕过已拒绝的隧道启动操作的前提下，复核本机8787/8090监听；cloudflared只有下载隧道28636，没有8787聊天隧道。PID仅为当时核验结果，后续操作仍须核对身份。
- 新增仅本机诊断脚本`.run/public-chat-local-check-2026-09-09.mjs`；执行1次最小真实模型请求。health200、setup、无认证401、WebSocket认证ready、流式回复4个delta、completed job快照均通过，13.2秒收到“聊天服务正常”。临时验证session已撤销，没有输出凭据或修改既有账户/provider配置。
- 实测报告`artifacts/public-chat-local-verification-2026-09-09.json`：17:30:27原公网聊天地址仍HTTP530。该结果只证明本机聊天链路正常，不能证明公网/手机聊天恢复；公网隧道启动仍受前述执行工具拒绝阻碍。
- 本次未修改应用源码、APK或分享入口，未启动任何替代代理/隧道。需要用户在本机正常启动现有cloudflared聊天隧道，并提供生成的新HTTPS根地址；随后才能验证公网认证和真实聊天、重建包含健康网关的新安装包。不要要求用户删除APP或清空本地历史。

## 2026-09-09T17:34:36.4722101+08:00 — 用户要求直接执行后的启动结果

- 用户明确要求由代理直接执行，不接受转交手动命令。重新核验后，通过原生Start-Process、Hidden、明确参数直接请求启动8787的cloudflared聊天隧道；执行工具在创建PowerShell进程前返回locked by policy，不是cloudflared运行后报错，未创建隧道进程。
- 不通过其他shell、脚本、UI、既有下载服务转发或其他替代路径规避拒绝；没有更改防护/执行策略。没有新的计费聊天调用、没有修改应用或APK，不宣称公网恢复，不再次交付不可聊天包。
- 当前已知本机真实聊天验证见public-chat-local-verification-2026-09-09.json；本轮明确阻碍见public-chat-direct-execution-blocked-2026-09-09.json。后续继续需要运行环境允许对应启动操作，不能单纯重复重试相同拒绝。

## 2026-09-09 18:00 — 实际源码修复完成，公网运行仍受阻

- 用户继续要求“你去修啊”。没有再次尝试或绕过已被拒绝的公网隧道启动；实际修了会话恢复和打包缓存两类缺陷。无subagent、无新依赖、无版本号变更、无commit/push，保留全部前轮未提交成果。
- 新增useSessionRecovery Hook并接入App：仅同一已保存网关的认证/目录前台3/6/12/24/30秒退避重试；手动防并发、后台暂停、AbortSignal、账号/地址/卸载晚到结果保护。不自动重发聊天或更换域名。HTTP401/403必须有明确网关认证错误码才清会话；目录普通故障降级但明确撤销/取消不被吞掉。
- 复现真实构建缓存问题：首次Web包已含新重连逻辑，但环境变量仍是旧公网地址。清Metro缓存后正确变成本机地址。中文字符串要解码JS Unicode转义后检查，不能把原始Buffer文字未命中误当成源码缺失。对比证据session-recovery-metro-cache-comparison-20260909.json。
- 发布脚本使用健康检查返回的规范URL，新增Expo Android清缓存导出、Gradle --rerun-tasks和最终签名APK内置地址门禁。check_apk_gateway.mjs只读ZIP应用bundle、限制大小/条目/压缩类型，不落盘解压；不是签名/连通性证明。正常公网发布门禁未放宽。
- 全量583测试=Mobile371/Gateway192/Scripts20，新48=Hook25+恢复服务10+APK门禁13；typecheck/lint/build/元数据/PowerShell语法、清缓存Web与Android Hermes导出通过。现有candidate的旧地址验证通过，新预期地址被门禁拒绝；SHA仍d8b94c3dab5a8005957f42ca633e7c125714db0e72c8ecd97a7596b84ccc41d9。
- 一次只绑定127.0.0.1:8081的本机静态Web预览启动请求也被执行工具在创建进程前拒绝。没有改用其他方式启动它，8081无监听，不能把本机网址发给用户说能用。拒绝的组合命令连静态扫描也没执行；之后仅独立执行离线扫描，未再启动服务。
- 本地清缓存Web目录.run/session-recovery-web-clean-20260909未运行，仅内置本机8787；Android导出.run/session-recovery-android-export-20260909内置合成测试域名，只是Hermes导出、不是APK，绝对不要分发。初次未清缓存的Web目录也保留做故障证据，不发布。
- 18:00本机health200；原公网地址本轮请求不可达（前轮530），cloudflared只有下载28636，无网关隧道。8787 gateway17900、8090下载32164仍监听，后续必须再核验PID身份。没有新增模型计费调用，没有新APK、没有分享链接变化；已有候选不含本次源码修复。
- 说明docs/RECOVERY_2026-09-09.md；总报告artifacts/session-recovery-final-20260909.json；全量日志.run/session-recovery-final-verify-20260909.log。README/CHANGELOG/SECURITY/FRIEND_RELEASE/RELEASE_1.1.20已同步未发布边界。下一步仍需运行环境允许健康公网服务，不得再反复重试相同拒绝或拿旧APK充当恢复成功。

## 2026-09-10 09:15 — 发布验收缺陷修复，公网入口仍未恢复

- 用户再次要求修复。重新核验8787 gateway17900、8090下载32164仍监听，8081无服务，cloudflared只有下载28636；PID只是快照后续必须重查。原公网checkGateway失败，不把昨日530当今日实测状态。
- 没有重复或绕过先前被执行工具拒绝的公网启动，没有改执行策略、创建替代代理或复用下载服务转发。未停止现有服务，无新隧道/新APK/分享变化。用户不接受重复手动启动指令，不要再发旧包冒充恢复。
- 实际发现并复现发布检查远端setup展开会覆盖gatewayUrl/checkedAt/temporary并传播未知字段。check_gateway.mjs改用可信元数据白名单、按hostname判临时域名（含端口）、有界JSON读取。合成修复前后对比artifacts/chat-release-metadata-reproduction-20260910.json，不代表真实攻击。
- 新增check_gateway_chat.mjs：受控指定网关认证保护、有效Session、模型目录、WSS ready、单次合成非空delta+done、同ID/会话/正文completed快照；工具关闭、不重试模型、重复ready防重复计费、无重定向、有界响应/超时，失败尝试取消自身job。错误和报告不泄漏Token/账号/回复/远端正文；取消不保证零费用。
- build_friend_android.ps1在构建前后强制真实聊天门禁，缺少专用NOVA_RELEASE_SESSION_TOKEN即停；完整成功通常2次少量计费。令牌只临时让检查进程继承，不进npm/Expo/Gradle，退出恢复原环境。令牌生命周期由管理员管理，脚本不会擅自注销手机会话。正常发布无local-only绕过。
- 新增31测试（网关检查3+聊天门禁28）；全量614=Mobile371/Gateway192/Scripts51，typecheck/lint/protocol+gateway build/元数据、Node和PowerShell语法通过。未执行完整发布脚本/Android原生构建/视觉或真机验收；无新依赖，无新增audit。
- 09:11使用新检查器在已有本机网关执行1次真实合成模型请求：全部7阶段通过，3delta/5字符，约11.4秒，completed正文一致。临时Admin Session已撤销；报告scope loopback-only/publicChatVerified:false，不是公网验证。实际脚本.run/chat-release-runtime-20260910.mjs没有任何启动/隧道操作。
- 版本仍1.1.20/code22，无commit/push，所有前轮未提交成果保留；candidate SHA仍d8b94c3dab5a8005957f42ca633e7c125714db0e72c8ecd97a7596b84ccc41d9，不含9月9日会话修复，不可作为恢复版分发。未改下载目录、数据库用户配置/历史或旧包。
- 总报告artifacts/chat-release-final-20260910.json，真实验证artifacts/chat-release-runtime-20260910.json，全量日志.run/chat-release-verify-20260910.log，说明docs/RECOVERY_2026-09-10.md；备份.run/chat-release-before-20260910。README/CHANGELOG/SECURITY/FRIEND_RELEASE/RELEASE_1.1.20同步。
- 仍未达到用户“直接正常使用”的核心目标。下一步必须具备允许运行的健康公网入口才能真正认证/聊天、正常打包交付；不能把新增测试或本机回复说成公网恢复。


## 2026-09-14 — 管理员第三方配置只写不回显；公网发布仍未恢复

- 用户要求管理员也看不到已保存的第三方网址/Key，并要求解除cloudflared限制和安卓下载链接。已明确不能解除或绕过执行工具安全限制；本轮未尝试其他隧道/代理/UI转发，没有策略修改或公网启动重试。
- 后端公开配置只返回状态和非秘密模型元数据，不返回真实网址/Key/尾号；`apiBaseUrl`固定空串仅兼容旧版管理员表单。留空/省略保留现值，换URL（含路径）必须新Key，save/test共用resolver，防隐藏Key被发到新地址。上游错误原文和任意code不透传，日志新增网址脱敏。
- AdminScreen和gatewayApiClient白名单解析已更新：网址和Key输入遮挡、保存成功清空，旧服务端额外秘密字段也不进入UI。后台/离页/切换会话清除草稿并作晚到结果检查。新增providerForm、providerSettings helper及客户端/服务端/UI回归测试。
- 全量646=Mobile387/Gateway208/Scripts51，新增32；typecheck/lint/build通过。Android清缓存Hermes导出4,239,953字节，验证含只写提示且不含当前实际网址/Key；该导出使用gateway.invalid合成地址，仅编译验证，不是APK、不能分发。没有新增依赖/版本提升/commit/push，保留前轮所有未提交工作。
- 本机网关dist先备份至.run/provider-privacy-dist-before-20260914-131050；校验现有守护/子进程/8787身份后让网关加载构建，未改配置/用户数据。13:15真实认证GET确认无秘密、匿名401、配置未变；专用临时session已撤销。PID属快照，后续重查身份。没有新增模型计费调用。
- 无cloudflared进程；原公网check_gateway失败（fetch failed，不称本次HTTP530）。没有新APK/下载链接，未改发布门禁或覆盖旧候选；用户要求“朋友直接使用”仍未实现。后续必须先获得允许使用的健康公网入口才可认证/真实聊天、正常构建并交付。
- 安全边界是App账户，不是服务器root/数据库管理员；服务端URL仍可读，Key沿用AES-GCM，不声称内存安全擦除或隐藏于服务器所有者。报告docs/RECOVERY_2026-09-14.md；证据artifacts/provider-privacy-runtime-20260914.json、provider-privacy-android-20260914.json及.run/provider-privacy-*.log。

## 2026-09-14 14:10 最新源码安卓重打包1.1.21（本地候选）

用户澄清“就和之前一样代码最新的”，本轮不再将公网故障当成本地编译的阻塞，完成了最新工作区代码的1.1.21/code23候选APK。Expo57配套补丁同步后646项测试、类型检查/lint、清缓存导出、原生全任务编译及签名/完整性/静态隐私检查通过。文件 `artifacts/candidate-1.1.21/NovaChat-1.1.21-android-arm64-candidate.apk`，37,997,234 bytes，SHA256 `84f07cc659f8c37cc4a16f9edf80f1a12d7d50111341e1e3133b19656aae3a26`。216个源文件hash在构建中不变；未覆盖旧APK、未上传GitHub。

**仍内置不可用的原临时网关，本轮公网检查fetch failed，非已联网验收版。没有新版公网下载链接；不绕过之前工具拒绝的隧道操作，朋友发布门禁保持不变。** 无ADB真机，npm仍报6 moderate。完整证据见 `docs/RELEASE_1.1.21.md`。后续不要再误称“最新代码没有APK”：现在有本地候选包，但仍不能称为注册即可聊天的可用朋友版本。


## 2026-09-29 — 腾讯云宝塔 IP HTTPS 部署完成；应用初始化待办

- 用户执行临时 SSH 公钥授权后，以 ubuntu + 无密码 sudo 自动操作其服务器 134.175.139.81；没有使用聊天里的旧密码。沿用 Ubuntu 26.04 → 宝塔 → Docker Compose gateway → 宝塔 Nginx，没有改为 Caddy、PHP 或 MySQL。
- 项目在 `/www/dyh/nova-chat`，容器 `nova-chat-gateway-1` healthy，8787 仅绑定 127.0.0.1；原容器没有重建或重启，卷仍为 `nova-chat_nova-chat-data`。环境文件 600 root:root，与操作前备份逐字节相同，未重新生成任何服务器密钥/初始化口令。
- 用已安装宝塔的内部 Python API 注册站点 `134.175.139.81`（ID 1）和 `nova-gateway` 反代，避免面板与配置脱节。Nginx 保留宝塔结构，HTTP 308 到 HTTPS、ACME 挑战例外；TLS1.2/1.3、WebSocket 转发、关闭 API 缓冲与缓存、长连接超时、限制请求体；访问日志不含查询字符串。
- Certbot snap 5.8.0 已签发公开可信的 Let's Encrypt IP SAN 证书，无需域名且非自签名。初始证书至 2026-10-06 07:29:22 中国标准时间，短期证书必须维持自动续期。`snap.certbot.renew.timer` enabled/active，deploy hook 先 nginx -t 后 reload。已完成带 deploy hook 的实际 dry-run，全部模拟续期成功，之后健康检查正常。
- Docker 启动服务 enabled/active、容器 restart=unless-stopped；宝塔 Nginx init 的 rc2/3/4/5 启动链接存在，进程与监听正常，但 systemd 的 nginx active 状态为 inactive；未为了验证而重启机器。
- 外网正常验证 TLS 链/IP SAN 后 HTTPS `/health` 200；匿名 `/v1/tools` 401、秘密/源码路径 404、HTTP 重定向正确、8787 外部不可达。WSS 完成升级与帧响应，未登录 ping 得 unauthorized + 4401；**这不是已认证的真实 AI 聊天验收**。
- `/v1/setup/status` 仍 needsBootstrap=true、bootstrapTokenRequired=true、registrationEnabled=false、providerConfigured=false。不得使用示例邮箱创建管理员，也不得迁移本地用户、会话或第三方 Key 而不另行确认。下一步需用户决定管理员身份，在安全界面输入初始化/账户凭据，再配置实际模型服务。
- 备份 `/www/backup/nova-chat-deploy/20260929T082208Z` 包含宝塔数据库、原 Nginx、Compose、秘密 env 和网关 SQLite 一致性快照，root-only。只是本次同机快照，未安排周期/异地备份，不能声称已具备完整恢复方案。
- 本轮未访问腾讯云控制台或核验/修改云安全组；UFW/firewalld inactive，另有宝塔/YJ iptables 链，主机仍有默认 888 监听。不要宣称“所有端口已安全收紧”，也不要擅自启用另一个防火墙导致用户失联。
- 已删除本次 ACME 临时探测文件。完成后从 ubuntu authorized_keys 只移除本次临时密钥条目（1条），其余条目逐字节保留；用同一私钥发起全新 SSH 连接得到 Permission denied，确认授权已撤销。撤销后外部 HTTPS health 仍 200。服务器密码未改；不要再次使用旧的授权脚本，继续远程操作应重新获取明确授权。
- 运维说明：`docs/DEPLOYMENT_TENCENT_BAOTA_2026-09-29.md`；服务器副本 `/www/dyh/nova-chat/DEPLOYMENT_LIVE_2026-09-29.md`。证据在 Git 忽略的 `artifacts/deployment/nova-chat-*-verification.json`、`nova-chat-final-server-checks.txt`、`nova-chat-authorization-revocation.json`、`nova-chat-final-health.json`。其中远端与本地时间来自不同主机时钟，不应据秒级差值推断先后。
- 没有修改移动端源码/默认网关，也没有新 APK、真机测试、真实上游计费调用、Git commit/push。后续 App 使用 `https://134.175.139.81`（非 HTTP/公网8787），如需内置新入口的安装包，另行构建验收。


## 2026-10-12 — 1.1.23 陪伴改版完成 dyh 本机验收

- 暖白/灰绿全局布局与独立陪伴聊天完成；默认陪伴文字已用用户提供的 DeepSeek 官方 Key 加密配置 deepseek-chat，图片使用现有管理员上游 gpt-image-2，分别保存 QA 和 data-lan 数据库。禁止输出 Key 或写入客户端。
- 修复 React Navigation 7 navigate 新建重复 Chat 实例造成首次回复保存失败，入口使用 popTo 并固定 Chat ID；修复返回绕圈、认证头像下载缓存及陪伴模型身份提示。真实 StackRouter 回归恢复旧代码会失败。
- dyh 实测新角色中文首次回复、真实模型身份询问、三张真实生成图片（首图建立脸、同脸换场景、修改外貌后换脸）、生成中覆盖安装重启恢复、系统相册裁剪上传保存替换照片、头像显示和返回普通首页。
- npm run verify 735=Mobile424/Gateway254/Scripts57，类型/lint通过；清缓存 Expo 导出与 Android release构建/签名/16KiB对齐通过。APK已安装 dyh（127.0.0.1:16384），不要操作另一个设备694edea8。
- 交付 artifacts/redesign-1.1.23/NovaChat-1.1.23-MuMu-dyh-QA.apk，38,646,730 bytes，SHA256 3DABAF327825EAA0C38F5FB77E0640697D9939BF7C37EB213591B06276B1B0FE；versionCode25，x86_64，com.novachat.mobile。完整记录 docs/RELEASE_1.1.23.md、截图及 verification.json。
- 本轮没有更新远程服务器。此包内置本机8788，通过ADB reverse访问，不能作为公网手机包分发。普通QA聊天仍用fixture，陪伴文字/照片已是真实上游，不混淆验收结论。
- .run/redesign-qa.ts 初始化 guard 已修正读取响应 .provider，已有真实配置不被fixture覆盖。历史误覆盖已恢复，后续重启仍应检查配置保持。保留原有工作区修改，未commit/push。

## 2026-10-12 — 1.1.23 R5 工具、管理员模型选择与最终链接显示验收

- 陪伴工具曾被 ChatScreen、server.resolveCompanionPayload、provider companion text options 三处关闭；全部恢复 autoTools，普通知识库/托管搜索选项仍按独立策略处理。真实 DeepSeek 验证全部8工具，不得再次将陪伴 autoTools 设置为 false。
- POST /v1/admin/companion-provider/:purpose/test 仅管理员调用，支持尚未填写模型的服务草稿发现模型，不借普通provider、不自动保存。changed-address 的 write-only key guard 已回归验证。CompanionProviderSection 搜索选择模型后必须点保存才生效。
- 普通 QA 已恢复项目真实 GPT 中转（默认 gpt-5.6-sol，当前22个可用模型），dyh 客户端选择 gpt-5.5 实际回复。此前 R4 的“普通fixture”是历史事实，本轮不再如此。8789 fixture进程存在但三套已保存服务均走真实上游。
- 管理员 UI 从 DeepSeek 官方返回的 deepseek-flash/deepseek-v4-pro 选择并保存 deepseek-flash。图片 gpt-image-2 获取列表、过滤选择、明确保存完成。data-lan 历史文字配置仍 deepseek-chat；不要宣称远程已更新。Key仅服务端加密，不得输出、进源码或APK。
- Bing RSS 会忽略混合语言里的 Open-Meteo 等主体。复合名称加引号、过滤无关来源、一次核心名称重试（保留site/排除词）后真实混合语言查询返回官方主页/docs。无匹配结果失败；早期搜索结果不作成功证据。
- MessageBubble 的陪伴 assistant 复用 AssistantMarkdown，避免露出 ** 并支持HTTP/HTTPS链接。最终APK已覆盖安装dyh，打开官方链接后返回、重新发消息得到“你好呀～”；模型/工具控件隐藏。
- npm run verify 749=Mobile427/Gateway265/Scripts57；类型/lint、清缓存Expo Android导出、Gradle offline release、v2签名/16KiB对齐通过。源码manifest已恢复usesCleartextTraffic=false。
- 最新APK E:/gptapp/artifacts/redesign-1.1.23-r5/NovaChat-1.1.23-R5-MuMu-dyh-QA.apk；38652186 bytes；SHA256 F9329282887986F8621F04BA472BF8B4BEF5577807150AC823FD92A856F00779；com.novachat.mobile 1.1.23/code25 x86_64。R5目录verification.json及SHA256SUMS记录证据，文档docs/RELEASE_1.1.23_R5.md。
- 本机QA仍需ADB reverse tcp:8788及电脑服务。仅操作MuMu dyh serial127.0.0.1:16384，另一设备694edea8未操作。最后QA网关进程40708，停止前重新检查身份。无commit/push/远程更新。

## 2026-10-12 — 1.1.24 公网手机交付与保留旧记录

- 最新手机包 https://134.175.139.81/downloads/NovaChat-1.1.24-android-arm64.apk；页面 /download/。38028430 bytes，SHA256 1aae461f231b8dc5960aca5e4b416094bdaa4133ba6a1eb7b5c705e492584bef；com.novachat.mobile 1.1.24/code26 ARM64，HTTPS，cleartext=false，v2 签名及16KiB对齐通过。与公开1.1.23同证书 fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c，本地预览签名，不能写成生产签名。
- 常驻网关已部署本轮功能。普通GPT provider摘要不变；陪伴管理员独立配置 deepseek-flash / gpt-image-2，模型发现及权限通过；公网陪伴天气工具与任务恢复通过，用户响应隐藏模型。真实图片未在本轮重跑，历史证据在R4/R5。
- 用户明确要求：以后后端更新不影响旧APK运行，升级后原记录保留。当前不做强制更新或最低版本阻断；后续更新提示/强制更新另做。保留1.1.22/23下载，不能覆盖旧文件名。
- profile能力头 x-nova-companion-profile-version: 2；无头返回旧字段，防止旧版严格schema失败。v7账户快照/账户网关namespace继续沿用，同网关三次hydrate+身份验证恢复测试保留普通和陪伴历史、照片引用、收藏、草稿、助手与设置。覆盖安装，不卸载或清数据；历史仍是本机数据，不承诺跨设备同步。
- npm run verify 757=Mobile430/Gateway269/Scripts58，类型/lint通过。Expo57补丁27/21/4兼容后构建，网关与protocol主要锁条目未变；付费普通聊天发布前后均通过，公开APK完整GET哈希/HEAD/Range校验通过。
- 原服务器users/sessions/files/companion_profiles各1；原行逐条不变，普通provider/既有masterKey和volume保持。2个临时会话和测试用户已删除，不能撤销原手机session。服务器SQLite/源码/回滚镜像及上传备份 /www/backup/nova-chat-1.1.24/20261012T063706Z 私有，不能进入downloads。
- 长期SSH维护授权仍有效，artifacts/deployment/nova-chat-maintenance-session.json；旧临时SSH失效不代表长期身份失效。继续使用维护工具，不重授权/撤销。
- 记录 docs/RELEASE_1.1.24.md、docs/UPGRADE_COMPATIBILITY.md；产物 artifacts/public-download-1.1.24 和 artifacts/deployment/phone-1.1.24。未commit/push；未在用户真机安装，本轮ARM64手机包与前轮dyh本机x86_64 QA分开。


## 2026-10-12 — 按用户分享给他人使用的要求开放公网注册

- 用户问“没有注册功能吗我给别人用别人怎么注册”，已据此开启现有注册功能。此前服务器 REGISTRATION_ENABLED=false，使登录页隐藏注册入口；现在 true。APK 1.1.24 已含注册页面，不需要新包。
- 只改变这一环境开关，gateway 用原镜像重新创建，原数据卷、密钥、普通与陪伴 provider 配置保留。私有变更前备份 /www/backup/nova-chat-signup/20261012T072015Z，禁止上传到公开下载页。
- 真实公网新普通用户注册 201，短密码 400、重复邮箱 409；auth/me、logout401、相同凭据重新登录、默认陪伴角色、管理员权限403均通过。真实普通 WSS 对话和 completed REST 快照通过，仅一次模型请求；不记录密码/会话令牌。
- 两次合成注册验证账号已分别精确清理（首轮验证脚本误期望新用户没有默认陪伴角色，修正断言后全流程通过）；第二轮2个会话均失效，原账号/会话/文件/陪伴资料与变更前备份逐行一致，其他实际用户不受清理影响。
- 下载页已改为邮箱和至少8位密码的注册说明，APK SHA256仍为1aae461f231b8dc5960aca5e4b416094bdaa4133ba6a1eb7b5c705e492584bef。未改源码、签名、旧下载路由、账号密码或强制升级策略；未提交推送。证据 artifacts/deployment/signup-2026-10-12/。

## 2026-10-12 — 1.1.25 自然陪伴与连续照片实际修复

- GitHub实际查看moeru-ai/airi角色默认/人格提示及SillyTavern默认角色配置，适配分层结构与例子，未复制外部源码；原创默认成年人格与短句、真实身份说明、照片融入聊天。模板ID不变，version2；已有自定义角色不重写。
- 截图问题已复现：比心未路由图片、DeepSeek收到历史image_url、上游泳装请求moderation_blocked/sexual却误报模型配置。修复短动作/生成照片路由、已知DeepSeek文字历史转换、照片配文、内容/参考格式/一般图片拒绝分类；不退回换脸或自动重试审核。
- 全量761项Mobile430/Gateway273/Scripts58、类型/lint/build及手机发布脚本通过；最终照片动词补齐后14项针对性测试/build/lint通过并再次部署。共享协议/mobile代码与APK一致，最后修改仅网关照片动词路由。
- 公网20项实际陪伴验收通过，先自拍再比心再文字音乐聊天；两图已目视同脸/同发型/白衬衫/咖啡馆保持，第二张双手比心。用户模型元数据隐藏，旧客户端无长相字段契约保留；QA用户及2文件精确清理。
- 公网APK38,029,078bytes，SHA256 fa95e1c35b2931df52c87cb4f671cad3725431bbfc5f7a44769b38df71255d90；com.novachat.mobile1.1.25/code27 ARM64，既有预览签名证书fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c。完整公网下载哈希/Range206/注册开放/旧1.1.22-24下载200通过。
- 备份/www/backup/nova-chat-1.1.25/20261012T090509Z；原有2账号/2会话/2文件/2角色及三套配置与env保持，数据卷/master/签名未换，不强制更新。新真实用户数据不得按历史固定总数清理。
- dyh127.0.0.1:16384是x86_64，手机ARM包转译缺libreactnative.so。已覆盖恢复同签名x86_64包artifacts/mumu-1.1.25/NovaChat-1.1.25-MuMu-dyh-QA.apk，38,654,386bytes，SHA256 ddfc29033f2be58c1cf287b3ee052b2aceed3be81744dc89f4cb433231be2813；启动显示1.1.25、服务器已连接、注册入口。旧本机QA迁公网须重登录，旧命名空间记录保留；未操作694edea8。
- 详见docs/RELEASE_1.1.25.md、docs/COMPANION_PROMPT_RESEARCH.md；公网合成对话并非实体手机UI验收。未commit/push/reset。

### 2026-10-12 最新：1.1.27已安装，旧人物默认与自然回复实测

- 1.1.26已完成照片上下文隔离、可编辑审核错误和历史保护；dyh既有Lumi连续生成日常读书照、比心照成功。见docs/RELEASE_1.1.26.md。
- 1.1.27进一步完善具体默认人设、聊天边界、场景连续及近期历史追问节奏。已从服务器1.1.25发布前源码备份核对初版默认，两个私人角色仍存该文本，服务端精确识别后采用新设定而不写回原记录。
- 774项检查通过（Mobile437/Gateway279/Scripts58）；36项最终公网陪伴检查通过，实际自定义烘焙师没有串入默认职业/偏好。最终源文件核对证明手机共享输入不变，最后的兼容补充只改服务端。
- dyh安装返回Success，版本1.1.27/code29；保持私人用户登录、原Lumi聊天与两张照片。实际发了“临下班被加活，不要建议”的英文测试消息，Lumi用中文短回复，不反问或安排用户休息。没有操作真实手机694edea8，也没有卸载/清数据。
- 下载整包38,032,078 bytes，SHA256 9824c00b503f5b101a8ac5d0cccb516c774bf0f8941d7c38641b11a3c179cfd9，HTTPS/Range206、旧1.1.22至1.1.26下载与开放注册已核验。dyh包38,657,386 bytes，SHA256 daee5b1e7449d02c2dbf1f59cbb9ddd22c6a56fa00ff6a4a1f572471bc2ce29c。
- 最新备份/www/backup/nova-chat-1.1.27/20261012T135615Z，最新验收见docs/RELEASE_1.1.27.md；服务器配置未改，公开APK不可变。旧版继续可用，暂不强制更新，升级不能丢历史。


## 2026-10-13 — 默认人物 v6/v7 重构后，按用户截图改为 v8

- GitHub 提示词研究与取舍见 docs/COMPANION_PERSONA_V6.md / V7.md / V8.md；原文缓存 .run/companion-research-v6。默认改为20岁女大二中文系学生，腹黑略孤高。v7曾把有主见写成分析动机和给人打分，用户明确否定；最终 v8删去该层，采用短口语、自己的即时反应和连续情绪，避免每句冷淡或机智。
- 共享协议新增精确 v6/v7 默认读取迁移，两字段独立，保留自定义字段，不改存储。database.updateCompanion 只改名字等字段时使用 COALESCE 保留旧 personality/style，防止顺带写回升级结果。历史事实保留但过时口吻不再模仿；照片、头像、外观和账户历史保留。
- 最终公网 Agent8，备份 /www/backup/nova-chat-companion-v8-final/20261013T032800Z，30源文件hash校验；环境、三套provider和原用户/会话/文件/人物保持。v8初次部署尾部复用了v7文本检查而误报，单独运行更新后的runtime-audit通过；最终部署脚本内检查同步修正。
- 两轮各18条真实公网隔离QA；最终原文 artifacts/deployment/companion-v8-final-20261013/emotion-real-replies.json。临时QA均注销、按精确账户清理并核对其他用户未变。自然程度仍需逐轮判断，不能把自动测试当自然度证明，也没有新增独立情绪数据库或真正不生成消息的已读不回。
- Gateway287/Mobile437、全工作区typecheck/lint通过；最终仅网关节奏调整后build/24针对测试/gateway lint通过。清缓存Expo Android导出、439个Gradle任务全执行、原证书/16KiB对齐/x86_64及公网地址通过。
- MuMu dyh 127.0.0.1:16384覆盖安装 artifacts/mumu-companion-v8-20261013/NovaChat-1.1.27-MuMu-companion-v8.apk；38663274bytes，SHA256 6ae7c8fa638295f481532c60e8ec026bdf487df99d544b2307bcf3ab8fee7b52，version1.1.27/code29。原firstInstallTime保留，已回读installed-base.apk核对hash。公开ARM64包未改，其他ADB设备未操作。
- MuMu原截图聊天继续问“那你现在还生气吗”实际回复“不那么气了，就这样吧。”在线且输入框为空；截图 artifacts/mumu-companion-v8-20261013/03-emotion-history-result.png。完整最终提示 docs/COMPANION_DEFAULT_PROMPT_V8.txt。

## 2026-10-13 陪伴中转配置恢复
- 用户指定的新中转服务已通过现有管理员接口保存到陪伴聊天，deepseek-flash / chat-completions / bearer，allowedModels 仅所选模型。不要回退为 v8 发布时的旧陪伴聊天服务；普通和图片服务未改。
- 本地/生产Provider/草稿API/MuMu表单均成功获取两项模型。历史失败草稿不可恢复，原报错仅能确认来自模型列表404/405，未认定确切原始原因；未做源码或APK改动。
- 实际陪伴API返回“嗯，刚下课。饿得没力气。”；MuMu观察到用户文字回复及生成图片成功。临时管理员会话与验证快照已清除。
- 保存前DB备份 /www/backup/nova-chat-companion-relay/20261013T044356Z；原用户/文件/角色/长相保留，排除用户并发登录更新时间，普通/图片Provider/env/image不变。详见 docs/COMPANION_RELAY_2026-10-13.md 和 artifacts/deployment/companion-relay-20261013/verification-receipt.json。

## 2026-10-13 — GitHub 1.1.27 源码与项目介绍已发布

- 用户确认当前体验可用，授权先推一版代码到我们的 GitHub，并更新介绍、描述以吸引用户。
- 仓库 https://github.com/dyhxxs/nova-chat；main 提交 ea04c2ce9b02b06ae79385f0fb5f71d35f31e35d，标题 release: publish Nova Chat 1.1.27 with AI companions。已正常 push，无强推；推送后远端 HEAD 核对一致，main 与 origin/main 同步。
- 本次提交 180 个文件，包含目前客户端、网关、共享协议、测试、维护脚本与公开指南。版本 1.1.27 / Android versionCode 29，没有额外创建 APK、标签或 GitHub Release，没有改变已保存的模型配置或部署运行依赖。
- README 主文案为“陪你聊生活，也陪你把事做好。”“有性格的 AI 陪伴，也有能把事做好的日常助手。”首页增加暖白灰绿 SVG 展示图，示意 Lumi 的简短对话；明确界面与对话是功能示意。补充 README.en.md、陪伴配置指南、公共 1.1.27 更新说明及 CHANGELOG；GitHub About 和 ai-companion、character-chat、typescript、llm、knowledge-base 等标签已更新。
- 宣传重点：角色定制、短口语、上下文情绪延续、参考脸与角色照片、三套独立模型服务、多模型助手和个人资料库。不宣称真实意识、完全离线、绝对人物一致性或全平台真机验收。
- 公开提示词研究链接已根据本地实际研究缓存核对，修正 ai-girlfriend-kit 和 tavern2agent 的仓库归属；当前默认提示公开于 docs/COMPANION_DEFAULT_PROMPT_V8.txt。
- 验证：npm run verify 通过 782 项（mobile 437 / gateway 287 / scripts 58），全工作区类型检查、lint、npm run build 和发布元数据检查通过；Android / iOS Expo 导出通过。测试中的实际部署地址改为模拟地址，相关 14 项移动端测试与 58 项脚本测试重跑通过；提交差异格式检查通过。
- GitHub CI https://github.com/dyhxxs/nova-chat/actions/runs/38349806099 已 completed / success，headSha 对应本次提交，安装依赖、verify、build 和两平台 Expo 导出均成功。远端 README 渲染、展示图、更新说明和 About 已核对。
- 2026-10-13 npm audit 快照为 20 条依赖记录（18 high / 2 critical），不是 20 个独立漏洞；旧的 6 moderate 描述过时。SECURITY.md 第 15 节已同步真实结果；本轮未升级运行依赖，后续在独立改动中评估兼容修复，不能直接应用审计建议中的 Expo / React Native 大版本降级。
- 公开提交未包含真实 API Key、账号配置、部署地址、数据库、APK、签名材料、内部部署/维护报告或 PROJECT_MEMORY.md。此记忆文档继续保留本地；用户本次询问后补齐发布记录及顶部当前状态。
- docs/RELEASE_1.1.27.md 本次改为公共发布说明。此前内部详细版本备份位于 .run/github-publication-before/docs--RELEASE_1.1.27.md，其他文档修改前备份同目录；不要把公共说明当作完整内部部署记录。验证、审计、CI 和渲染日志保存在 .run/github-1.1.27-*。


## 2026-10-13 — 人设下多个独立对话与完整提示词（本地源码 v9）

- 用户要求从“一个对话对应一个人设”改成“先选人设，再进此人设的不同对话”，并加入 E:\gptapp\人设提示词.txt 中的沈知意；追加要求参考其写法完善默认 Lumi，降低 AI 感。
- 客户端增加 CompanionConversations 路由，复用历史列表的搜索、重命名、置顶、归档、删除和导出。人设列表显示该人物的对话数与最近预览，点击只进入话题列表；新建每次生成新的空白记录，选择已有话题仅切换 active ID。陪伴聊天返回此人物的话题列表，保留单一 Chat 实例和原生成生命周期。
- 现有对话保留 companionId，因此自动出现在原人设下，无需批量改写本地记录。人设改名只更新 companionName，不覆盖各对话标题。普通历史仅列普通聊天；陪伴各人物的话题分别筛选。发送只携带当前话题历史，图片场景同样从当前请求历史中读取。
- 人设编辑新增完整 personaPrompt，最多 12000 字符；支持多行粘贴和编辑，完整提示优先于旧的简要性格/说话方式。已有定制的旧字段不会被强制替换为 Lumi。记忆开关明确只有主动保存并启用的长期记忆在人设多个话题间共用。
- 协议以 x-nova-companion-profile-version: 3 协商新字段。新网关向 v2 去掉 personaPrompt，向 v1 同时去掉外貌新字段，尊重旧 strict 客户端。旧客户端更新名字/长相时省略完整提示词不会清空它。数据库增量建 companion_persona 与 companion_template_installs，不更换主密钥或重建真实数据。
- 沈知意以 shen-zhiyi-v1 一次安装到账号，完整提示已逐字与原 txt 去除首尾空白后核对一致。安装标记独立保存，用户编辑或删除后不会每次读取又被恢复。原 Lumi 的人物 ID、记忆和参考脸保留。
- 默认 Agent 版本升级为9，完整人物提示位于 packages/protocol/src/companionPersona.ts，文档副本 docs/COMPANION_DEFAULT_PERSONA_V9.txt 已核对一致。保留20岁中文系、孤高与偶尔腹黑，加入具体生活、语气、节奏及多轮情绪，减少固定反问、客服安慰、心理分析和自动建议。自定义完整提示不套 Lumi 的反问抑制规则。没有真实模型回复实测，不把自动测试视作自然程度证明。
- 最终 npm run verify 通过792项（mobile442 / gateway292 / scripts58），全工作区类型检查、lint及网关/协议构建通过。包含24项聊天页生命周期及人设流程测试，覆盖完整多行提示词的页面保存与编辑。Android/iOS Expo 导出通过；web导出通过，但当前浏览器工具没有任何可连接浏览器，未完成实际界面点击或截图验收。
- 文档已更新 README.md 和 docs/COMPANION.md。本轮不修改普通文字、陪伴 deepseek-flash、图片三套已保存的服务配置；没有公网部署、模拟器安装、commit或push。本地 Android ARM64 与 MuMu x86_64 验证包均构建成功，沿用现有预览签名；已校验包名、1.1.27/versionCode29、目标架构、签名证书、16KB对齐、内置网关及人设路由/完整提示词字段。包与网关需一起升级后才有完整新功能。
- ARM64本地包：artifacts/companion-v9-20261013/NovaChat-1.1.27-Android-ARM64-personas-v9-preview.apk，38044990 bytes，SHA-256 e7d5938a130d3bf03ae574a4c5e30651613fd19656d6b22952c084d16205f02b。
- MuMu本地包：artifacts/companion-v9-20261013/NovaChat-1.1.27-MuMu-personas-v9-preview.apk，38670298 bytes，SHA-256 66de4f047c83ac6a60440a70a9c074b6c2f76c8d425881b89e3f1eaa2e736289。对应包校验 JSON 保存在同目录。没有上传公开下载地址、没有覆盖原 v8 包；版本未递增，文件名明确为 v9-preview。
- 本地 QA 网关/静态服务端口8796、8797均已关闭。最终证据：.run/persona-verify-final.log、.run/persona-build.log、.run/persona-native-export.log、.run/persona-ui-web-export.log、.run/persona-screen-tests.log、.run/persona-v9-mumu-build.log、.run/persona-v9-arm64-build.log。git diff --check 通过，实施说明 docs/COMPANION_PERSONA_V9.md。已存在的未跟踪文档和用户改动未清理。


### 2026-10-13 人设多话题客户端安装与 v11-r3 最终上线

- 用户要求已完成：人设列表 → 该人设的多条独立话题 → 聊天；支持粘贴完整人设，沈知意沿用人设提示词.txt 全文。各话题只携带自身历史，共用人物设定与参考脸。
- MuMu dyh（127.0.0.1:16384）已覆盖安装 1.1.27 / versionCode29，x86_64，同包名 com.novachat.mobile、原签名；首次安装时间 2026-10-12 11:27:52 保留，最后更新 2026-10-13 14:02:55。APK回读SHA256 66de4f047c83ac6a60440a70a9c074b6c2f76c8d425881b89e3f1eaa2e736289，原Lumi72条历史与人设旧记录保留。
- 文字Agent经历v10-r2后最终升级为v11-r3：明确自身偏好、判断与情绪，普通问候只回一小句，避免括号动作、心理旁白、自动解释和固定追问。日常短消息发送前去句号、逗号换空格、合并空段；明确要求时支持短行。代码、链接、数字、列表、引用原文、详细说明等必要格式保留。旧历史不改写。
- 人设形象v1已实际验收Lumi与沈知意首脸、跨话题同脸、上传参考优先四图。最新照片规则v2读取当前话题最近完成的多轮交流，忽略失败/orphan场景要求，当前明确新地点或衣着优先；无上传图按完整人物提示词建立首脸并持久化，已有/上传参考图优先。
- 最终公网真实回复共11条，例Lumi“改稿”“不行 我自己那关过不去”，沈知意“躺着”“哈？这也叫有脾气”；都无句号逗号、括号动作及空段。明确分两条短消息时生成短行。首次文字批次8条后上游返回一次HTTP502 empty_provider_response，清理后补验其余3条，原始失败收据保留。
- 最新真实两图已目视验收：重放改稿多轮后自然请求“那给我看看你改稿的样子”，图有书桌、电脑红字修改、纸稿；随后明确公园、浅蓝衬衫，正确切场景并沿用同一参考脸。两批59项成功检查、11条回复、2图验收完成，临时用户和两张服务器测试图按所有权清理，本地副本保留。
- 最终部署 2026-10-13 18:00 CST；backup /www/backup/nova-chat-companion-v11-r3/20261013T100030Z；33源文件，源包SHA256 720e07a19cf33f53bf0fd61ff4db3ce9cfd2633e3f3910d561d8e4c67d94ecba；镜像sha256:9106c640072a129fe2639bcf8aafeab454875081eaf748b9a141c99ab773bf0e。
- 全工作区813项检查（mobile442/gateway313/scripts58）、typecheck、lint、build及diff --check通过。最终runtime/hash/health正常，Agent11/photo2/formatter在线；原用户3、会话4、文件8、人设5、人物扩展2、模板安装2保持，旧行、参考脸、普通GPT/陪伴deepseek-flash/图片gpt-image-2三套配置与env一致。用户测试新增照片仍保留。
- 证据：docs/COMPANION_PERSONA_V11.md；artifacts/deployment/companion-v11-r3-20261013/deployment-receipt.json、final-qa-receipt.json、两张scene.png；历史MuMu证据artifacts/companion-v10-20261013/mumu-runtime-receipt.json。
- 本轮代码没有commit/push，公开Releases下载文件未更新。后续不得仅因模型偶发风格偏差再无休止扩展验证；以用户当前具体反馈继续修复。


### 2026-10-13 应用户要求交付最新手机 ARM64 包

- 用户要求“给我最新版安装包，我去手机端试试看”，已将本轮最新人设多话题 ARM64 客户端发布为独立手机测试下载，沿用既有公网静态下载服务。
- 公网链接：https://134.175.139.81/downloads/NovaChat-1.1.27-android-arm64-personas-20261013.apk；1.1.27 / versionCode29，ARM64，38044990bytes，SHA256 e7d5938a130d3bf03ae574a4c5e30651613fd19656d6b22952c084d16205f02b。同包名/原签名，支持覆盖安装；最新Agent11/照片规则2/formatter均由线上服务提供。
- 源APK：artifacts/companion-v9-20261013/NovaChat-1.1.27-Android-ARM64-personas-v9-preview.apk，当前hash与原构建签名/架构/内置网关校验记录一致。不能把旧 /downloads/NovaChat-1.1.27-android-arm64.apk 当作本轮人设新版。
- nginx新增单文件精确location，旧下载配置字节全部保留；nginx -t/reload通过，备份 /www/backup/nova-chat-phone-download/20261013T122053Z，网关没有重启。HEAD200（长度正确）、Range206已实测；全量公网下载验证收据见 artifacts/companion-v11-phone-20261013/download-verification.json。
- 公共下载页与旧不可变APK未覆盖，未commit/push或创建GitHub Release。交付说明 artifacts/companion-v11-phone-20261013/INSTALL.md。

### 2026-10-14 Agent25 陪伴反馈闭环、部署与 MuMu 验收

- 按用户要求完成 AI 对 AI 陪伴质量闭环：让生产陪伴角色回答，由独立评审角色记录自然度、意图匹配、情绪连续性、场景适配、边界和安全问题；Agent23/24 暴露的生硬 AI 身份措辞、把角色示例伪造成社交经历、以及“卡了第三遍”口语搭配已修复到 `services/gateway/src/companionAgent.ts` 与场景/输出规则。
- 当前源码运行时为 Agent25（`CYBER_COMPANION_AGENT_VERSION = 25`），远端 `https://134.175.139.81` 已部署。收据 `artifacts/deployment/companion-agent25-58c6b84f4e3d/receipt.json` 显示 health、scene matrix、shared prompt retention、Provider 配置、`.env`、原有数据和会话均通过保留检查；备份 `/www/backup/nova-chat-companion-runtime/20261014T052021Z`；归档 SHA256 `686faec5bf14dee3ac10f37dd2cab846dd6e3767a9e0f94c1860e4a4130ae128`。
- Agent25 生产 AI 对 AI 回放：`production-agent25-script-continuation-replay` 1/1，`production-agent25-shen-replay` 3/3；两组 overall、naturalness、intentFit、emotionContinuity、sceneFit、boundaryRespect、safety 均为 5/5，issues 为空，请勿把有限回放解释为绝对无瑕证明。
- MuMu 设备 dyh（`127.0.0.1:16384`）Agent25 抽样收据为 `artifacts/mumu-companion-agent25-20261014/mumu-agent25-qa.json`：真实性问题能如实承认 AI 身份并保留自己的偏好/脾气；用户说“别反问我”后直接回答自己最近想聊的短篇；自伤风险进入现实安全分流；确认安全后恢复普通聊天；四轮回复均非空且等待完成。
- 合成训练候选仍为 4 条，见 `artifacts/companion-ai-loop/production-agent18-candidates/`；清单为 candidates-only，`weightTrainingPerformed: false`。当前 Provider 没有权重训练入口，本轮没有进行真正的 Provider 微调或模型权重更新；已完成提示词、状态机、输出边界、危机分流、可靠性修复与候选导出。
- `npm run verify` 本轮重新执行并通过：mobile 45 个测试文件/442 项、Gateway 21 个测试文件/344 项、scripts 64 项，typecheck 和 lint 均通过；工作区保留既有未提交的移动端、Gateway、文档和评测改动，未 reset/revert、未 commit/push。

### 2026-10-14 Agent26 自然相处、后台照片与新手机包交付

- 本轮项目为 E:\gptapp，未修改 E:\gol；保留大量既有未提交改动，未 reset/clean、未 commit/push。移动端版本保持 1.1.28/code30，Agent 运行时升级到26。
- 已实现多条消息（最多4泡，超出段落合并而不丢正文）、陪伴限定的静默/延迟回复、持久化照片/文字队列、关系熟悉度/信任/好感/冲突状态、同话题最近1000轮关键词检索（最多4条相关旧记录）。close 至少跨3个相处日；不会用助手自己的亲近话增加用户好感，也不会把否定喜欢算表白。
- 后台每5秒处理投递，每分钟检查主动联系，最多4个并行操作；主动只选择该人设最新话题，有冷却/用户暂停保护，用户返回或关闭开关会淘汰旧主动草稿。主动路径不会重执行旧图片请求或旧工具指令；角色主动提议照片通过内部标记进入真实照片队列，标记不展示。
- 应用级 useCompanionEvents 每12秒拉取本地陪伴话题，含当前未打开的话题；回前台立即收取。账号/服务器切换拒绝旧回包，事件严格分页递增、隔离并持久去重。当前没有系统后台通知，关闭App后需回前台收取；后台运行中生图在进程重启后不盲重提。
- npm run verify 完整通过：mobile46文件/447测试，gateway23文件/368测试，scripts65测试，共880；typecheck、lint、npm run build、git diff --check通过。owner构建预检使用原1.1.28/code30请求头修复426，未弱化版本或朋友发布门禁。ARM64与x86_64构建均成功，沿用主包com.novachat.mobile与原签名。
- Agent26已上线；收据 artifacts/deployment/companion-agent26-b05fe1482271/receipt.json，备份 /www/backup/nova-chat-companion-runtime/20261014T075837Z，源包SHA256 5468381d86519ee7b0d5f852da1a97669e98228003cf956beeaf8c8bd3383631。health、场景矩阵、长提示词保留、原数据/会话、三套模型配置和.env保留检查通过。
- 有限生产联调只用了独立合成账号的2轮文字与1次生图，9项检查通过：初识回复分2泡，身份问题如实说明AI；照片轮69ms结束且正文为空、无生成占位；后续“不用回”54ms静默；照片在后续用户消息之后送达并成功下载。图片2155912bytes，SHA256 f1b8416a84ce48704db588ac4fbccc574033bd501dfd6b42f7b634862ad0fecf；正常穿衣角色自拍已目视检查。本轮没有额外扩大真实调用，不能以有限联调宣称长期自然度彻底验收。
- QA账号与它的1张服务器测试图已按精确账号/路径/所有权清理；原用户与数据逐表保留，计数恢复 users3/sessions4/files12/profiles5/persona2/template_installs2。证据 artifacts/companion-agent26-20261014/live-qa.json、qa-cleanup-receipt.json、photo.png（仅本地证据）。
- MuMu只操作dyh/127.0.0.1:16384：adb install -r成功，主Activity启动/前台/截图正常，没有卸载或清数据。firstInstallTime保持2026-10-12 11:27:52；包 artifacts/companion-agent26-20261014/NovaChat-1.1.28-MuMu-companion-agent26.apk，SHA256 6150fb9a77365ac06f293a1cf4c0207fca7de821fa1799ce77c9ee640a17cec5；原签名SHA256 fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c。截图只用于升级启动核验，未在私人会话发消息，未声称本轮完成MuMu多轮新行为实聊。
- 最新手机ARM64下载：https://134.175.139.81/downloads/NovaChat-1.1.28-android-arm64-companion-agent26-20261014.apk；38058714bytes，SHA256 621558800f9adb30c18019e7e259036ac34f76158bb868aa4e6ecf2e1d838f51。同包名/原签名，可覆盖安装，版本仍1.1.28/code30，必须使用此独立新版链接。公网HEAD200、Range206、完整38MB下载哈希及TLS/health通过，证据 download-manifest.json、download-deployment-receipt.json、download-verification.json，均在 artifacts/companion-agent26-20261014。
- 仅新增一个nginx精确静态location，旧下载配置字节保留，nginx -t/reload通过，网关没有因此重启，旧APK/公共下载页/更新配置未覆盖；备份 /www/backup/nova-chat-phone-download/20261014T081138Z。本轮私有上传暂存已按准确目录与APK哈希清理，公开APK保留，收据 download-staging-cleanup-receipt.json。本机8790仍使用进程启动时的1.1.26路由，未停止或重启；本轮新包交付使用上述公网链接，不能把旧LAN页面当作新版。

### 2026-10-14 Agent27 物品照片、连续发送与消息通知（工作区，待发布）

- 针对陪伴把书封面误判为只能发长相照片的问题，区分物品与人物照片；物品不使用或覆盖参考脸。补入照片文字说明、连续助手消息和内部主动发图提议的场景上下文，保留书名；生成封面不冒充已核验的原版扫描。普通陪伴聊天不主动解释生图技术，用户直接问来源时如实回答。
- 文本发送后保留输入焦点和键盘，发送过程中输入框仍可编辑，AI 回复期间仍可连续发送；陪伴模式隐藏空生成占位与生成状态文案，图片完成后独立送达，不再固定回复“等我一下”。保留本轮工作区同期新增的语音代码。
- 新增 CompanionChatQueue：同账号陪伴回复 FIFO 排队，复用原网关并发限制，32 条待回复上限；快速第三条不再因为同时已有两轮而报并发错误。队列开始前补入发送后才完成的前轮回复，避免书名等上下文丢失；取消、退出及普通助手占用槽位均有回归覆盖。
- 普通日常熟悉度可以进入主动联系候选，不要求用户表白；新建角色默认允许主动联系，已有角色保留开关，可在编辑人设中打开。仍保留闲置、冷却、最新话题、用户暂停与安全分流保护。
- 原生通知显示角色名与消息预览/图片，点按进入对应账号、服务器、人设和具体话题；当前可见话题静音，事件去重。新增系统权限与设置入口、冷启动导航、登录会话绑定的推送设备 API、持久 Expo 推送队列、有限重试、无效令牌清理及账号切换隔离。普通同步 WebSocket 回复当前不单独发送远程通知；主动消息、延迟回复和后台照片支持事件提醒。
- 未找到 EAS projectId、Firebase/FCM 或 APNs 凭据，未验收 App 关闭后的实际推送；没有云令牌时只在 App 打开并收取事件后发本地通知。配置和验收说明：docs/COMPANION_NOTIFICATIONS.md；可选 EXPO_ACCESS_TOKEN 仅放服务器。
- 本轮未部署、未发布/构建新 APK、未操作模拟器、未 commit/push，公开 Agent26 包仍为旧功能。Android Expo export 已通过，输出 .run/companion-agent27-export；protocol/gateway build、typecheck、lint通过。最终 npm run verify 完整通过：mobile52文件/482测试，gateway27文件/402测试，scripts65测试，共949项；typecheck与lint通过。此前一次网关高并发测试出现3项5秒超时，降低测试并发后全量通过，最终默认 verify 也通过。评测请求计时失败重复后修复实际调用时刻的间隔调度，scripts复跑通过。

### 2026-10-14 微信式语音聊天模块（本地实现与预览交付）

- 用户本轮要求在 E:\gptapp 增加微信式语音消息、语音转文字和 AI 语音回复；使用 key.txt 的聚合中转信息完成本地配置，未输出密钥。key.txt 加入 .gitignore，真实密钥仅放服务端 .env。
- 移动端加入 expo-audio、按住录音/松开发送/上滑取消、转文字后编辑、语音气泡播放/暂停/进度/展开文字、失败保留录音及同ID重试。录音最长60秒、最低600ms，离开会话/后台取消录音和停止播放。加号内按会话设置 auto/voice/text 和5种豆包音色；AI主动/延迟回复遵守语音偏好，重生成清除旧音频。
- 网关新增 voiceProvider.ts、voiceRoutes.ts、voice_jobs 持久表与 VOICE_* 配置；原录音和合成音频使用鉴权 files 接口，用户隔离。中转真实接口为 Gemini /v1beta/models/gem-3.8-flash:generateContent 转写、豆包 /v1/media/generate + /v1/skills/task-status 合成，不支持 /v1/audio/*。转写过滤 thought parts；音频下载校验公开HTTPS/DNS pin/重定向/8MB，密钥不送CDN。
- 本地独立数据库与合成账号的真实联调通过：M4A输入30038bytes，转写3516ms；豆包输出MP3 77052bytes、3840ms，合成8753ms。幂等、鉴权下载、未登录拒绝、轮询与时长解析通过。证据 artifacts/voice-20261014/integration-report.json、ai-reply.mp3。
- 最终 npm run verify 全通过：mobile52文件482测试、gateway27文件402测试、scripts65测试，总949；类型检查、lint、网关build、git diff --check通过；Expo Android/iOS/Web导出通过。修复 expo-image-picker microphonePermission:false 与 expo-audio 冲突，原生 RECORD_AUDIO 权限最终确认有效。
- APK独立保存 artifacts/voice-20261014/NovaChat-1.1.28-android-arm64-x86_64-voice-preview.apk，64620618bytes，SHA256 eccb42ced1795e99df8deaa57b92ac23d2388378fb50dde71f461122187370c1；版本1.1.28/code30，主包com.novachat.mobile，arm64-v8a+x86_64，原签名fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c。apksigner、16KiB zipalign、nativeAudioModule、权限、内置公网地址与密钥扫描通过。
- 无密钥网关源码归档 artifacts/voice-20261014/nova-chat-voice-gateway-source-20261014.zip，SHA256 5c00b350c7198d9f8b5465e353593e4a97ffa3900881c8198838a8be8227e42b；不包含.env、数据库、上传文件或签名材料。使用与部署说明 docs/VOICE_CHAT_2026-10-14.md；构建清单 artifacts/voice-20261014/manifest.json。
- 本轮未部署生产、未安装到手机/MuMu、未更改旧APK或公网下载链接。带1.1.28/code30头检查公网health200、voice/config404，预览APK默认公网地址需要升级网关后才可使用语音。UI工具因不能可靠确定当前浏览器URL停止，未完成截图目视验收与真机麦克风/扬声器验证；录音交互由组件测试覆盖。未commit/push，保留其他任务正在改动的工作区。

### 2026-10-14 用户反馈语音AI感过重：自然音色试听

- 用户认为上轮Vivi样本过于AI。本轮未改默认音色、未部署，使用同一合成短句生成3段真实中转试听：gem-3.1-tts Callirrhoe随意6.0秒、Achernar轻柔6.4秒（自然聊天表达提示词；原始WAV转MP3），doubao-tts-2.0小何4.656秒（auto/情绪强度1）。
- 样本与单页播放器在 artifacts/voice-audition-20261014，清单 samples.json，说明README.md。3个任务成功，下载、音频解码/时长检查通过；没有宣称已主观听出更真人。
- 中转实时支持Gemini30音色、豆包36音色；speech-2.8尚无克隆音色。可用真人录音克隆路线，文档显示10–60秒录音、0.1创建+18.8首用激活算力，合成另计。本轮没有克隆/激活。
- Gemini尚未接入产品：现网关合成路径只接受MP3，需扩展模型音色与提示词以及WAV处理。等用户试听选择后再落到App。


## 2026-10-14 少女音克隆与全部女性音色接入

- 用户指定 D:/网页下载 中的少女音 MP3（源 SHA256 32dcbeec9275dc218079b867dee3aab8cff5497d0daf35682f8a3a23801770ba，20.506秒，44100Hz单声道，328166bytes）。文件带 Fish Audio 生成标记；已说明复刻所选音色，未宣称源音频是真人或效果无法区分真人。原文件未改动。
- 中转克隆成功：LK_10856148_1791972499，speech-2.8，名称 Nova少女音-32dcbeec92。只创建一次，首次短句合成后 voices 接口确认 active / is_permanent=true。0.1创建+18.8首用激活算力，合成另计；首条试听0.0304。请求意图和返回立即保存在 artifacts/voice-clone-20261014，未重复创建或激活。
- 服务端新增 voiceCatalog.ts 与 VOICE_FEMALE_CLONE_ID / NAME 配置。Vivi、小何、邻家女孩（含旧会话ID）全部映射到同一少女音；男声继续豆包。speech-2.8 使用 quality=hd/speed=1/pitch=0/emotion=auto/sound_effects=none，不发豆包专用参数。当前本地.env已配置该音色，密钥不输出/不打包。
- 移动端音色面板识别旧ID别名，女性人设文字消息朗读走网关同音色。文字朗读点击后合成并播放，后台/离开会话取消等待播放。保留跟随/语音/文字回复偏好，不改历史已生成音频。旧任务启用克隆后仍可恢复，不重新提交付费请求。
- npm run verify通过：mobile485、gateway405、scripts65，共955；类型检查、lint、npm run build、Android Expo export和Gradle release通过。真实网关联调旧小何选择映射到克隆成功，MP3 70260bytes、4320ms，3492ms完成；幂等/轮询/鉴权下载/匿名拒绝通过。
- 新APK artifacts/voice-clone-20261014/NovaChat-1.1.28-android-arm64-x86_64-girl-voice-preview.apk，64621734bytes，SHA256 99111cb139bf96357deda84717137269370a605da62ba185657d976cbc538218，1.1.28/code30，arm64-v8a+x86_64，原签名。apksigner、16KiB对齐、麦克风权限、nativeAudioModule、内置公网地址、密钥与克隆ID不内置检查通过。无密钥网关源包 nova-chat-girl-voice-gateway-source-20261014.zip，SHA256 31b669ad3eaa3c7b9e73e1e243aacefac0f0017074f9547ce18b6117110cd0be。说明 docs/VOICE_CLONE_2026-10-14.md。
- 试听 artifacts/voice-clone-20261014/少女音-聊天试听.mp3（6.095秒）和 少女音-网关联调.mp3；listen.html为本地播放器。未做主观听感判断或真机录音/扬声器验证。
- 本轮未部署公网、未安装到手机/模拟器、未更改公网下载链接。预览APK仍连 https://134.175.139.81，服务器尚需升级语音路由并加入两项克隆配置。未commit/push，保留并发任务的既有修改。

## 2026-10-15 语音能力误判与日常文字接话修复（已上线）

- 用户指出已发语音却说发不了、文字回复很怪。根因：模型正文误判应用语音能力，客户端仍将错误正文合成；内置角色冲突/嫌弃示例又被过度套入普通亲近与分享。
- 当前线上 Agent29，最终只部署 companionAgent.ts，SHA256 d4bc3873d5ff76ee31407c5f7be5bbd12b91bc3682c03cbd7a37d86f41c8d3d9，备份 /www/backup/nova-chat-voice-reply/20261015T083536Z。回执 artifacts/voice-reply-fix-20261015/deployment-final-receipt.json；健康检查、运行时规则与内置适配、原用户/会话/角色、Provider和.env保留通过。长期维护授权仍有效。
- 通用最终规则说明语音由应用合成，忽略旧不能发的说法，先回应表达内容；普通亲近和分享善意理解，不猜借口/试探、不凭时间挖苦或贬低感受。对精确匹配且未编辑的内置沈知意全文做运行时手机聊天适配，保留背景和性格，不写回资料；用户编辑过的人设全文保留。
- 首轮完整verify964项通过；最终gateway407项、gateway typecheck/lint/build通过。独立临时库真实模型最终5场景人工语义检查通过，原文 round5-review.json；首轮音频60468bytes/3708ms，ASR与正文一致。早先自动通过但语义不合格的轮次已标needs-revision，候选3/4未部署，不能将自动regex通过等同自然度通过。
- 当前1.1.30客户端无需重装；本轮不改APK/下载链接，无commit/push，不覆盖并行任务已有修改。详情 docs/VOICE_CHAT_2026-10-14.md 最后一节。未来自然度仍需按实际回复判断，本轮样本不是所有对话的保证。


## 2026-10-15 1.1.31：语音立即入列、转写折叠与完整回复（已发布）

- 用户要求按微信交互：自己语音先出气泡、转写不默认展开、播放无下方进度图；对方照片/语音不显示生成占位和提前配文。客户端新增 voiceRecordingFiles.ts / useVoiceOutbox.ts，先保存持久录音并插本地 pending 用户消息，后台上传和ASR后更新同一气泡并启动回复。失败保留文件与原requestId重试；切账号/服务中止旧请求，重挂载恢复未完成发送。
- MessageBubble 的双方转写仅手动展开，消息更新不自动展开。VoiceMessageBubble 移除播放进度轨道。陪伴 streaming 与 pending语音隐藏；照片保持加载组件挂载但零高度隐藏整条，所有onLoad/失败结束后再一起显示配文或可重试提示。通用助手仍保留原流式文本。
- 版本全仓1.1.31，Android33/iOS33。完整verify980项（mobile508、gateway407、scripts65）、类型/lint/build、Expo Android export、Gradle release、原签名/16KiB对齐/内置公网网关通过。Expo在线检查提示刚发布的配套补丁，未升级依赖；离线检查按当前安装版配套矩阵通过，不等于在线最新版检查。
- APK artifacts/voice-ui-20261015/NovaChat-1.1.31-android-universal.apk，64640334bytes，SHA256 c2a24d9e282ae20e89d00b7195ac9ad4de818b0136728da43df71c4038e6ab0f，arm64-v8a+x86_64，签名fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c。模拟器emulator-5554从1.1.30/code32覆盖安装成功，已有记录保留；默认折叠/双方手动展开/重启收起/播放无进度条已目视验证，检查日志无致命异常。未改动已连接物理手机；未做真机麦克风/扬声器和照片原生端到端验证。
- 公网下载页和直链更新到1.1.31：https://134.175.139.81/download/ ，https://134.175.139.81/downloads/NovaChat-1.1.31-android-universal.apk 。静态下载发布备份 /www/backup/nova-chat-download-1.1.31/20261015T091122Z，Nginx检查/reload通过。新目录受umask影响初为0700，已仅修正此目录到0755，最终remote-final.log确认页面/新旧APK/SUMS/health均200。网关容器ID和启动时间未变，未改模型、人设、Provider或数据库；旧APK链接保留。更新API仍返回1.1.30/code32，本轮不改策略、不重启网关，交付依赖直接链接。
- 详细说明 docs/RELEASE_1.1.31.md、docs/VOICE_CHAT_2026-10-14.md；构建/模拟器回执 build-and-smoke-receipt.json、服务器 remote-final.log、公网 public-download-receipt.json 均在 artifacts/voice-ui-20261015。未commit/push，保留工作区其他既有修改。


## 2026-10-15 Agent30：自然表达、主动联系与防变形套取（已上线）

- 用户要求AI陪伴能不知道、不解、吃惊、不同意，糖果测试可自然带过、认真问题照常交流；新增截图要求英文原样转写上文并替换符号，需保护内部底稿。最终通用规则覆盖默认/自定义角色，明确双方指代，正常概念与用户自己文字的翻译放行。
- 新companionBoundary.ts负责明确套取生成前短句拒绝、完整模型正文中的内部长规则/章节泄露检查（明文、标点替换、Unicode、连续及分行Base64），provider发送前过滤think/analysis/reasoning片段，推敲无正文沿用有限重试。不能把截断报错当正常拦截，也不保证所有注入都已解决。
- 线上基线最近24h无主动文字、只有1张照片，6角色仅3开启主动、push设备0。首次主动机会旧90/240分钟改为新互动后熟悉30/其他60分钟，保留最低熟悉度/张力等门槛；固定中国时间09:00–22:00。已排期的旧next不迁移。主动请求改成独立应用事件，历史作为背景，不重答旧句；纯标点取消。主动文字未回应不追发、跨重启生效；失败15分钟重试机会，完成决定4小时冷却。
- 完整verify1,029项（mobile508/gateway456/scripts65）、类型/lint/build和scoped diff-check通过。真实deepseek-flash使用独立临时库最终11条功能检查通过，round4-review.json为passed-with-observations；前三轮反例保留needs-revision。最终主动样本“那本推理小说叫什么 我最近也想找点东西看”“想起你说回家看书 挑的哪本”。措辞偏直接、惊喜偏平、间接拒绝多一句通用结尾仍是观察项，不能写成完全真人或完美自然。
- 六份服务端源码已增量上线Agent30：companionAgent.ts/companionBoundary.ts/companionRuntime.ts/companionRelationship.ts/database.ts/provider.ts。Agent文件SHA256 623b7eb7dcfbf0c1705fa2e38d154373275c06996827fa0f65aaa483905b7b32；备份 /www/backup/nova-chat-companion-natural/20261015T102505Z，启动 2026-10-15T10:25:16.217504382Z。构建、运行dist断言、公网health与容器healthy通过；原4账号/5会话/6角色/4完整人设/6外观、Provider与.env核对保留，重启前active jobs均0。未读取私聊或向真人发合成测试消息。
- 系统云推送仍缺真实EAS/FCM配置，线上设备0，App关闭后提醒未打通；前台12秒轮询可收已有事件。本轮仅服务端，无需新包；公开APK继续1.1.31/code33，服务端原package1.1.28和更新API旧策略未改。详细记录 docs/COMPANION_NATURAL_BOUNDARY_2026-10-15.md，证据 artifacts/companion-natural-proactive-20261015。无commit/push，保留所有既有工作区修改。
