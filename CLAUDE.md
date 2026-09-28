# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

ai-proxy 是一个基于 Tauri 2 的桌面应用，后端为 Rust MITM 反向代理，前端为 React + Vite。核心功能是将请求转发到上游 API 并拦截记录 HTTP/HTTPS 流量，支持 SSE 流式响应的逐 chunk 日志输出，通过 GUI 展示流量日志、代理控制与设置。

## 构建与运行

```bash
# 开发（Tauri + Vite 热重载）
bun run dev

# 仅启动前端 Vite 开发服务器
bun run dev:vite

# 发布构建
bun run build

# 仅构建前端
bun run build:vite

# Rust 代码检查（CI 强制执行）
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

本项目当前没有测试。Rust 版本要求：1.97.0+，edition 2024。包管理使用 bun。

## 配置

配置文件位于用户数据目录 `~/.ai-proxy/setting.json`（可通过环境变量 `AI_PROXY_HOME` 覆盖根目录）：

- `proxy`：`listen_host`、`listen_port`、`upstream_proxy_enabled`、`upstream_proxy_host`、`upstream_proxy_port` 等代理设置
- `ui`：主题（`theme`）、语言（`language`）
- `log`：日志级别、目录、滚动策略等

前端通过 Tauri command `get_settings` / `save_settings` 读写配置，不直接访问文件。

## 目录结构

```
ai-proxy/
├── src/                          # 前端（React + TypeScript）
│   ├── main.tsx                  # 入口，渲染后显示窗口
│   ├── App.tsx                   # 根组件：视图路由、全局状态、弹窗编排
│   └── index.css                 # 全局样式（Tailwind 主题变量 + 自定义组件样式）
│   │
│   ├── components/               # 公共组件（跨 feature 共享，无业务含义）
│   │   ├── core/                  # 核心通用组件（CopyButton 等）
│   │   ├── ui/                   # shadcn/ui 原子组件（button、dialog 等）
│   │   ├── icons/                # 自定义图标组件（GripDots、ScriptIcon 等）
│   │   └── json-tree/            # JSON 树形展示组件
│   │
│   ├── features/                 # 按功能域组织的业务组件
│   │   ├── proxy/                # 代理视图（TypeFilterBar + traffic-log 子模块）
│   │   ├── new-request/          # 新建请求（Postman 风格）
│   │   ├── title-bar/            # 自定义标题栏 + 标签页
│   │   ├── tool-bar/             # 左侧图标工具栏
│   │   ├── bottom-bar/           # 底部状态栏
│   │   ├── detail-panel/         # 请求详情面板（proxy + new-request 共享）
│   │   ├── settings/             # 设置弹窗
│   │   ├── about/                # 关于弹窗
│   │   ├── tls-config/           # TLS 配置弹窗
│   │   ├── script-config/        # 脚本配置弹窗
│   │   └── ai-view/              # AI 视图
│   │
│   ├── hooks/                    # 跨 feature 复用的 React hooks
│   ├── i18n/                     # i18next 初始化
│   ├── locales/                  # 翻译文件（en.json、zh.json）
│   ├── lib/                      # 工具函数（format、cn 等）
│   └── types/                    # TypeScript 类型定义
│
├── src-tauri/                    # 后端（Rust + Tauri）
│   ├── src/
│   │   ├── main.rs               # 二进制入口
│   │   ├── lib.rs                # Tauri 应用构建、AppState、事件处理
│   │   ├── commands/             # Tauri invoke 命令
│   │   │   ├── proxy.rs          # start_proxy / stop_proxy / get_status
│   │   │   ├── settings.rs       # get_settings / save_settings
│   │   │   ├── theme.rs          # get_theme / set_theme
│   │   │   └── locale.rs         # get_locale / set_locale
│   │   ├── config/               # 配置加载与存储
│   │   │   ├── settings.rs       # Settings 结构体
│   │   │   └── store.rs          # 数据目录管理（~/.ai-proxy）
│   │   ├── proxy/                # MITM 代理核心
│   │   │   ├── mod.rs            # ProxyServer
│   │   │   ├── client.rs         # 请求转发逻辑
│   │   │   ├── mitm.rs           # TLS 中间人
│   │   │   ├── parser.rs         # 流量解析
│   │   │   ├── state.rs          # 代理状态
│   │   │   └── cert.rs           # 自签名证书
│   │   ├── tray.rs               # 系统托盘
│   │   └── utils/                # 错误处理宏（bail! / anyhow!）
│   ├── tauri.conf.json
│   └── Cargo.toml
│
├── scripts/                      # 开发脚本
├── vite.config.ts
└── package.json
```

### 前端组织原则

| 目录                        | 放什么                                     | 判断标准                        |
| --------------------------- | ------------------------------------------ | ------------------------------- |
| `components/`               | ui/、icons/、json-tree/ 等公共组件         | 无业务含义，任何 feature 可复用 |
| `features/<区域>/`          | proxy/、new-request/、settings/ 等业务组件 | 属于某块功能/布局               |
| `features/<区域>/` 的子目录 | 仅该区域用的子模块/子组件                  | 不跨 feature 复用               |
| `hooks/`、`lib/`、`types/`  | 逻辑、工具、类型                           | 非 UI                           |

`App.tsx` 通过 `@/features/<区域>` 导入各功能域入口，例如：

```ts
import { ProxyView, EditRequestDialog } from '@/features/proxy'
import { NewRequestView } from '@/features/new-request'
import { SettingsDialog } from '@/features/settings'
import { TitleBar } from '@/features/title-bar'
```

## 代码架构

**前端入口**：`src/main.tsx` → `App.tsx` → 各 `features/` 组件

**后端入口**：`src-tauri/src/main.rs` → `lib.rs::run()` → 加载配置 → 注册 Tauri commands → 启动应用

**前后端通信**：

- 前端 `invoke('start_proxy')` 等调用 `src-tauri/src/commands/` 中的命令
- 后端通过 Tauri `emit` 向前端推送流量事件（`useProxyEvents` 监听）

**后端模块职责**：

- **config** (`src-tauri/src/config/`)：`Settings` 结构体，从 `~/.ai-proxy/setting.json` 加载配置，管理数据目录
- **proxy** (`src-tauri/src/proxy/`)：`ProxyServer` 和 `State`。核心代理逻辑：监听 TCP → 处理 CONNECT（HTTPS 隧道）→ MITM TLS 解密 → 转发请求到上游
- **client** (`src-tauri/src/proxy/client.rs`)：`http_mitm_proxy` 函数，实际请求转发。SSE 流式透传，非流式响应完整收集后转发
- **commands** (`src-tauri/src/commands/`)：暴露给前端的 Tauri invoke 接口
- **utils** (`src-tauri/src/utils/macros.rs`)：`FormattedError` + `bail!` / `anyhow!` 宏，替代 anyhow crate

**关键框架**：

- 后端：rama（https://github.com/plabayo/rama）—— HTTP 服务端/客户端、TLS、代理
- rama 源码路径 E:\project\rust\rama
- 前端：React 19 + Vite 8 + Tailwind CSS 4 + shadcn/ui
- 桌面：Tauri 2

## 主题系统（Theming）

主题基于 **Tailwind CSS 4 + shadcn/ui**，所有颜色以 **OKLCH** 定义，全部集中在 `src/index.css`。**新增/修改 UI 颜色时不要写死颜色值，应使用下方的语义变量或 Tailwind 语义类（如 `text-foreground`、`bg-card`），确保明暗两套主题都正确。**

### 主题切换机制

- 三态：`light` / `dark` / `system`（跟随系统），类型见 `src/hooks/useTheme.ts` 的 `Theme`
- 切换逻辑全在 `useTheme` hook：通过在 `<html>` 上 **增删 `.dark` class** + 设置 `style.colorScheme` 实现，`system` 模式监听 `prefers-color-scheme` 媒体查询
- 持久化：`useTheme` 调用 Tauri command `get_theme` / `set_theme`（`src-tauri/src/commands/theme.rs`），写入 `setting.json` 的 `ui.theme`
- CSS 侧：`:root` 定义亮色变量，`.dark` 覆盖为暗色；`@custom-variant dark (&:is(.dark *))` 使 `dark:` 变体生效

### 变量分层（`src/index.css`）

1. `@theme inline {}`（第 8–52 行）：把 `--xxx` 桥接为 Tailwind 的 `--color-xxx`，使 `bg-card`、`text-muted-foreground` 等语义类可用；同时定义字体与 `--radius-*` 阶梯
2. `:root {}`（亮色）与 `.dark {}`（暗色）：**两处必须成对维护**，改一个变量记得改另一个

### 字体大小令牌（禁止再写 `text-[Npx]` 任意值）

字号分两套阶梯，定义在 `@theme inline` 的 `--text-ui-*` / `--text-prose-*`，按内容性质选用：

| 阶梯 | 场景 | 档位 |
| --- | --- | --- |
| `text-ui-*` | **UI 骨架**（固定界面文本）：工具栏、TabBar、Tooltip、表头、徽章、菜单、筛选栏 | `ui-2xs`(9px) `ui-xs`(10px) `ui-sm`(11px) `ui-md`(12px) `ui-lg`(13px) |
| `text-prose-*` | **数据内容**（后端返回/用户输入）：Body/Raw/JSON 树、SSE chunk、AI 对话、表单数据、请求编辑输入框 | `prose-xs`(11px) `prose-sm`(12px) `prose-md`(13px) `prose-lg`(14px) `prose-xl`(15px) |

- 新增 UI 文本时从上表选档位，**不要写 `text-[11px]` 这类任意值**；shadcn 组件内部的 `text-xs`/`text-sm` 标准类保持原样
- **新增字号档位必须同步注册到 `src/lib/utils.ts` 的 `extendTailwindMerge` 配置**——tailwind-merge 不认识自定义 `text-*` 字号类，会把它误判为文字颜色，在 `cn(字号类, ..., text-颜色类)` 中静默丢弃字号类（症状：元素落回 16px 默认字号，且只有经过 `cn()` 的元素中招）
- 纯 CSS 场景（如 `.shiki-root`、`.md-content pre`）用 `var(--text-prose-md, 0.8125rem)` 引用（带回退值）
- **内容字号设置项已接线**：`--text-prose-*` 全部定义为 `calc(base * var(--prose-scale))`，`useProseFontSize` hook 运行时把档位（small=0.8462 / normal=1 / large=1.1538，以 prose-md 为锚即 11px / 13px / 15px）写入 `--prose-scale`，持久化走 `get_prose_font_size` / `set_prose_font_size` command → `setting.json` 的 `ui.prose_font_size`。UI 骨架（`--text-ui-*`）不参与缩放

### 语义变量分组（改 UI 优先复用这些）

| 分组 | 变量 | 用途 |
| --- | --- | --- |
| 基础前景/背景 | `--background` `--foreground` | 页面级底色与正文色 |
| 卡片/浮层 | `--card(-foreground)` `--popover(-foreground)` | 卡片、下拉、弹层 |
| 主色/次色/强调 | `--primary(-foreground)` `--secondary` `--accent` `--muted(-foreground)` | **注意：`--primary` 是按钮填充色，暗色下为近黑色，不能当正文色用；正文用 `--foreground`** |
| 表面层级 | `--surface-deep` `--surface-base` `--surface-elevated` | 项目自定义的三级面板底色，用于分隔区域深浅 |
| 边框/输入/焦点 | `--border` `--input` `--ring` `--primary-border` | |
| 破坏性 | `--destructive` | 删除/危险操作 |
| 侧栏 | `--sidebar*` | shadcn sidebar 专用 |
| 图表 | `--chart-1..5` | |
| 滚动条 | `--scrollbar-thumb(-hover)` `--scrollbar-track` | 全局细滚动条（`@layer base` 中 6px 样式） |

### 流量视图专用：HTTP 方法 / 状态徽章

`--badge-*` 系列（`--badge-get/post/put/delete/patch/head/options/connect/bypass`、`--badge-success/redirect/client-err/server-err/error`）供 `SummaryBar`、traffic-log 等**内联 `style` 引用**（因动态拼接类名 `var(--badge-${method})` 无法被 Tailwind 静态提取）。暗色版本饱和度/亮度整体调高以保证可读性。

### 代码高亮（两套独立主题，均需明暗成对）

- **Shiki**（`.shiki-root`）：背景强制透明，继承容器底色
- **CodeMirror**（`.tok-*`）：亮色为 GitHub 风格，`.dark .tok-*` 为 One Dark 风格——新增 token 类型时两处都要加

## 重要注意事项

- `setting.json` 可能包含敏感配置，位于用户目录，不应提交到仓库
- MITM 代理使用自签名证书，客户端需要信任或忽略证书警告
- SSE 流式响应（`text/event-stream`）采用逐 chunk 透传模式，非流式响应会完整收集后转发
- 错误处理不使用 anyhow，而是自建的 `bail!` / `anyhow!` 宏 + rama 的 `OpaqueError`
- 新增业务组件放 `features/<区域>/`，公共组件放 `components/<类别>/`，跨 feature 复用逻辑放 `hooks/` 或 `lib/`
- `src/components/ui/` 下的组件来自 shadcn/ui，**禁止修改**。需要额外功能时在业务组件中直接使用 Base UI 原语（`import { Select as SelectPrimitive } from '@base-ui/react/select'`）绕过 wrapper。
- **禁止使用 `git checkout -- <file>` 还原文件** — 会丢失未提交的改动，只能通过手动编辑修复。
