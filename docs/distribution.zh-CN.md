# Web、Windows 和 Android 构建

三个版本使用同一套聊天界面。每端首次运行时在设置中选择模型后端并填写自己的 API Key。NVIDIA NIM 和 ModelScope 默认使用各自的官方 API。NVIDIA NIM 可在 **设置 → 数据管理** 中选择 **连接方式 → 使用转发**，ModelScope 可在 Base URL 中填写自己的转发地址。设置和对话保存在各端自己的本地空间，可通过设置中的历史 ZIP 导入和导出迁移对话。导入会替换目标端的本地历史，API Key 需要在目标端重新填写。

在项目目录使用 Node.js 22.12+ 和 pnpm 安装依赖。项目的 Pages 工作流使用 Node.js 24。

```sh
pnpm install --frozen-lockfile
```

## Web

在 Windows x64 上解压完整的 `Chat-Demo-版本-web.zip`，双击 `Open Chat Demo.exe`。它会在后台启动仅供本机访问的服务并用默认浏览器打开 `http://localhost:8080`，同时提供 NVIDIA 转发。关闭网页后服务继续运行，需要停止时双击 `Stop Chat Demo.exe`。两个 EXE 都不会创建命令窗口，压缩包已内置运行环境。

从源码重新生成这个 ZIP 需要 Go 工具链：

```sh
pnpm web:build
```

ZIP 位于 `release/`。首次打包会下载并校验 Windows x64 的 Node.js 运行环境。

### 静态部署与自托管

```sh
pnpm build
pnpm start
```

`dist/` 是可部署的静态站点。可以沿用仓库里的 GitHub Pages 工作流，或部署到自己的 HTTPS 静态站点。`pnpm start` 在本地通过 `http://localhost:8080` 提供站点和 NVIDIA 转发。自托管时保留 `dist/` 与 `proxy/server.mjs` 的相对位置，并通过支持流式响应的 HTTPS 反向代理对外提供服务。

纯静态托管可以直连允许跨域请求的 API 服务。NVIDIA NIM 官方接口在浏览器直连遇到跨域限制时，可以在设置中选择 **使用转发**，也可在 Base URL 中填写自定义的 NVIDIA 转发地址。

### GitHub Pages 与 Releases

在自己的发布仓库中，将 **Settings → Pages → Source** 设为 **GitHub Actions**。现有工作流会构建并部署 `dist/`，发布结果和网址可在 **Actions → Deploy GitHub Pages** 中查看。

在线版默认使用 NVIDIA NIM 和 ModelScope 各自的官方地址。NVIDIA NIM 提供 **官方直连** 和 **使用转发** 两种连接方式。选用内置转发时，填写自己的 NVIDIA API Catalog Key 即可。ModelScope 可以在 Base URL 中填写自定义转发地址。

自行部署时，将 [NVIDIA 转发模块](../proxy/nvidia-worker.mjs)部署到 Cloudflare Workers。将 Worker 的 `PAGES_ORIGIN` 设为网页的来源（如 `https://918822019.github.io`），启用 `enable_request_signal` 以在客户端断开时取消请求。若用现有域名下的独立路径，把该前缀设为 Worker 的 `PATH_PREFIX`（如 `/deepseek-nim`），并为前缀下的 `/v1/models` 和 `/v1/chat/completions` 建立对应路由。在发布仓库中把 Actions 变量 `CHAT_NVIDIA_BASE_URL` 设为转发地址加 `/v1`，然后重新部署 Pages。这个变量配置的是 **使用转发** 选项的地址。转发只接受指定网页来源的模型列表和聊天请求，请求使用用户自己的 `nvapi-` Key，转发端无需配置共用 Key。便携 Web 包和 Windows 桌面版各自提供本地转发。

在 **Releases** 中为自己的版本建立发布草稿。标签应指向构建下载包的提交。上传 `release/` 中的 Web ZIP、Windows 安装包、Android APK 和对应的 `SHA256SUMS.txt`。使用调试签名 APK 或未做代码签名的 Windows 安装包时，将本次发布标记为预发布并在说明中写清楚。

## Windows 桌面应用

准备 Windows 10 或 11 x64、.NET SDK 8 或更新版本，以及 NSIS 3。安装 NSIS 后可将 `makensis.exe` 加入 PATH，或用 `MAKENSIS_PATH` 指定它。运行以下命令生成安装程序。

```sh
pnpm desktop:build
```

安装程序位于 `release/windows/`。Windows 版使用系统的 Microsoft Edge WebView2 Evergreen 运行时，安装包包含微软签名的在线引导程序。机器缺少 WebView2 时，安装过程会联网补装；已经有 WebView2 时可直接安装。应用需要 Windows 的 .NET Framework 4.8。`pnpm desktop:dev` 可以构建并直接打开应用，有 WebView2 即可运行。选择 **使用转发** 时，桌面应用直接向 NVIDIA 发出请求并流式返回结果。

WebView2 版和之前的 Electron 版各自保存数据，可以并存。切换时，在旧版的 **设置 → 数据管理** 导出历史 ZIP，在新版本导入，再重新填写自己的 API Key。

## Android APK

准备 JDK 21 和 Android SDK Platform 36，配置 `JAVA_HOME` 和 `ANDROID_HOME`。如果使用 Android Studio，请将 Gradle JDK 设置为 21。手机需要 Android 7 或更新版本，以及 Chromium 105 或更新版本的系统 WebView。

```sh
pnpm android:build
```

`release/android/` 下的 `*-debug.apk` 可侧载到手机或模拟器。申请麦克风权限后可使用语音输入。历史导出由 Android 系统文件选择器保存 ZIP。

Android 版的 **使用转发** 选项使用本项目的 HTTPS 转发，选中后填写自己的 NVIDIA API Catalog Key 即可。可以在 Base URL 中手填手机可访问的 HTTPS 转发地址，或在构建前设置 `CHAT_NVIDIA_BASE_URL` 来更换预置地址。自建 Worker 时，将 `ANDROID_ORIGIN` 设为应用来源 `https://chat-demo.localhost`，或在自托管时使用已允许该来源的 `proxy/server.mjs`。

正式分发前运行 `pnpm android:sync`，在 Android Studio 中打开 `android/`，使用 **Build → Generate Signed Bundle / APK** 和发布方的密钥生成签名包。正式发布时确定应用 ID 并在每次更新时递增 `android/app/build.gradle` 中的 `versionCode`。同一发布渠道上的升级包需要沿用签名密钥。
