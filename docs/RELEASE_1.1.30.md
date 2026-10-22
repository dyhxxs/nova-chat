# Nova Chat 1.1.30

Android 通用安装包已发布到服务器，支持 ARM64 和 x86_64，包名 com.novachat.mobile，versionCode 32。

- 下载页：<https://134.175.139.81/download/>
- APK：<https://134.175.139.81/downloads/NovaChat-1.1.30-android-universal.apk>
- SHA-256：16bd9d34587fc56b46b6f4e386a7606a7925bbfcd893fcfdc9d0bf5780434fd8
- 文件大小：64,631,134 bytes
- 更新接口已切换到 1.1.30 / 32，旧版会收到升级提示。

## MuMu 验收

在 127.0.0.1:16384 覆盖安装并保留原数据后验证：

- 普通文字聊天只显示文字回复。
- 明确要求语音时，AI 显示语音气泡，转写显示在气泡下方。
- 按住说话能完成录音、上传和识别；用户语音下方显示转写。
- 用户发语音后，AI 也返回语音并显示转写。
- 点击播放时出现播放波形，结束后媒体状态为 STOPPED。
- 语音生成期间没有“语音准备中”占位气泡，页面不再因 pending 轮询反复闪烁。

公网完整下载哈希与本地构建一致，Range: bytes=0-99 返回 206 和 Content-Range: bytes 0-99/64631134。
