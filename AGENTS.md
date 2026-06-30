# Nezha — AGENTS.md

## 项目概述

Nezha 是一款面向 AI 编程智能体（Claude Code、Codex）的桌面任务管理器，提供多项目工作区、实时终端输出、会话自动发现、权限感知执行、Git 集成和用量分析等核心功能。

**技术栈：** React 19 + TypeScript + Vite（前端）· Tauri 2 + Rust（桌面壳）· xterm.js（终端）· Shiki（语法高亮）

**远程面板：** 手机端 PWA，支持查看任务、实时会话、发送输入、Web Push 通知

---

## 开发命令

```bash
pnpm dev            # 启动 Vite 开发服务器（端口 1420）
pnpm build          # tsc 类型检查 + Vite 桌面构建 + Vite 远程构建
pnpm build:remote   # 仅构建远程 PWA（src/remote/ → dist-remote/）
pnpm lint           # 运行 ESLint
pnpm test           # 运行 Vitest
pnpm tauri dev      # 启动完整桌面应用（自动启动开发服务器）
pnpm tauri build    # 构建生产环境桌面二进制包
```

Rust 后端位于 `src-tauri/`，修改后需重启 `tauri dev`。

---

## 架构设计

### 前端（`src/`）

| 文件 / 目录 | 职责 |
|------------|------|
| `App.tsx` | 根组件；持有所有状态（projects、tasks、buffers）及 Tauri 事件监听器 |
| `types.ts` | TypeScript 接口的权威定义 |
| `i18n.tsx` | 国际化（中/英），Context-based 翻译 |
| `styles/` | CSS-in-JS TypeScript 样式 + `themes.css` 主题变量 |
| `App.css` | 仅用于暗色/亮色主题的 CSS 自定义属性 |
| `components/session-view/` | 共享会话渲染组件（MessageBlock、ToolUseCard、MessageList 等），桌面/远程共用 |
| `remote/` | 远程面板 PWA 独立入口（`index.html` + `main.tsx` + `RemoteApp.tsx`） |
| `remote/data/remoteSource.ts` | HTTP SessionSource 实现（REST + SSE） |

### 后端（`src-tauri/src/`）

| 模块 | 职责 |
|------|------|
| `pty.rs` | PTY 创建/读写、任务生命周期管理 |
| `session.rs` | 会话文件监听、消息读取、流式解析（BufReader 环回缓冲区） |
| `storage.rs` | 基于文件的持久化 |
| `fs.rs` | 文件系统命令 |
| `git.rs` | Git 集成 |
| `analytics.rs` | Token/工具调用指标 |
| `config.rs` | 项目配置管理 |
| `app_settings.rs` | 应用级设置管理 |
| `hooks.rs` | Claude Code/Codex hook 集成 |
| `event_watcher.rs` | Hook 事件监听 |
| `notification.rs` | 系统通知 |
| `agent_assist.rs` | 智能体辅助调用 |
| `subprocess.rs` | 子进程封装 |
| `usage.rs` | 用量统计 |
| `skills.rs` | Skill 注册表管理 |
| `cc_switch.rs` | cc-switch provider 集成 |
| `feishu.rs` | 飞书 Bot 集成 + HTTP 服务器（远程面板后端，含 Token 鉴权） |
| `push.rs` | Web Push 推送（RFC 8291/8292，纯 RustCrypto） |
| `platform/` | 平台相关辅助 |

### 数据模型

```typescript
interface Task {
  id: string;
  projectId: string;
  name?: string;
  prompt: string;
  agent: "claude" | "codex";
  permissionMode: "ask" | "auto_edit" | "full_access";
  status: TaskStatus;
  createdAt: number;
  updatedAt?: number;
  attentionRequestedAt?: number;
  starred?: boolean;
  failureReason?: string;
  claudeSessionId?: string;
  claudeSessionPath?: string;
  codexSessionId?: string;
  codexSessionPath?: string;
  // Worktree 集成
  worktreePath?: string;
  worktreeBranch?: string;
  baseBranch?: string;
  worktreeDiscarded?: boolean;
  additions?: number;
  deletions?: number;
}
```

---

## 版本系统

版本号定义在 `.version` 文件（如 `0.4.4-my`），通过 Vite `define` 注入为 `__APP_VERSION__` 全局常量。

- `vite.config.ts`：主应用 + 远程面板读取 `.version`
- `vite.remote.config.ts`：远程面板独立 Vite 配置，产物输出到 `dist-remote/`
- `build-release.ps1`：发布构建脚本（版本号自增、双构建、重命名 exe、注册表自启、Git 标签、CHANGELOG）

---

## 远程面板架构

```
手机浏览器 ←→ 桌面端 HTTP 服务器 (feishu.rs)
    |
    ├─ REST API (token 鉴权)
    │   ├─ GET  /api/projects
    │   ├─ GET  /api/tasks?project_id=
    │   ├─ GET  /api/task/<id>/messages
    │   ├─ POST /api/task/<id>/input
    │   ├─ GET  /api/live-tasks (SSE)
    │   ├─ GET  /api/task/<id>/output (SSE)
    │   ├─ GET  /api/push/key
    │   └─ POST /api/push/subscribe
    │
    └─ 前端产物 (rust-embed: RemoteAssets)
         └─ dist-remote/ → 二进制内嵌
```

- 所有 `/api/*` 需要 token，支持 `?token=`、`X-Nezha-Token`、`Authorization: Bearer`
- 实时输出：SSE + 1.5s settle 转结构化消息
- Web Push：纯 RustCrypto (p256 + aes-gcm + hkdf)，无原生依赖

---

## 提交规范

遵循 Conventional Commits：`<type>(<scope>): <subject>`

类型：`feat` / `fix` / `chore` / `style` / `refactor` / `docs` / `perf`

---

## 开机自启（Windows）

启动项注册默认由 `build-release.ps1` 构建脚本管理，不再由应用运行时处理：

```powershell
reg add HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v NeZha /d "C:\path\to\nezha-v0.x.x-my.exe" /f
```

每次运行 `build-release.ps1` 构建新版本后，注册表路径会自动更新。