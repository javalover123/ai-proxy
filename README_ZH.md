<div align="center">

# AI Proxy

### 桌面级 AI API 流量代理 —— 拦截、解析、重放 Anthropic / OpenAI / Gemini 的每一次对话

[![Version](https://img.shields.io/github/v/release/lokistars/ai-proxy?color=blue&label=version)](https://github.com/lokistars/ai-proxy/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/lokistars/ai-proxy/releases)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-orange.svg)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/rust-1.96+-red.svg)](https://www.rust-lang.org/)

[English](README.md) | 中文

</div>

## 为什么选择 AI Proxy？

调用 AI API 时，你看到的只是输入和输出。但当 token 消耗异常、响应格式不符合预期、或者需要复现某个请求时，**你需要看到线路上真正发生了什么**。

**AI Proxy** 是一个基于 MITM 代理的桌面应用，专门为 AI API 流量设计。它不仅能拦截 HTTP/HTTPS 请求，还能**识别 AI 协议**（Anthropic Messages、OpenAI Chat Completions、OpenAI Responses、Google Gemini），将原始的 JSON body 解析为结构化的对话轮次、token 用量和思考块——让你像调试 REST API 一样调试 AI 调用。

- **AI 协议原生支持** — 不只是"看 JSON"，而是解析 turns、usage、thinking blocks，按对话语义展示
- **SSE 流式可视化** — 逐 chunk 追踪流式响应，实时看到模型"思考"和"输出"的每一步
- **MITM 零侵入** — 设置系统代理即可，无需修改任何代码或 SDK
- **请求重放** — 捕获的请求一键重放，快速复现和对比
- **脚本引擎** — 内置 JS 脚本支持，拦截/修改请求和响应
- **跨平台桌面应用** — Windows / macOS / Linux，基于 Tauri 2

## 界面截图

|                  流量日志                  |                  请求详情                  |
| :---------------------------------------: | :---------------------------------------: |
| ![流量日志](assets/screenshots/traffic.png) | ![请求详情](assets/screenshots/detail.png) |

|                  AI 对话                  |                  设置                  |
| :---------------------------------------: | :-----------------------------------: |
| ![AI 对话](assets/screenshots/ai-view.png) | ![设置](assets/screenshots/settings.png) |

## 功能特性

### 代理核心

- **HTTP/HTTPS 代理** — 基于 rama 的 MITM 反向代理，支持 TLS 解密
- **系统代理自动配置** — 启动/停止代理时自动设置/清除系统代理（Windows / macOS / Linux）
- **上游代理链** — 支持通过上游代理转发，兼容企业网络环境
- **SSL 证书管理** — 自签名 CA 证书生成、安装、导出，一键信任

### AI 协议解析

- **多协议归一化** — Anthropic Messages、OpenAI Chat Completions、OpenAI Responses、Google Gemini 统一解析为 `AiTurn` / `AiConversation` 结构
- **Token 用量追踪** — 自动提取 `usage` 字段（prompt_tokens / completion_tokens / total_tokens），支持流式和非流式
- **思考块捕获** — 识别并展示 Anthropic thinking blocks、OpenAI reasoning tokens
- **工具调用过滤** — 过滤/折叠 tool_use / tool_result 块，聚焦对话内容

### 流量管理

- **实时流量日志** — 所有经过代理的请求实时展示，支持按类型（AI / HTTP / SSE）和状态码筛选
- **请求详情面板** — 查看完整的 Request / Response Headers + Body，JSON 树形展开
- **SSE 流式展示** — 流式响应的每个 chunk 记录并展示
- **请求重放** — 选中任意请求，修改参数后重新发送（Postman 风格）
- **新建请求** — 内置请求构造器，手动构建 API 请求

### 脚本引擎

- **JS 脚本支持** — 基于 rquickjs 的嵌入式脚本引擎
- **请求/响应拦截** — 在脚本中修改 request headers、body，或 response body
- **条件匹配** — 按 URL 模式匹配触发脚本

### 用户界面

- **明暗主题** — Light / Dark / System 三态切换，OKLCH 色彩体系
- **内容字号设置** — 数据内容区域（body / JSON 树 / AI 对话）字号独立可调
- **中英双语** — 完整 i18n 支持（en / zh），系统托盘本地化
- **虚拟滚动** — 大量流量日志下保持流畅（virtua）
- **语法高亮** — JSON / XML / JavaScript body 使用 CodeMirror + Shiki 渲染

## 使用指南

### 1. 启动代理

点击左侧工具栏的**"启动"**按钮（或底部状态栏的开关）。代理默认监听 `127.0.0.1:5201`。

监听地址和端口可在 **Settings** 弹窗中修改——修改后需要**重启代理**才能生效。Settings 中还包含：
- **上游代理**：如果你的网络需要通过公司代理访问外网，在此配置上游地址
- **系统代理**：启动/停止时是否自动设置系统 HTTP 代理（Windows / macOS / Linux）
- **数据保留**：流量历史自动清理天数（默认 30 天）

启动后底部状态栏显示 `Running on 127.0.0.1:5201`，停止后恢复 `Stopped`。

### 2. 配置客户端

将 AI SDK 或 CLI 工具的 HTTP 代理指向代理地址：

```bash
# Claude Code / Codex / Gemini CLI — 设置环境变量
export HTTP_PROXY=http://127.0.0.1:5201
export HTTPS_PROXY=http://127.0.0.1:5201
```

```python
# Python OpenAI SDK
import httpx
client = OpenAI(http_client=httpx.Client(proxy="http://127.0.0.1:5201"))
```

```js
// Node.js — 通过环境变量或 SDK 的 httpAgent 配置
// export NODE_EXTRA_CA_CERTS=~/.ai-proxy/ca-cert.pem
```

> 由于代理使用自签名证书，HTTPS 请求需要客户端信任该证书。首次使用前需要完成下面的 SSL 配置步骤。

### 3. 安装 CA 证书（HTTPS 必需）

代理通过 MITM 解密 HTTPS 流量，需要客户端信任代理生成的 CA 证书。

点击左侧工具栏的**锁图标**或底部栏的锁图标打开 **SSL 配置弹窗**：

1. 首次使用时证书会自动生成
2. 点击**"安装 CA 证书"**，系统会弹出授权对话框：
   - **Windows**：自动安装到 `CurrentUser\Root` 信任库（Chrome/Edge 均信任）
   - **macOS**：安装到用户钥匙串，需输入密码授权
   - **Linux**：通过 `pkexec`/`sudo` 安装到系统 CA 目录
3. 安装完成后客户端即可正常发起 HTTPS 请求

如果不想在系统层面安装证书，也可以点击**"导出"**将 `.pem` 文件保存到本地，然后手动配置到对应 SDK 中（如 `NODE_EXTRA_CA_CERTS`、`REQUESTS_CA_BUNDLE` 等）。

### 4. 启用 AI 检测（三层配置）

要让代理识别并解析 AI API 流量，需要三个开关联动——它们在内部自动协调，但理解各自的职责有助于排查问题：

| 层级 | 配置位置 | 作用 |
|------|----------|------|
| **AI 检测总开关** | 底部状态栏 `AI` 标签 / AI 配置弹窗 | 控制是否对流量执行 AI 协议解析和归一化 |
| **URL 规则** | 左侧工具栏 📡 图标 → AI 配置弹窗 | 定义哪些 URL 匹配哪种 AI 厂商（OpenAI / Anthropic / Gemini） |
| **SSL 解密** | 底部栏 / SSL 配置弹窗 | MITM 解密 HTTPS 流量的域名白名单——不解密就无法看到加密 body |

**操作流程：**

1. **打开 AI 配置弹窗**：点击左侧工具栏的 📡 图标
2. **打开总开关**：弹窗顶部的 `AI Detection` 开关切换为 ON
3. **检查内置规则**：弹窗中预置了 7 条规则覆盖主流 API：
   - `api.openai.com/v1/chat/completions` → OpenAI
   - `api.openai.com/v1/responses` → OpenAI Responses
   - `api.anthropic.com/v1/messages` → Anthropic
   - `api.deepseek.com/v1/chat/completions` → OpenAI
   - `*.openai.azure.com/openai/deployments/*/chat/completions` → OpenAI
   - `generativelanguage.googleapis.com/v1beta/models/*` → Gemini
   - `openrouter.ai/api/v1/chat/completions` → 自动检测
4. **关闭弹窗**：点击 Save 保存——后端会**自动联动开启 SSL 解密**，并将所有启用规则的域名写入 SSL 白名单
5. **验证规则**：弹窗底部的匹配测试栏可以输入真实 URL 验证规则是否命中

**每个 URL 规则可以配置：**
- **Provider**：指定 AI 厂商（OpenAI / OpenAI Responses / Anthropic / Gemini），或设为 "Auto" 由后端自动检测 Content-Type 和请求路径
- **Sources**：标注请求来源（如 "Claude Code"、"自定义脚本"），配合 `Merge Header` 用于会话分组——同一个 session header 值的请求会被聚合到同一个 AI 对话视图中
- **启用/停用**：单独控制每条规则，无需删除

**URL 匹配规则**：候选串为 `host + path`（去掉 scheme、query、默认端口），支持 `*` 和 `?` 通配符。例如规则 `api.openai.com/v1/chat/*` 可命中 `https://api.openai.com/v1/chat/completions?model=gpt-5`。

### 5. 查看 AI 对话

配置完成后，通过代理发出的 AI API 请求会自动：

1. **识别协议** → 按 URL 规则匹配 Provider
2. **解析 Body** → 提取对话轮次（user/assistant/system）、token 用量、thinking blocks
3. **流式追踪** → SSE 响应逐 chunk 累积，实时更新对话内容
4. **会话聚合** → 同一 session header 的多次请求归入一个对话视图

在流量日志中，AI 请求带有厂商颜色圆点标识。双击某条请求进入详情面板，切换到**AI 视图标签页**即可看到结构化的对话展示——包括每轮角色、内容、token 消耗、思考块（如果有）。

### 6. 停止代理

再次点击启动按钮，代理停止，所有网络设置恢复原状。已捕获的流量历史保留在本地 SQLite 数据库中，可在下次启动后继续查看和重放。

## 配置文件

配置文件位于 `~/.ai-proxy/setting.json`（可通过环境变量 `AI_PROXY_HOME` 覆盖根目录）：

```jsonc
{
  "proxy": {
    "listen_host": "127.0.0.1",  // 代理监听地址
    "listen_port": 5201,          // 代理监听端口
    "upstream_proxy_enabled": true, // 上游代理开关，关闭则直连
    "upstream_proxy_host": "",    // 上游代理地址，留空则直连
    "upstream_proxy_port": 0      // 上游代理端口
  },
  "ui": {
    "theme": "system",            // light / dark / system
    "language": "zh",             // en / zh
    "prose_font_size": "normal"   // small / normal / large
  },
  "log": {
    "level": "info",
    "dir": null,
    "rolling": "daily"
  }
}
```

## 常见问题

<details>
<summary><strong>为什么我的 AI 客户端连接不上代理？</strong></summary>

检查：① 代理是否已启动（底部状态栏显示 "Running on 127.0.0.1:5201"）；② 客户端是否配置了正确的代理地址（`127.0.0.1:5201`）；③ 如果是 HTTPS 请求，是否已经信任了 CA 证书。
</details>

<details>
<summary><strong>HTTPS 请求显示"证书错误"怎么办？</strong></summary>

在 SSL 配置弹窗中导出 CA 证书（`.pem` 格式），然后在你的系统或 SDK 中信任它。对于 Python SDK，可以设置 `verify=False`（仅限开发环境）；对于 Node.js，设置 `NODE_TLS_REJECT_UNAUTHORIZED=0`。
</details>

<details>
<summary><strong>代理会影响正常上网吗？</strong></summary>

不会。启动代理后，系统代理会被设置为 `127.0.0.1:5201`，但代理仅转发已配置的 AI API 域名的请求。停止代理时系统代理自动恢复。你也可以关闭自动系统代理设置，只对特定工具单独配置代理。
</details>

<details>
<summary><strong>我的数据存储在哪里？</strong></summary>

- **配置文件**：`~/.ai-proxy/setting.json`
- **CA 证书**：`~/.ai-proxy/ca-cert.pem`
- **脚本文件**：`~/.ai-proxy/scripts/`
- **流量历史**：`~/.ai-proxy/traffic.db`（SQLite）
</details>

<details>
<summary><strong>支持哪些 AI 协议？</strong></summary>

目前支持四种协议：
- **Anthropic Messages** — `/v1/messages`，system + messages[] + content blocks
- **OpenAI Chat Completions** — `/v1/chat/completions`，messages[] + choices[]
- **OpenAI Responses** — `/v1/responses`，input[] + output[]
- **Google Gemini** — `generateContent`，contents[] + candidates[]

新增协议只需实现 `AiProtocol` trait + 在 `Provider` 枚举加一个变体，编译器保证全覆盖。
</details>

<details>
<summary><strong>脚本引擎能做些什么？</strong></summary>

脚本使用 JavaScript（rquickjs 运行时），可以拦截请求和响应。示例：

```js
// 修改请求 body
function onRequest(ctx) {
    const body = JSON.parse(ctx.request.body);
    body.max_tokens = 1000;
    ctx.request.body = JSON.stringify(body);
    return ctx;
}

// 记录响应
function onResponse(ctx) {
    console.log("Status:", ctx.response.status);
    return ctx;
}
```
</details>

<details>
<summary><strong>代理拦截到 AI 流量后，我如何收到通知？</strong></summary>

无需额外配置——所有拦截到的流量会实时出现在流量日志面板中。AI 请求带有厂商颜色圆点标识。在详情面板中切换到 AI 视图标签页即可看到结构化的对话内容。
</details>

## 架构设计

<details>
<summary><strong>架构概览</strong></summary>

### 设计原则

```
┌─────────────────────────────────────────────────────────────┐
│                   前端 (React 19 + TypeScript)               │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐    │
│  │  features/  │  │    hooks/     │  │  Tauri invoke()   │    │
│  │  (UI 视图)  │──│  (业务逻辑)   │──│  (IPC 到 Rust)   │    │
│  └─────────────┘  └──────────────┘  └──────────────────┘    │
└────────────────────────┬────────────────────────────────────┘
                         │ Tauri IPC (invoke + emit)
┌────────────────────────▼────────────────────────────────────┐
│                    后端 (Tauri + Rust)                       │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐    │
│  │  commands/  │  │   proxy/     │  │    config/        │    │
│  │  (API 层)   │──│ (Tower Srv)  │──│   (配置管理)      │    │
│  └─────────────┘  └──────────────┘  └──────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

**核心设计模式**

- **Tower Service 管道** — 代理请求经过分层处理：MITM TLS → AI 协议解析 → 流量录制 → 脚本拦截 → SSE 帧切分 → 转发上游
- **AI 协议归一化** — `Provider` 枚举 + `AiProtocol` trait，多协议 → 统一 `AiConversation` 结构 → 前端一致渲染
- **事件驱动** — Rust 后端通过 Tauri `emit` 向前端推送实时流量事件，前端 `useProxyEvents` hook 接收
- **流式/非流式统一处理** — SSE 响应逐 chunk 推送，非流式响应完整收集后一次性输出；两者共享同一套 AI 解析管线
- **零拷贝预解析** — 请求到达时预解析 JSON body，后续各层复用解析结果，避免重复 `serde_json::from_slice` 调用

**核心模块**

| 模块 | 职责 |
|------|------|
| `proxy/mitm.rs` | MITM TLS 解密、CONNECT 隧道 |
| `proxy/layer/` | Tower Layer 管线（direct / traffic_record / script） |
| `proxy/ai/` | AI 协议识别、归一化、SSE 流式解析 |
| `proxy/events.rs` | 流量事件构造与向前端推送 |
| `proxy/record.rs` | SQLite 流量历史持久化 |
| `script/` | rquickjs 脚本引擎封装 |
| `config/` | 配置加载、存储、热更新 |

</details>

<details>
<summary><strong>项目结构</strong></summary>

```
├── src/                          # 前端 (React 19 + TypeScript)
│   ├── main.tsx                  # 入口文件
│   ├── App.tsx                   # 根组件：路由、全局状态、弹窗
│   ├── index.css                 # Tailwind 4 + 主题变量 (OKLCH)
│   ├── components/
│   │   ├── ui/                   # shadcn/ui 原子组件
│   │   ├── icons/                # 自定义图标
│   │   └── json-tree/            # JSON 树形展示组件
│   ├── features/
│   │   ├── proxy/                # 代理视图 + 流量日志
│   │   ├── new-request/          # Postman 风格请求构造器
│   │   ├── detail-panel/         # 请求详情面板
│   │   ├── ai-view/              # AI 对话视图
│   │   ├── ai-config/            # AI 检测配置弹窗
│   │   ├── settings/             # 设置弹窗
│   │   ├── ssl-config/           # SSL 配置弹窗
│   │   ├── script-config/        # 脚本配置弹窗
│   │   ├── title-bar/            # 自定义标题栏 + 标签页
│   │   ├── tool-bar/             # 左侧图标工具栏
│   │   ├── bottom-bar/           # 底部状态栏
│   │   └── about/                # 关于弹窗
│   ├── hooks/                    # 跨 feature 复用 hooks
│   ├── lib/                      # 工具函数
│   ├── locales/                  # 翻译文件 (en.json / zh.json)
│   └── types/                    # TypeScript 类型定义
├── src-tauri/                    # 后端 (Rust)
│   └── src/
│       ├── main.rs               # 二进制入口
│       ├── lib.rs                # Tauri 应用构建、AppState、事件
│       ├── commands/             # Tauri invoke 命令
│       ├── config/               # 配置加载与存储
│       ├── storage/              # SQLite 数据访问层
│       ├── proxy/                # MITM 代理核心
│       │   ├── ai/               # AI 协议解析引擎
│       │   └── layer/            # Tower Layer 管线
│       ├── script/               # rquickjs 脚本引擎
│       └── tray.rs               # 系统托盘
├── scripts/                      # 开发脚本
└── vite.config.ts
```

</details>

## 许可证

MIT © lokistars
