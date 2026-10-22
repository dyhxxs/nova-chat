# 人设形象生成规则 v1（历史验收）

2026-10-13 已部署：没有上传参考图时，图片提示词读取服务端保存的完整人设，优先使用人物的年龄、性别和外貌描述，其他细节从背景、生活、喜好与性格推导。只有没有完整提示词时才使用简要性格。调用方传来的旧人物资料不覆盖服务端保存的人设。

视觉优先级为：已有或上传的参考图 → 显式外貌描述 → 人设内外貌描述 → 按人物推导的风格。首张成功照片保存为人物参考脸，同人设不同话题共用；后续更换场景、衣服和动作不重新设计脸。

## 实际验收

在隔离临时账号通过公网生成了四张图，并下载检查：

- [Lumi 首张形象](../artifacts/deployment/companion-appearance-v1-20261013/lumi-first-persona-face.png)：日常房间、书本与学生风格。
- [沈知意首张形象](../artifacts/deployment/companion-appearance-v1-20261013/shen-first-persona-face.png)：针织开衫、首饰与较精致的室内环境。
- [Lumi 新话题](../artifacts/deployment/companion-appearance-v1-20261013/lumi-new-topic-same-face.png)：咖啡馆、浅色衬衫，继续使用首张参考脸。
- [上传参考优先](../artifacts/deployment/companion-appearance-v1-20261013/shen-uploaded-reference-priority.png)：上传照片后采用上传参考图，即使与原人设推导长相不同。

20 项真实 API 检查通过，临时账号及其五个图片文件已按所有权清理。既有用户、会话、人设、参考脸、照片、服务配置与环境均审计保留；真实用户测试中新增的照片也保留。全工作区 799 项测试、类型检查、lint 与构建通过。

证据：[图片验收收据](../artifacts/deployment/companion-appearance-v1-20261013/photo-real-receipt.json)、[部署收据](../artifacts/deployment/companion-appearance-v1-20261013/deployment-receipt.json)。v1 只采用最新文字活动，后续发现多轮场景会丢失；目前该问题由 [v11 多轮场景与手机消息升级](COMPANION_PERSONA_V11.md)修复，本文件保留为历史验收记录。
