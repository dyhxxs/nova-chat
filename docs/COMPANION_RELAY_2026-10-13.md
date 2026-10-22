# 陪伴聊天中转配置恢复（2026-10-13）

用户要求将陪伴聊天替换为其提供的 OpenAI 兼容中转服务。已通过管理员接口保存新地址和密钥，使用 deepseek-flash、Chat Completions、bearer；只允许该已选模型。凭据不写入源码、文档或验证回执。

## 问题证据与边界

原报错为 provider_models_unsupported，该错误对应模型列表请求的上游 HTTP 404/405。排查时数据库中的陪伴聊天配置仍为旧服务，新配置尚未保存。用用户提供的完整 /v1 基础地址分别通过本地请求、生产 ModelProvider、生产管理员草稿接口和 MuMu 输入表单验证，均成功返回 deepseek-flash 和 claude-fable-9。根路径 /models 返回 404，/v1/models 返回 200。

历史失败草稿已经离开页面并被清空，不能确认当时提交的具体地址，也不能据此断言用户输错或服务不兼容。本次通过重新输入、验证并保存完整配置恢复使用，未修改源代码或添加未经证实的接口回退。

## 实际验证

生产陪伴聊天接口：输入“刚下课？”，回复“嗯，刚下课。饿得没力气。”。验证使用现有管理员的临时会话和独立会话标识，结束后清除该验证快照并撤销临时登录会话，没有写入用户设备的聊天记录。

MuMu 的模型选择框已显示两项可用模型；配置生效后只观察用户正在操作的页面，看到文字回复和生成图片显示。没有重装 APK。截图：artifacts/mumu-companion-v8-20261013/08-relay-model-discovery.png、12-relay-live-companion.png。

## 数据与回滚

保存前数据库备份：/www/backup/nova-chat-companion-relay/20261013T044356Z/nova-chat.sqlite。普通聊天、陪伴图片服务、环境文件和运行镜像保持原值，原用户、文件、角色和长相记录均保留。用户同时在 MuMu 退出再登录并生成新照片，核验用户行时仅排除登录逻辑会更新的 last_login_at、updated_at，文件允许新增并逐条确认原记录仍在。

回执：artifacts/deployment/companion-relay-20261013/verification-receipt.json。后续检查应以当前新服务为准，不要恢复成先前旧服务。
