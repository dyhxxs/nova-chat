# Contributing to Nova Chat

感谢你愿意帮助 Nova Chat 变得更稳定、更容易部署和分享！欢迎提交代码、文档、兼容性反馈、测试结果和产品建议。

## 开始之前

1. 阅读 [README.md](./README.md)、[架构说明](./docs/ARCHITECTURE.md) 和 [安全文档](./SECURITY.md)。
2. 使用 Node.js 22+ 和 npm 10+。
3. 创建本地 `services/gateway/.env`，不要提交真实密钥。
4. 优先在自己的分支中修改，并保持每个提交只解决一个主题。

## 本地验证

```powershell
npm ci
npm run verify
npm run build
```

涉及移动端页面、权限、附件或模型行为的改动，还请在 Android 真机或模拟器上验证；如果提交了新的测试包，请在说明中写清楚设备、版本、构建类型和 SHA-256。

## 提交 Issue

请尽量提供：

- Nova Chat 版本、设备型号、Android/iOS 版本；
- Gateway 部署方式和 API 模式；
- 可复现步骤、预期结果和实际结果；
- 已脱敏的日志或截图。

**不要**上传 API Key、密码、Session Token、`SERVER_MASTER_KEY`、真实 `.env`、私人聊天内容或未脱敏的用户数据。

## Pull Request

Pull Request 的描述请包括：

- 改动目的和用户可见效果；
- 影响的 App、Gateway、Protocol 或文档范围；
- 测试命令与结果；
- 是否需要数据库迁移、环境变量或重新构建安装包。

## 代码风格

- TypeScript 优先，保持现有目录和命名风格。
- 不在客户端打包任何服务端密钥。
- 新增行为时优先补充回归测试。
- 兼容性和能力边界要在文档中明确说明，不要把第三方服务商能力写成 Nova 的绝对保证。

## 分享项目

欢迎分享项目主页或 GitHub Release。不要长期使用临时内网穿透地址分发 APK；正式安装包应使用签名 Release、SHA-256 校验和支持 HTTPS/Range 的下载服务。
