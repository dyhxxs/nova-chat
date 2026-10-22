# Nova Chat 1.1.31 · 语音发送和回复呈现

用户可见变化日期：2026-10-15。Android versionCode 33，包名 `com.novachat.mobile`。
公网发布复核日期：2026-10-21。

## 用户可见变化

- 发送语音时先保留本地录音并立即加入自己的语音气泡，不再等待上传和 ASR 完成。上传、转写完成后更新同一条消息，再触发 AI 回复；失败保留录音，同一 requestId 重试。重启可恢复未完成发送，账户/服务切换会中止旧请求。
- 双方语音的转写默认收起，点击“转文字”展开，点击“收起文字”关闭。消息内容更新不会自动展开；重新进入时默认收起。转写仍供模型理解和显式展开使用。
- 移除语音气泡下方播放进度条，保留时长和气泡内的播放状态。
- 陪伴聊天的流式半句和待合成语音隐藏。照片附件下载并完成本机解码后，照片和配文一起呈现；不提前显示配文、占位或加载圈。加载失败时显示可操作的重试提示。

“立即发送”指立即呈现自己的本地语音气泡。网络上传、ASR、模型回复、TTS 或照片生成仍有实际耗时；完整回复就绪后直接呈现，不表示服务器瞬间完成全部步骤。上述完整回复呈现应用于陪伴聊天；通用助手仍保留原有流式文本交互。

## 当前公网下载

下载页：<https://134.175.139.81/download/>

推荐在大多数 Android 手机上使用 ARM64 包：

- [NovaChat-1.1.31-android-arm64.apk](https://134.175.139.81/downloads/NovaChat-1.1.31-android-arm64.apk)
- 文件大小：42,909,649 bytes
- SHA-256：`691d21a9dae81b8ba7c5ecf3b0339e397a17d5beb0cb6b278d6ef6d583e1ad00`

需要兼容多种 ABI 时使用通用包：

- [NovaChat-1.1.31-android-universal.apk](https://134.175.139.81/downloads/NovaChat-1.1.31-android-universal.apk)
- 文件大小：102,014,370 bytes
- ABI：`armeabi-v7a`、`arm64-v8a`、`x86`、`x86_64`
- SHA-256：`fcd6a6044ddbd938dcc50543c303c6632f565bff77dfc4c781717e86e5e96d35`

这两个公网文件都由当前工作区的 1.1.31/versionCode 33 源码构建产物复制而来。此前同名通用包链接指向旧文件，本轮已替换服务器上的同名文件，并保留原有下载地址，避免用户继续拿到旧包。公网完整下载后的大小和 SHA-256 与本地构建产物一致；校验和文件见 [`artifacts/public-release-1.1.31/SHA256SUMS.txt`](../artifacts/public-release-1.1.31/SHA256SUMS.txt)，完整回执见 [`artifacts/public-release-1.1.31/deployment-verified.json`](../artifacts/public-release-1.1.31/deployment-verified.json)。

## 验证与范围

- 两个 APK 的 HEAD 请求均为 `200`，Content-Type 为 Android APK，Content-Disposition 文件名正确，并支持 `Accept-Ranges: bytes`。
- 两个 APK 的 `Range: bytes=0-127` 请求均返回 `206 Partial Content` 和 128 bytes；通用包的实际全量下载为 102,014,370 bytes，SHA-256 与构建产物完全一致。
- 公网 `/healthz` 返回存活状态，`/readyz` 返回数据库正常且 Provider 已配置；`/v1/app/update` 返回 `minimumVersionCode: 33`、`latestVersion: 1.1.31`，并指向当前 ARM64 下载地址。
- 本地源码、网关和脚本的自动化验证记录见 [`目标/02-验收清单.md`](../目标/02-验收清单.md)。这些证据不能替代真实手机安装、真实模型聊天、语音/照片/文件现场流程或正式数据卷恢复演练。

## 安装与已知验证边界

直接覆盖安装可以保留已有记录。当前已有 Android 模拟器安装与自动化覆盖；本轮公网回执确认的是服务器文件、下载能力、更新接口和网关探针。本机没有可用的 `adb` 物理设备，因此真实手机麦克风、扬声器、照片原生解码和公网网络环境仍需现场验证。

Provider 状态为 `configured` 只表示公网网关保存了模型配置，不代表本轮重新执行了真实模型聊天。正式上线前还应在目标设备完成登录、普通聊天、陪伴聊天、语音、照片、文件上传、断网重试和备份恢复检查。
