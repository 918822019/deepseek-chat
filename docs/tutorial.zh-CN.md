# 教程：把聊天 Demo 接到 NVIDIA / ModelScope 等免费 API

本项目 fork 自 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)（MIT 协议），在原版基础上增加了 **OpenAI 兼容后端** 支持，可以直接使用 NVIDIA NIM、ModelScope 等提供的免费额度。

## 1. 原理

原版前端只会说 DeepSeek 的 Anthropic 兼容协议（`/anthropic/v1/messages`）。我们没有改 UI 和存储层，只在请求层加了一个适配器：

```
UI / 会话存储  ──(Anthropic 事件格式)──  client.ts
                                          ├─ DeepSeek：原样请求
                                          └─ 其他后端：openai.ts 适配器
                                               请求 → /chat/completions
                                               SSE 分片 → 还原为 Anthropic 流式事件
```

| 文件 | 作用 |
|---|---|
| `src/services/api/openai.ts` | 请求/流式事件转换；支持 `reasoning_content`、`reasoning` 字段和 `<think>` 标签 |
| `src/services/api/providers.ts` | 后端预设（地址、默认模型），新增后端改这里 |
| `src/components/settings/ProviderField.tsx` | 设置页的后端选择 UI |
| `src/services/api/client.ts` | 根据当前后端选择走哪条路径 |
| `proxy/server.mjs` | 自托管服务：托管静态文件并转发 NVIDIA 请求 |

## 2. 获取免费 Key

- **NVIDIA NIM**：登录 <https://build.nvidia.com>，在任意模型页点 “Get API Key”，Key 以 `nvapi-` 开头。可用模型以你账号的 `GET /v1/models` 返回为准。
- **ModelScope（魔搭）**：登录 <https://modelscope.cn>，在“访问令牌”中创建 token。接口地址 `https://api-inference.modelscope.cn/v1`。

> 免费额度和模型列表会变，以官网为准。**不要把 Key 提交到仓库或贴到公开场合。**

## 3. 本地运行

需要 Node.js 20.19+（或 22.12+）和 pnpm。

```bash
git clone <你的仓库地址>
cd <仓库目录>
pnpm install
pnpm dev          # http://localhost:8090
```

打开页面 → 设置 → 数据管理页：

1. “模型后端”选择 `NVIDIA NIM` 或 `ModelScope`。
2. 如有需要，修改 Base URL 和模型 ID（留空使用预设默认值）。
3. 填入 API Key，点确认（会先请求 `GET /models` 校验）。
4. 回到聊天界面开始对话。

## 4. 为什么 NVIDIA 需要代理（CORS）

NVIDIA 的接口不返回 `Access-Control-Allow-*` 头，浏览器直接请求会被拦截。所以：

- 开发时：`rspack.config.ts` 里的 `devServer.proxy` 会把 `/proxy/nvidia/*` 转发到 `https://integrate.api.nvidia.com`，预设的 Base URL 就是 `/proxy/nvidia/v1`。
- 部署时：见下一节。
- ModelScope 实测允许浏览器跨域（返回 `Access-Control-Allow-Origin: *`），**直连即可，不需要代理**。它的模型列表是公开的，`GET https://api-inference.modelscope.cn/v1/models` 不需要 Key，可以先查再填模型 ID。

代理只转发 `Authorization`、`Content-Type`、`Accept` 三个请求头，不保存也不记录 Key。

## 5. 部署

```bash
# Windows 下 package.json 里的 build 脚本用了 rm -rf，请改用：
#   Remove-Item -Recurse -Force dist; $env:NODE_ENV='production'; pnpm exec rspack build -c rspack.config.ts
# macOS / Linux：
pnpm build

PORT=8080 node proxy/server.mjs     # 托管 dist/ 并提供 /proxy/nvidia 转发
```

注意：

- 直接把 `dist/` 放到纯静态托管（GitHub Pages 等）时没有转发路由，NVIDIA 会因 CORS 失败。此时要么用 `proxy/server.mjs`，要么自建 Cloudflare Worker 等转发服务，然后在设置里把 Base URL 改成你的转发地址。
- 对外公开部署时，让每位用户填自己的 Key，不要把你的 Key 写进前端代码。
- 给公共代理加上来源限制和限流，避免被滥用。

## 6. 功能差异

使用非 DeepSeek 后端时：

| 功能 | 状态 |
|---|---|
| 流式对话、Markdown、代码高亮、公式、Mermaid | 可用 |
| 思考过程展示 | 模型输出 `reasoning_content` / `reasoning` / `<think>` 时可用 |
| 多会话、分支、编辑重答、导入导出 | 可用 |
| 联网搜索、链接阅读 | 不可用（依赖 DeepSeek 服务端工具） |
| 图片 / 文档上传 | 不可用（依赖 DeepSeek Files API） |
| 语音输入 / 朗读 | 不可用（依赖 DeepSeek 工具接口） |
| 会话自动标题 | 不可用 |

## 7. 添加新的后端

在 `src/services/api/providers.ts` 的 `PROVIDERS` 数组里加一项，并把 `ProviderId` 类型补上：

```ts
{ id: 'myhost', label: 'My Host', baseUrl: 'https://example.com/v1', model: 'some-model' },
```

只要对方兼容 OpenAI `/chat/completions` 的流式接口即可，无需改动其他代码。

## 8. 常见问题

| 现象 | 原因与处理 |
|---|---|
| 请求报网络错误 | 多半是 CORS，改用代理，或检查网络 |
| 404 | 模型 ID 不存在。用 `GET {baseUrl}/models` 查账号可用模型 |
| 401 | Key 错误或已失效 |
| 429 | 免费额度限流，稍后重试或换模型 |
| 回答为空，只有思考 | `max_tokens` 被思考耗尽，或模型只输出推理内容 |
| 某些模型长时间无响应 | 免费端点排队，换一个模型试试 |

## 9. 协议与致谢

- 原项目：DeepSeek [chat-demo](https://github.com/deepseek-ai/chat-demo)，MIT 协议，© 2026 DeepSeek。
- 本仓库保留原 `LICENSE` 文件及版权声明；新增部分同样以 MIT 发布。
- 本项目与 DeepSeek、NVIDIA、ModelScope 没有隶属或官方背书关系。
