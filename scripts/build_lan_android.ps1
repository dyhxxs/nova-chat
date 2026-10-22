param(
  [string]$GatewayUrl = '',
  [string]$GatewayHost = '',
  [int]$Port = 8787,
  [switch]$AllowHttpIp
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$mobileDir = Join-Path $projectRoot 'apps\mobile'
$androidDir = Join-Path $mobileDir 'android'
$artifactDir = Join-Path $projectRoot 'artifacts'
$environmentNames = @('EXPO_PUBLIC_GATEWAY_URL', 'ALLOW_CLEARTEXT', 'ANDROID_HOME', 'ANDROID_SDK_ROOT')
$originalEnvironment = @{}
foreach ($name in $environmentNames) { $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }

try {
  $appConfig = Get-Content -LiteralPath (Join-Path $mobileDir 'app.json') -Raw -Encoding utf8 | ConvertFrom-Json
  $appVersion = [string]$appConfig.expo.version
  $appVersionCode = [int]$appConfig.expo.android.versionCode
  if ([string]::IsNullOrWhiteSpace($appVersion)) { throw 'app.json 中缺少 Expo 版本号。' }
  if ($appVersionCode -le 0) { throw 'app.json 中缺少有效的 Android versionCode。' }

  $autoSelectedGateway = [string]::IsNullOrWhiteSpace($GatewayUrl)
  if ($autoSelectedGateway) {
    if ([string]::IsNullOrWhiteSpace($GatewayHost)) {
      $GatewayHost = Get-NetIPConfiguration |
        Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address -and $_.NetAdapter.Status -eq 'Up' } |
        Select-Object -First 1 -ExpandProperty IPv4Address |
        Select-Object -ExpandProperty IPAddress
    }
    if ([string]::IsNullOrWhiteSpace($GatewayHost)) { throw '无法自动找到局域网 IPv4 地址。' }
    $GatewayUrl = 'http://' + $GatewayHost + ':' + $Port
  }

  try { $gatewayUri = [System.Uri]$GatewayUrl } catch { throw "GatewayUrl 不是有效 URL：$GatewayUrl" }
  if (-not $gatewayUri.IsAbsoluteUri -or $gatewayUri.Scheme -notin @('http', 'https') -or [string]::IsNullOrWhiteSpace($gatewayUri.Host)) {
    throw "GatewayUrl 必须是包含主机名的 http:// 或 https:// 地址：$GatewayUrl"
  }
  if (-not [string]::IsNullOrWhiteSpace($gatewayUri.UserInfo)) { throw 'GatewayUrl 不能包含用户名或密码。' }
  if ($gatewayUri.AbsolutePath -ne '/' -or -not [string]::IsNullOrWhiteSpace($gatewayUri.Query) -or -not [string]::IsNullOrWhiteSpace($gatewayUri.Fragment)) {
    throw 'GatewayUrl 只能包含协议、主机名、可选端口，不能包含路径、查询参数或片段。'
  }
  $gatewayUrl = $gatewayUri.GetLeftPart([System.UriPartial]::Authority).TrimEnd('/')
  $usesCleartext = $gatewayUri.Scheme -eq 'http'
  if ($usesCleartext -and -not $autoSelectedGateway -and -not $AllowHttpIp) {
    throw '手动指定 HTTP 网关时必须显式指定 -AllowHttpIp。自动发现的局域网地址默认属于 LAN 测试构建。'
  }
  $env:EXPO_PUBLIC_GATEWAY_URL = $gatewayUrl
  $env:ALLOW_CLEARTEXT = if ($usesCleartext) { 'true' } else { 'false' }
  if ($usesCleartext) { Write-Warning 'LAN 构建使用明文 HTTP；只应在受信任网络或临时公网 IP 验收中使用。' }

  if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = 'D:\Android\Sdk' }
  if (-not $env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME }
  if (-not (Test-Path -LiteralPath $env:ANDROID_HOME)) { throw "找不到 Android SDK: $($env:ANDROID_HOME)" }

  Push-Location $mobileDir
  try {
    & npx expo install --check
    if ($LASTEXITCODE -ne 0) { throw 'Expo 依赖版本不兼容。' }
    & npx expo prebuild --platform android --no-install
    if ($LASTEXITCODE -ne 0) { throw 'Android 原生配置同步失败。' }
    $preflight = Join-Path $projectRoot ('.run\lan-android-preflight-' + $appVersion)
    & npx expo export --platform android --clear --output-dir $preflight
    if ($LASTEXITCODE -ne 0) { throw 'Android 应用代码重新打包失败。' }
  } finally { Pop-Location }

  Push-Location $androidDir
  try {
    $gradleArgs = @(':app:assembleRelease', '--rerun-tasks', '-PreactNativeArchitectures=arm64-v8a', ('-PnovaVersionCode=' + $appVersionCode), ('-PnovaVersionName=' + $appVersion), '--console=plain', '--no-daemon')
    & .\gradlew.bat @gradleArgs
    if ($LASTEXITCODE -ne 0) { throw 'Android LAN APK 构建失败。' }
  } finally { Pop-Location }

  $source = Join-Path $androidDir 'app\build\outputs\apk\release\app-release.apk'
  if (-not (Test-Path -LiteralPath $source)) { throw "没有找到构建产物: $source" }
  New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
  $target = Join-Path $artifactDir ('NovaChat-' + $appVersion + '-android-arm64-lan.apk')
  Copy-Item -LiteralPath $source -Destination $target -Force
  $hash = Get-FileHash -LiteralPath $target -Algorithm SHA256

  $buildToolsRoot = Join-Path $env:ANDROID_SDK_ROOT 'build-tools'
  $tools = Get-ChildItem -LiteralPath $buildToolsRoot -Directory |
    Sort-Object { try { [version]$_.Name } catch { [version]'0.0.0' } } -Descending |
    Select-Object -First 1
  if (-not $tools) { throw 'Android SDK 中没有找到 build-tools。' }
  $aaptPath = Join-Path $tools.FullName 'aapt.exe'
  $apkSignerPath = Join-Path $tools.FullName 'apksigner.bat'
  $zipAlignPath = Join-Path $tools.FullName 'zipalign.exe'
  foreach ($tool in @($aaptPath, $apkSignerPath, $zipAlignPath)) { if (-not (Test-Path -LiteralPath $tool)) { throw "找不到 Android 构建工具: $tool" } }

  $badging = (& $aaptPath dump badging $target) -join [Environment]::NewLine
  if ($LASTEXITCODE -ne 0) { throw '无法读取 APK 元数据。' }
  $permissions = (& $aaptPath dump permissions $target) -join [Environment]::NewLine
  if ($LASTEXITCODE -ne 0) { throw '无法读取 APK 权限。' }
  $manifest = (& $aaptPath dump xmltree $target AndroidManifest.xml) -join [Environment]::NewLine
  if ($LASTEXITCODE -ne 0) { throw '无法读取 APK Manifest。' }
  if (-not $badging.Contains("package: name='com.novachat.mobile'")) { throw 'APK 包名不正确。' }
  if (-not $badging.Contains("versionCode='$appVersionCode'") -or -not $badging.Contains("versionName='$appVersion'")) { throw 'APK 版本信息不正确。' }
  if (-not $badging.Contains("native-code: 'arm64-v8a'")) { throw 'APK 不是 ARM64 架构。' }
  if (-not $permissions.Contains('android.permission.INTERNET') -or -not $permissions.Contains('android.permission.CAMERA') -or -not $permissions.Contains('android.permission.RECORD_AUDIO')) { throw 'APK 权限验证失败：当前版本需要 INTERNET、CAMERA、RECORD_AUDIO。' }
  if ($usesCleartext -and $manifest -notmatch 'usesCleartextTraffic[^\r\n]*0xffffffff') { throw 'HTTP IP 包未开启 Android 明文网络。' }
  if (-not $usesCleartext -and $manifest -match 'usesCleartextTraffic[^\r\n]*0xffffffff') { throw 'HTTPS 包不得允许明文 HTTP。' }
  if ($manifest -match 'android:debuggable[^\r\n]*0xffffffff') { throw 'Release APK 不得开启调试。' }

  & $apkSignerPath verify $target | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'APK 签名验证失败。' }
  & $zipAlignPath -c -P 16 4 $target | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'APK zipalign 验证失败。' }

  $transportNote = if ($usesCleartext) { 'WARNING: Gateway transport uses cleartext HTTP; use only for LAN or explicitly approved IP testing.' } else { 'Gateway transport verified: HTTPS.' }
  @(
    ('Nova Chat ' + $appVersion + ' Android ARM64 LAN/Test'),
    'Package: com.novachat.mobile',
    ('Version name: ' + $appVersion),
    ('Version code: ' + $appVersionCode),
    ('Gateway URL: ' + $gatewayUrl),
    ('APK: ' + $target),
    ('Bytes: ' + (Get-Item -LiteralPath $target).Length),
    ('SHA256: ' + $hash.Hash),
    'Permissions verified: INTERNET, CAMERA, RECORD_AUDIO',
    'Architecture verified: arm64-v8a only',
    'Signature and 16 KiB zip alignment verified',
    $transportNote
  ) | Set-Content -LiteralPath (Join-Path $artifactDir ('NovaChat-' + $appVersion + '-LAN-INFO.txt')) -Encoding utf8

  Write-Host ('Android APK 已生成: ' + $target)
  Write-Host ('预置网关地址: ' + $gatewayUrl)
  Write-Host ('SHA256: ' + $hash.Hash)
} finally {
  foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], 'Process') }
}
