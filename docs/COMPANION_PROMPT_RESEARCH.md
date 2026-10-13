# 陪伴提示词的设计参考

Nova 的默认陪伴提示采用原创中文表达。研究过程查看了公开 GitHub 项目的角色资料、提示组织方式与对话规则，借鉴结构和取舍，没有引入这些项目的运行框架。

## 实际参考的项目

| 来源 | 查看内容 | 采用的思路 |
| --- | --- | --- |
| [moeru-ai/airi](https://github.com/moeru-ai/airi) | [默认人物资料](https://github.com/moeru-ai/airi/blob/main/packages/stage-ui/src/constants/prompts/character-defaults.ts)、[Telegram 人物提示](https://github.com/moeru-ai/airi/blob/main/integrations/telegram-bot/src/prompts/personality-v1.velin.md) | 分开人物身份、具体偏好、说话方式和场景；明确成年背景 |
| [SillyTavern/SillyTavern](https://github.com/SillyTavern/SillyTavern) | [OpenAI 默认预设](https://github.com/SillyTavern/SillyTavern/blob/release/default/content/presets/openai/Default.json) | 分离主提示、人物性格、场景和短对话示例 |
| [pangxueyuan2-creator/ai-girlfriend-kit](https://github.com/pangxueyuan2-creator/ai-girlfriend-kit) | [cold-beauty](https://github.com/pangxueyuan2-creator/ai-girlfriend-kit/blob/6e3452996bedfdeb8e1bc601978b44d5689cf357/src/aigf/personalities/cold-beauty.md) 与 [teasing-sister](https://github.com/pangxueyuan2-creator/ai-girlfriend-kit/blob/6e3452996bedfdeb8e1bc601978b44d5689cf357/src/aigf/personalities/teasing-sister.md) | 将冷淡与熟悉后的逗弄落到短口语，避免每次都表演腹黑 |
| [xiaozhi-esp32-server](https://github.com/xinnan-tech/xiaozhi-esp32-server) | 提示管理思路 | 人物内容与工具、时间等运行上下文分层 |
| [tavern2agent](https://github.com/Xerxes-2/tavern2agent) | [角色卡](https://github.com/Xerxes-2/tavern2agent/blob/601b1c3f447ae5472e7bc5b59fc17771129293c1/docs/developing-cards.md)与[提示组合](https://github.com/Xerxes-2/tavern2agent/blob/601b1c3f447ae5472e7bc5b59fc17771129293c1/references/prompt-composition.md) | 用户可编辑的角色资料独立于运行规则 |
| [RisuAI](https://github.com/kwaroran/RisuAI) | 默认提示组织方式 | 比较角色规则的密度，避免过多规则压住人物的日常表达 |

上游文件与路径可能随项目更新而变化。这里只说明实际设计参考，不表示 Nova 与上述项目存在合作或继承关系。

## 默认 v8 的取舍

Lumi 设定为 20 岁中文专业大二女生。角色有具体日常、朋友、阅读与写作偏好，气质偏孤高；腹黑只在熟悉后偶尔出现，不在每句回复里贴标签。

回复优先使用一小句自然口语。接住当前事情，不自动追加新话题、总结、建议或固定问题。情绪可以延续：被冒犯后不会立刻热情，也不把道歉当成需要分析、评分或受理的任务。

运行提示仍明确区分人物背景、用户允许的记忆和工具数据。旧历史里的事实可以沿用，生硬的旧表达不作为新回复范本。人物不伪造工具结果；直接询问身份或图片真实性时如实说明。

## 代码与验证

- 共享默认与精确迁移：packages/protocol/src/index.ts。
- 当前提示组装：services/gateway/src/companionAgent.ts。
- 完整默认提示：[COMPANION_DEFAULT_PROMPT_V8.txt](COMPANION_DEFAULT_PROMPT_V8.txt)。
- 使用与调整：[陪伴指南](COMPANION.md)。

自动检查覆盖默认字段升级、自定义隔离与提示约束；实际模型对话验证短回复、冒犯后的情绪延续、道歉与旧历史续聊。自然程度依赖具体模型与上下文，不用关键词和长度代替真人阅读判断。
