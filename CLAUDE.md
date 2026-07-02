@AGENTS.md

## 项目自定义构建

- 版本号在 `.version` 文件中定义（如 `0.4.4-my`），通过 Vite `define` 注入桌面和远程两个构建
- `pnpm build` 会同时构建桌面（`dist/`）和远程面板（`dist-remote/`）两套产物
- `build-release.ps1` 是自定义发布脚本，用于版本自增、双构建、exe 重命名、注册表自启、Git 标签、CHANGELOG 追加
- `src/remote/` 是手机端远程面板 PWA，通过桌面 HTTP 服务器提供 API

## 构建与发布流程

```bash
pnpm build                          # 桌面 + 远程面板 双构建（tsc + vite build + vite build --config vite.remote.config.ts）
pnpm tauri dev                      # 开发模式启动（自动启动 Vite dev server）
pnpm tauri build                    # 桌面应用二进制（仅编译，无版本管理）
./build-release.ps1                 # 完整发布流程：版本自增 → pnpm install → tauri build → exe 重命名 → 注册表自启 → 旧版清理 → Git 标签 → CHANGELOG
```

## 关键自定义文件

| 文件 | 说明 |
|------|------|
| `.version` | 自定义版本号（格式：`X.Y.Z.N-suffix`） |
| `vite.config.ts` | 主 Vite 配置，注入 `__APP_VERSION__` |
| `vite.remote.config.ts` | 远程面板独立 Vite 配置，产物输出到 `dist-remote/` |
| `build-release.ps1` | 发布脚本（patch 自增、保留最近 3 个版本、自动打标签） |
| `src/vite-env.d.ts` | 全局 `__APP_VERSION__` 类型声明 |
| `src/remote/` | 远程面板 PWA（独立 entrypoint） |
| `src/components/session-view/` | 桌面/远程共享的会话渲染组件 |
| `src-tauri/src/feishu.rs` | HTTP 服务器（远程 API + 飞书 Bot + Web Push 端点） |
| `src-tauri/src/push.rs` | Web Push 推送实现（纯 RustCrypto） |
| `src-tauri/src/storage.rs` | 基于 JSON 文件的项目/分组持久化 |

## 核心功能：侧边栏（ProjectRail）

### 文件结构

| 文件 | 职责 |
|------|------|
| `src/components/ProjectRail.tsx` | 侧边栏主组件（拖拽、分组、搜索、折叠、宽度调整） |
| `src/components/project-rail/RailItem.tsx` | 单个项目按钮（头像 + 名称 + 状态指示器） |
| `src/components/project-rail/drag.ts` | 拖拽数据类型 + `getRailItemTranslateY()` 让位计算 |
| `src/components/project-rail/activity.ts` | 项目活动状态聚合（最近任务状态、待确认数） |
| `src/components/project-rail/search.ts` | 项目搜索过滤逻辑 |
| `src/components/project-rail/ProjectDrawer.tsx` | 隐藏项目抽屉 |
| `src/components/project-rail/ProjectRailActions.tsx` | 底部操作（打开项目、展开抽屉） |
| `src/styles/rail-drag.ts` | 拖拽浮层样式（`railDragPreviewStyle`） |

### 拖拽系统

**项目拖拽重排序：**
- `handleRailItemPointerDown` → `setDragOrigin` + `setPointerCapture`
- `useEffect([dragOrigin])` 注册 `pointermove/pointerup` 监听
- `handleMove` 计算 `dropIndex` 通过 DOM `[data-rail-id]` 元素位置
- `handleEnd` 从 DOM 中提取 `visibleIds`（顺序由 DOM 决定），避免与 storage 顺序不一致
- `getRailItemTranslateY()` 计算每个非拖动项目的让位平移（±RAIL_ITEM_STRIDE）
- `onCommitProjectOrder(draggedId, beforeId, visibleIds)` → App.tsx `handleCommitProjectOrder` → `reorderProjects()` → `save_projects`

**分组拖拽重排序：**
- `handleGroupDragStart(e, groupId)` — `e.preventDefault()` + `setDraggingGroupId(groupId)`
- 注册 document-level pointermove/pointerup
- `handleMove` 通过 `data-group-id` 头位置检测 `groupDropTarget`
- `handleUp` 计算 splice 后的 `adjustedDropIdx`（`dropIdx > dragIdx ? dropIdx - 1 : dropIdx`）
- `save_project_groups` 持久化
- **视觉反馈**：被拖分组 opacity 0.5，目标位置显示绿色发光指示条，浮层跟随鼠标
- **不再使用 translateY 让位动画**（分组高度不固定，无法精确对齐）

### 数据持久化

- 项目列表：`~/.nezha/projects.json`（数组顺序 = 侧边栏显示顺序）
- 分组：`~/.nezha/project-groups.json`（`order` 字段控制分组排序）
- 任务：`~/.nezha/projects/<projectId>/tasks.json`
- 草稿：`localStorage`（`nezha:cq:<taskId>`、`nezha:rail-width`）

### App.tsx 关键状态

- `projects`：`useState<Project[]>` — 数组顺序即侧边栏顺序
- `railProjects = projects` — 直接透传给 ProjectRail
- `handleCommitProjectOrder(draggedId, beforeId, visibleIds)` — 调用 `reorderProjects()` 重组数组
- `handleMoveToGroup(projectId, groupId)` — 修改 `Project.groupId`
- `handleOpen()` 打开项目时调用 `discover_project_sessions()` 自动发现历史会话任务

### `reorderProjects()` 算法

```typescript
function reorderProjects(projects, visibleIds, draggedId, beforeId): Project[] {
  // 1. 从 visibleIds 中移除 draggedId
  // 2. 插入到 beforeId 之前（null = 末尾）
  // 3. 遍历原始 projects 数组，替换可见项为新顺序
  // 4. 不可见项保持原位
}
```

### 分组数据模型

```typescript
interface ProjectGroup {
  id: string;
  name: string;
  collapsed: boolean;  // 仅 UI 状态，也同步写入 JSON
  order: number;       // 排序权重
}
```

## 架构要点

- **CSS-in-JS via TypeScript**：所有样式定义为 `React.CSSProperties` 对象，从 `src/styles/` 各模块导出
- **远程面板鉴权**：64 位十六进制 token，支持 `?token=`、`X-Nezha-Token` 头、`Authorization: Bearer` 头
- **实时输出**：SSE 实时流 + 1.5s 静默后回拉结构化消息
- **Web Push**：纯 RustCrypto 实现（p256 + aes-gcm + hkdf + sha2），无原生依赖，支持 VAPID
- **主题系统**：四套主题（light / eyecare / dark / midnight），通过 `<html class="...">` 切换
- **记忆安全**：会话文件使用 `BufReader` 流式读取 + 环回缓冲区（头部 16 行 + 尾部 20000 行），避免 `read_to_string` OOM

## 版本管理规则

1. 版本号格式：`X.Y.Z.N-suffix`（如 `0.4.4.29-my`），N 为 patch 递增量
2. 发布必须通过 `build-release.ps1`，不要手动 bump 版本
3. 脚本自动：patch+1 → Cargo.toml 同步 → 构建 → 重命名 exe → 注册表自启 → 清理旧版 → git 标签 → CHANGELOG
4. 保留最近 3 个版本 exe，更旧自动删除