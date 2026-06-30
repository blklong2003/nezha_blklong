@AGENTS.md

## 项目自定义构建

- 版本号在 `.version` 文件中定义（如 `0.4.4-my`），通过 Vite `define` 注入桌面和远程两个构建
- `pnpm build` 会同时构建桌面（`dist/`）和远程面板（`dist-remote/`）两套产物
- `build-release.ps1` 是自定义发布脚本，用于版本自增、双构建、exe 重命名、注册表自启、Git 标签
- `src/remote/` 是手机端远程面板 PWA，通过桌面 HTTP 服务器提供 API

## 构建流程

```bash
pnpm build                          # 桌面 + 远程面板 双构建
pnpm tauri build                    # 桌面应用二进制
./build-release.ps1                 # 完整发布流程（版本自增 → 构建 → 重命名 → 注册表 → 标签）
```

## 关键自定义文件

| 文件 | 说明 |
|------|------|
| `.version` | 自定义版本号标记 |
| `vite.config.ts` | 主 Vite 配置，注入 `__APP_VERSION__` |
| `vite.remote.config.ts` | 远程面板独立 Vite 配置 |
| `build-release.ps1` | 发布构建脚本 |
| `src/vite-env.d.ts` | 全局 `__APP_VERSION__` 类型声明 |
| `src/remote/` | 远程面板 PWA |
| `src/components/session-view/` | 桌面/远程共享的会话渲染组件 |
| `src-tauri/src/feishu.rs` | HTTP 服务器（远程 API + 飞书 Bot + Web Push 端点） |
| `src-tauri/src/push.rs` | Web Push 推送实现 |

## 架构要点

- **CSS-in-JS via TypeScript**：所有样式定义为 `React.CSSProperties` 对象，从 `src/styles/index.ts` 导出
- **数据属性选择器**：使用 `data-*` 属性 + CSS 文件覆盖内联样式（如 `button[data-rn-action]:not(:disabled):hover`）
- **远程面板鉴权**：64 位十六进制 token，支持 `?token=`、`X-Nezha-Token` 头、`Authorization: Bearer` 头
- **实时输出**：SSE 实时流 + 1.5s 静默后回拉结构化消息
- **Web Push**：纯 RustCrypto 实现（p256 + aes-gcm + hkdf + sha2），无原生依赖，支持 VAPID
- **主题系统**：四套主题（light / eyecare / dark / midnight），通过 `<html class="...">` 切换
- **记忆安全**：会话文件使用 `BufReader` 流式读取 + 环回缓冲区（头部 16 行 + 尾部 20000 行），避免 `read_to_string` OOM