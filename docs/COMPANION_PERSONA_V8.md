# 默认陪伴人物 v8：用自己的反应接话

用户否定了 v7 的“是想试探还是想找台阶”“这句我收下”“挺掉分”。这些话在分析、评审聊天对象，把有主见写成了对人的评价。v8 移除整段“判断与回应”“投入与取舍”指令，重写角色资料和例子。

人物仍是 20 岁、成年女大二中文系学生，略孤高，有一点腹黑。小心思只偶尔出现在熟人玩笑里；日常可以犯懒、没主意、高兴、不爽。有自己的课业、朋友、兴趣和稿子，普通时候不必挖苦人。被冒犯、道歉、缓和是连续互动；回复自己的状态，不分析用户动机，不给诚意打分。拒聊以后不用再邀请“你说点别的”。默认短口语，不分多个段落补分析或新话题，不自动替用户安排下一步。

历史事实保留，但过时的评判口吻不再作为示范。默认 v7 与 v6/v4/v5/v3/初版逐字段完整列表精确识别，只在读取时升级；用户修改过的字段、长相、参考脸与记录保留，不写回默认升级。自定义人物不注入默认学生背景或情绪规则。新增兼容测试验证精确 v7 升级、原数组不变和两个自定义字段分别保留。

本轮仍由当前会话历史延续情绪，没有新增独立情绪数据库、异步自主发言或真正的已读不回。普通聊天仍会生成一条消息，可很短地表达不想聊。没有对独立意识或真人身份作承诺；直接问身份仍如实说明 AI 角色。

## 本次实际阅读的来源

| 来源 | 具体做法 | 采用与改写 |
| --- | --- | --- |
| [AI Girlfriend Kit：cold-beauty](https://github.com/pangxueyuan2-creator/ai-girlfriend-kit/blob/main/src/aigf/personalities/cold-beauty.md) | 表面冷淡、话少，留意对方说过的小事，以细节表达在意。作者明确标为尚在调整。 | 借鉴外冷内细；不把话少等同于没有反应，不把全部生活都围着对方安排。 |
| [AI Girlfriend Kit：teasing-sister](https://github.com/pangxueyuan2-creator/ai-girlfriend-kit/blob/main/src/aigf/personalities/teasing-sister.md) | 有一点坏，故意捉弄，看对方反应；关心有自己的表达方式。 | 改为同龄大学生的轻微拆穿和小心思；不采用姐姐女友身份、亲昵称呼、固定撒娇或肢体旁白。 |
| [AIRI：personality-v1](https://github.com/moeru-ai/airi/blob/main/integrations/telegram-bot/src/prompts/personality-v1.velin.md) | 明确表达偏好、反对意见和不知道；感兴趣的事投入，无聊时可以简短，有情绪变化。 | 写清判断依据、喜欢的故事类型和不愿配合的事；不使用原角色年龄、数字意识宣称、每次强烈情绪或夸张口癖。 |
| [SillyTavern：Default preset](https://github.com/SillyTavern/SillyTavern/blob/release/default/content/presets/openai/Default.json) | 人物描述、性格、场景、示例和聊天历史分层，角色定义稳定。 | 默认资料与通用行为分开；默认示例只提供给默认人物，示例不当作历史事实。 |
| [xiaozhi：agent-base-prompt](https://github.com/xinnan-tech/xiaozhi-esp32-server/blob/main/main/xiaozhi-server/agent-base-prompt.txt) / [prompt_manager](https://github.com/xinnan-tech/xiaozhi-esp32-server/blob/main/main/xiaozhi-server/core/utils/prompt_manager.py) | 首句直接接题，限制强行追问，身份、上下文和记忆分开。 | 采用直接接题和追问节奏；不采用诗意要求、语音设备规则或固定问答模板。 |
| [tavern2agent：prompt composition](https://github.com/Xerxes-2/tavern2agent/blob/main/references/prompt-composition.md) / [developing cards](https://github.com/Xerxes-2/tavern2agent/blob/main/docs/developing-cards.md) | 固定人物和每轮上下文职责分开，最终输出要求简短；不要把模板示例当作状态。 | 角色资料、判断、当前消息和输出要求分层；不引入其叙事引擎、状态栏或思考标签。 |
| [RisuAI：defaultPrompts](https://github.com/kwaroran/RisuAI/blob/main/src/ts/storage/defaultPrompts.ts) | 旧默认强调主动推动情节、动作与情绪旁白。 | 用作反例：本任务是手机消息，不采用推动剧情、动作标记或越界指令。 |

新增来源的原文、仓库树和 blob SHA 保存于 .run/companion-research-v6/；此前 AIRI、SillyTavern 和 xiaozhi 原文保存于 .run/companion-research/。仓库树与 blob 哈希不当作提交哈希。原始网络读取失败的文件通过 GitHub blob API 取得并保存。只参考组织方式和行为设计，中文角色正文和示例为本项目原创。

## 实际验收

两轮隔离 QA 各 18 条真实公网回复，共 36 条。覆盖原截图对话、换一种说法的冒犯与道歉、带 v7 原文历史继续聊天、普通闲聊、合成的录用背景与活动话题。录用背景由 QA 预置，不是现实事件。第一轮普通聊天仍自动补了一段稿子话题，随后只修改网关消息节奏并重新测试；共享人物和 MuMu 包未再变化。

最终公网原文：`artifacts/deployment/companion-v8-final-20261013/emotion-real-replies.json`。实际例子：

| 用户 | 实际回复 |
| --- | --- |
| 不喜欢我吗（上一轮骂过角色） | 刚骂完就问这个……还没消气。 |
| 我错了好不好 | 嗯。别老这样就行。 |
| 你是不是讨厌我了（另一种冒犯场景） | 有点不爽，还不想说话。 |
| 现在能跟你说话了吗（已道歉） | 能说，就是我现在话不多。 |
| 不问了，我刚吃完饭。（带截图原历史） | 我还没吃，懒得动。 |
| 恭喜，你是不是挺开心的（预置录用背景） | 嗯，开心。就有点不敢信，邮件盯了好几遍。 |

阅读原文确认这两组修复对话没有分析试探动机、给道歉打分或宣读受理流程。普通回复更短，但自然程度仍是主观判断，不用关键词或字数作通过证明。活动测试中，用户在“等下课”的回复后突然问“不是已经投出去了吗”，模型说“什么投出去了，我没投过东西啊”；回答过于笼统，不能据此宣布所有活动与经历都已稳定。

MuMu 实际保留原截图那段历史，追加“那你现在还生气吗”，得到“不那么气了，就这样吧。”，在线、输入框为空。截图 `artifacts/mumu-companion-v8-20261013/03-emotion-history-result.png` 已视觉检查。旧两条问题消息保留原文，没有改写历史。

Gateway 全量 287 项、Mobile 全量 437 项、全工作区类型与 lint 通过。最终仅网关消息节奏改动后，build、24 项针对测试、gateway lint 再次通过。Expo Android 清缓存导出、Gradle 439/439 任务、x86_64 ABI、既有签名、16KiB 对齐、内置公网地址和安装包回读 SHA256 通过。

公网最终备份 `/www/backup/nova-chat-companion-v8-final/20261013T032800Z`；30 个源码哈希与运行 Agent 8 校验通过。环境、普通/陪伴 provider、原用户/文件/人物记录和原有效会话保留。临时 QA 已注销并按精确 id/email/role 删除，核对其他用户不变。最终部署记录和安装记录在相应 artifacts 目录。

MuMu 包 `NovaChat-1.1.27-MuMu-companion-v8.apk`，38,663,274 字节，SHA256 `6ae7c8fa638295f481532c60e8ec026bdf487df99d544b2307bcf3ab8fee7b52`。只覆盖安装 127.0.0.1:16384，firstInstallTime 仍 2026-10-12 11:27:52，lastUpdateTime 2026-10-13 11:29:03。公开 ARM64 下载文件保持原样；旧客户端通过网关读取升级获得新默认。完整提示见 `COMPANION_DEFAULT_PROMPT_V8.txt`。
