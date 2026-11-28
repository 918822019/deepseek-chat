# chat-demo

[English](README.md) | 简体中文

基于 DeepSeek API 的静态聊天示例。无需应用后端，浏览器直接请求配置的 API 服务。

本项目可从同一份前端构建 Web、Windows 桌面应用和 Android APK。自托管、打包和 API 设置见[三端构建与分发](docs/distribution.zh-CN.md)。

[打开在线版](https://918822019.github.io/deepseek-chat/) · [下载各平台版本](https://github.com/918822019/deepseek-chat/releases)

首次使用时，请在设置中填写 API Key。DeepSeek 提供[上游网页示例](https://deepseek-ai.github.io/chat-demo/)和[上游发布包](https://github.com/deepseek-ai/deepseek-chat-demo/releases)。

## 运行

准备 Node.js 22.12+ 和 pnpm：

```sh
git clone https://github.com/918822019/deepseek-chat.git
cd deepseek-chat
pnpm install
pnpm dev
```

打开 http://localhost:8090 。

生成静态产物：

```sh
pnpm build
```

产物位于 `dist/`，可部署到静态服务器，也可直接打开 `dist/index.html`。直接打开时，浏览器和 API 服务需允许 `file://` 页面的存储与跨域请求。

## 功能

- 多会话、自动标题、重命名与删除；编辑提问、重新生成和切换消息分支。
- 流式回答、深度思考、智能搜索、链接阅读与来源引用；支持停止和符合条件的继续生成。
- 附件上传、粘贴与拖拽，语音输入和回复朗读；移动端录音时输入框首行显示实时频谱。
- Markdown、代码高亮、KaTeX 公式和 Mermaid 图表。
- 简体中文与英文、浅色与深色主题、移动端布局、位置设置、历史导入导出。

## Windows 和 macOS 任务工作区

在「新建任务」选择本地文件夹、勾选资料并填写目标。工作台可读取 DOCX 正文和表格、XLSX 工作表中的单元格，以及 Markdown、TXT、CSV、TSV、JSON。Office 文件每份最多 16 MB，文本文件每份最多 1 MB，每次任务提取的文本合计最多 1 MB。勾选资料会发送给当前配置的模型，长资料会分批处理。

切换到聊天时任务会继续执行。可在「任务记录」查看进度、预览成果或基于上一版继续修改。Markdown 会保存到资料目录的「工作台成果」子目录。退出应用会中断正在生成的任务，重新打开后可从记录中重试。已生成的正文保存在本机，写文件失败时可单独重试保存。

### 在 Windows 上打包 Apple 芯片版

打开 [Build macOS DMG (Apple silicon)](https://github.com/918822019/deepseek-chat/actions/workflows/build-macos.yml)，点 **Run workflow**，选择 `main` 并运行。成功后，在该次运行的 **Artifacts** 下载 `Desktop-Workspace-macos-arm64`，解压得到 DMG。工作流会在 Apple 芯片的 Mac 上挂载镜像，读取 DOCX 和 XLSX 测试资料，使用本地模拟模型生成 Markdown，并验证系统打开文档和访达定位。

当前是适用于 macOS 14 及以上的 Apple 芯片测试版，采用本地签名，尚未进行 Developer ID 签名和 Apple 公证。在 Mac 上打开 DMG，将 Desktop Workspace 拖入「应用程序」。首次使用时在「设置」填写模型的 API Key。若系统拦截首次打开，可按 [Apple 关于打开受信任应用的说明](https://support.apple.com/zh-cn/102445)操作。

从 Apple 芯片 Mac 本地构建时，安装 Xcode Command Line Tools、.NET 10 SDK、Node.js 24 和 pnpm，依次执行 `pnpm install --frozen-lockfile` 和 `pnpm macos:build`。磁盘镜像位于 `release/macos/`。

## 数据

API Key 和设置保存在浏览器 localStorage，会话及附件原件保存在 IndexedDB，本地数据按浏览器用户配置和站点源（origin）隔离。发送对话、上传附件和使用语音功能时，相应内容会提交给配置的 API 服务。

设置中的历史导入导出使用 ZIP 格式。导入会在确认并校验成功后替换全部本地会话和附件；导出包含会话与本地可用的图片原件，不包含 API Key、设置或非图片附件原件。格式与保留范围见[历史导入导出](src/services/chat/history/README.md)。

设置 → 数据管理 → 删除所有对话，会在确认后清空全部本地会话、附件原件和未发送的草稿，停止正在生成的回复并回到新对话。API Key 和其他设置保留，已上传到 API 服务的文件不受影响。

## 开发

| 命令          | 用途                |
| ------------- | ------------------- |
| `pnpm dev`    | 启动开发服务器      |
| `pnpm build`  | 构建到 `dist/`      |
| `pnpm type`   | TypeScript 类型检查 |
| `pnpm lint`   | oxlint 检查         |
| `pnpm format` | oxfmt 格式化        |

[rspack.config.ts](rspack.config.ts) 默认连接 `https://api.deepseek.com`。`createConfig({ apiOrigin, devServer })` 支持自定义 API 地址和开发服务器代理。

聊天默认使用 `deepseek-flash`，通过 Anthropic 兼容的 Messages / Files API 通信；语音使用 ASR / TTS 接口。请求使用搜索、链接阅读、标题和 `latest_reminder` 等扩展，接入服务需支持相应能力。附件实际支持的格式以服务端校验为准。

```text
src/
  app/                 应用布局、主题与全局样式
  components/          聊天、设置、Markdown 等界面组件
  i18n/                中英文文案
  services/
    api/               API 请求、SSE 与协议类型
    chat/              会话、消息分支、本地存储与历史导入导出
    markdown/          Markdown 解析、代码高亮与图表
    speech/            录音与朗读
  utils/               通用工具
```

## 许可证

[MIT](LICENSE)。构建会将许可证复制到 `dist/LICENSE`，分发时请一并保留；第三方依赖遵循各自的许可证。
