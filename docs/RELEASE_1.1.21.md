# Android 1.1.21 最新源码重新打包（2026-09-14）

## 本轮交付范围

用户明确要求沿用以前的安卓打包方式、使用最新代码。本轮完成**本地候选 APK**，不是恢复了公网聊天服务的朋友发布版。没有上传 GitHub、没有启动或绕过被禁止的公网隧道操作、没有生成新版公网下载链接。

## 实际产物

- 文件：`artifacts/candidate-1.1.21/NovaChat-1.1.21-android-arm64-candidate.apk`
- 版本：1.1.21，Android code23，正常包名 `com.novachat.mobile`。
- 大小：37,997,234 bytes（约36.24 MiB）。
- SHA-256：`84f07cc659f8c37cc4a16f9edf80f1a12d7d50111341e1e3133b19656aae3a26`。
- 使用当前完整工作区源码，包含9月14日管理员第三方配置只写不回显等修复；保留所有既有未提交功能改动。
- 版本及协议依赖、工作区锁文件统一到1.1.21。Expo兼容性检查提示配套补丁更新，已用 `expo install --fix` 同步SDK57补丁，未跨SDK大版本。

## 本次验证

- 更新依赖后重新运行 `npm run verify`：646项通过（Mobile387 / Gateway208 / Scripts51），类型检查及lint通过；工作区build通过。
- Expo依赖检查通过、原生配置同步、Android导出使用 `--clear`；Gradle `assembleRelease --rerun-tasks` 成功，439项任务实际执行。
- APK版本/包名/ARM64、签名有效且与1.1.19相同、HTTPS限制/非debug、INTERNET与CAMERA且无RECORD_AUDIO、TTS查询检查通过。
- ZIP完整性、ZIP及20个ARM64 ELF库16KiB对齐检查通过。
- 实際APK内检出本轮只写配置隐私文案，以及已有资料库/PDF/工具/朗读/分支功能文案；未检出已配置密钥与提供商地址、私有数据库或环境文件。该扫描不等于完整安全审计。
- 构建期间216个源码与配置文件hash保持一致。
- npm仍报告6个moderate依赖问题，未执行破坏性强制升级。

## 必须保留的限制

- 内置原先的临时公网网关，**当前不可用**。本轮复查 `check_gateway.mjs` 返回 `fetch failed`，不能声称本次获得了530 HTTP响应，更不能声称530已修复。
- 公网注册/聊天门禁未通过，`build_friend_android.ps1` 的门禁未修改。候选编译与正式朋友发布分开；没有将此包复制到公网分享目录。
- 没有新公网下载链接。可在本机取出APK文件，不应把本地文件路径说成朋友可直接下载的公网网址。
- ADB没有连接设备，未完成真机安装/覆盖升级/交互验收；不建议为了试装卸载旧版或清除聊天数据。未构建iOS。

## 证据

- `.run/repack-1.1.21-verify.log`
- `.run/repack-1.1.21-expo-fix.log`
- `.run/repack-1.1.21-build.log`（保留首次依赖检查失败及随后成功记录）
- `.run/repack-1.1.21-apk-verification.log`
- `.run/repack-1.1.21-public-check.log`
- `.run/repack-1.1.21-source-hashes.json`
- `artifacts/candidate-1.1.21/verification.json`、`SHA256SUMS.txt`、`README.txt`
