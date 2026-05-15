# MarkFlow

> **The Agent-Native Markdown Editor — Built with Rust**

A native desktop Markdown editor designed around the human–AI co-editing workflow. See your AI agent's file changes appear in real time, navigate long documents via a live outline, and write in a clean WYSIWYG environment — no toolbar, no distractions.

---

## 中文简介

MarkFlow 是一款专为 AI 协作场景设计的原生桌面 Markdown 编辑器，基于 Rust/Tauri 构建，采用 Milkdown 作为富文本编辑引擎。

核心特点：AI 文件变更实时同步、标题导航、主题自定义、多标签页编辑、多格式导出（HTML/PDF）。

---

## Features | 功能特性

### AI 协作 (Agent Native)

| 功能 | 说明 |
|------|------|
| **外部文件监控** | Rust 层使用 `notify` 库监控已打开的 `.md` 文件，外部变更时自动刷新编辑器内容 |
| **Agent 状态指示器** | 右上角圆点显示 Agent 状态：呼吸动画（写作中）→ 绿色（冷却）|
| **⌘/Ctrl + 单击链接** | 在默认浏览器中打开链接 |
| **CLI 文件参数** | 支持通过命令行 `markflow file.md` 直接打开文件 |

### 编辑器 (Editor)

| 功能 | 说明 |
|------|------|
| **WYSIWYG Markdown** | 所见即所得，输入 Markdown 即时渲染为富文本 |
| **智能换行** | 单个换行符渲染为视觉换行（`remark-breaks`）|
| **富文本粘贴** | 从微信、Word 等应用复制内容时保留内联样式 |
| **GFM 支持** | 表格、任务列表、删除线、代码高亮等 GitHub Flavored Markdown 扩展 |
| **多标签页** | 并行编辑多个文档，标签栏管理 |
| **撤销/重做** | 内置历史记录插件 |
| **标题导航** | 右侧大纲面板，提取 h1–h6 标题树，点击跳转；支持滚动监听高亮当前章节 |
| **大纲折叠** | 支持多级标题树的展开/折叠 |

### 主题 (Themes)

| 主题 | 风格 |
|------|------|
| **Light** | GitHub 风格浅色 |
| **Dark** | GitHub Dark 暗色 |
| **Elegant** | 暖米色背景 + 霞鹜文楷字体，中文衬线风格 |
| **Newsprint** | 报纸质感米色纸张 |
| **Custom** | 导入任意 CSS 文件作为自定义主题 |

### 导出 (Export)

- **HTML 导出**：保留当前主题配色的完整 HTML 文件（含内联样式）
- **文件另存为**：支持 `.md` 格式另存

### 快捷键 (Keyboard Shortcuts)

| 快捷键 | 功能 |
|--------|------|
| `Ctrl/⌘ + S` | 保存（已有路径则直接保存，Untitled 页面触发另存为）|
| `Ctrl/⌘ + Shift + S` | 另存为 |
| `Ctrl/⌘ + Shift + O` | 切换大纲侧边栏显示 |
| `Ctrl/⌘ + O` | 打开文件 |
| `Ctrl/⌘ + N` | 新建标签页 |

---

## Architecture | 架构

```
┌──────────────────────────────────────────────┐
│                  Frontend (Browser)           │
│  ┌────────────────────────────────────────┐  │
│  │  Milkdown (ProseMirror) — WYSIWYG      │  │
│  │  editor.ts · outline.ts · theme-manager │  │
│  └──────────────┬───────────────────────────┘  │
│                 │ Tauri invoke / event         │
└─────────────────┼──────────────────────────────┘
                  │
┌─────────────────┼──────────────────────────────┐
│                  Rust Backend (Tauri v2)        │
│  ┌──────────────┴───────────────────────────┐  │
│  │  commands.rs — open/save/export 命令       │  │
│  │  watcher.rs — notify 库文件监控             │  │
│  │  file.rs    — 读写对话框和文件系统           │  │
│  │  theme.rs   — 自定义主题加载                │  │
│  │  menu.rs    — 原生菜单和快捷键绑定           │  │
│  │  lib.rs     — AppState 管理（多窗口状态）    │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 核心设计决策

**Outline 导航定位策略**

Outline 导航采用双阶段精确定位：
1. **Phase 1** — 通过 ProseMirror 文档位置（`doc.resolve(pos)`）设置编辑器选区，触发内置 `scrollIntoView()`
2. **Phase 2** — 双重 `requestAnimationFrame` 后，使用 `view.nodeDOM(item.pos)` 获取渲染后的 DOM 元素，再用 `getBoundingClientRect()` 计算滚动偏移量，手动控制 `#editor` 容器的 `scrollTop`

> 不依赖 DOM 属性注入（`data-outline-id` 等），因为 ProseMirror 在事务后可能重建/规范化 DOM，导致手动注入的属性丢失。

**文件监控机制**

- 每个窗口维护独立的 `WatcherHandle`（`mpsc::Sender<()>`）
- `notify::RecommendedWatcher` 运行在独立线程，检测到文件变更后通过 `emit_to` 将 `file-changed` 事件发送到对应窗口
- 内部保存时设置 `is_internal_save` 标志（目前未实际用于过滤，这是 Rust 端预留的机制）

---

## Tech Stack | 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri v2.10（Rust） |
| 编辑引擎 | Milkdown v7（ProseMirror） |
| 构建工具 | Vite 6 + TypeScript |
| 文件监控 | notify 6.1（Rust） |
| 样式 | 纯 CSS 变量（无 Tailwind） |
| 主题 | 4 个内置主题 + CSS 导入 |
| 原生对话框 | tauri-plugin-dialog |
| 文件系统 | tauri-plugin-fs |
| 外链打开 | tauri-plugin-shell |

---

## Project Structure | 项目结构

```
markflow-app/
├── index.html                    # 应用入口 HTML
├── package.json                  # npm 依赖
├── vite.config.ts               # Vite 配置
├── tsconfig.json / tsconfig.node.json
│
├── src/                         # 前端 TypeScript
│   ├── main.ts                  # 入口：标签页管理、菜单事件、导出
│   ├── editor/
│   │   ├── editor.ts            # Milkdown 初始化、getMarkdown/getHTML/setMarkdown
│   │   ├── outline.ts           # 大纲提取、导航、滚动监听
│   │   └── html-view.ts         # HTML 内联节点视图
│   └── themes/
│       ├── base.css             # 所有样式 + 4 主题的 CSS 变量
│       └── theme-manager.ts      # 主题切换、localStorage 持久化
│
└── src-tauri/                   # Rust 后端
    ├── Cargo.toml               # Rust 依赖
    ├── tauri.conf.json          # Tauri 配置（窗口、权限、图标）
    ├── capabilities/default.json
    └── src/
        ├── main.rs              # 入口 + CLI 文件参数处理
        ├── lib.rs                # AppState、窗口状态、watcher map
        ├── commands.rs          # Tauri 命令：open/save/export/load_theme
        ├── file.rs              # 文件对话框、读写、建议文件名
        ├── watcher.rs           # notify 文件监控实现
        ├── theme.rs             # 自定义主题加载
        └── menu.rs              # 原生菜单构建和菜单事件分发
```

---

## Development | 开发

### 环境要求

- Node.js ≥ 18
- Rust ≥ 1.77（`rustup update`）
- npm

### 本地开发

```bash
# 安装依赖
npm install

# 启动 Tauri 开发模式（热重载 + Rust 编译）
npm run tauri:dev

# 仅前端热重载（不需要 Rust 编译）
npm run dev
```

### 生产构建

```bash
# 完整构建（Tauri bundle）
npm run tauri:build

# 仅构建前端（dist/）
npm run build
```

### Git Hooks

项目使用 Tauri CLI，提交前建议执行 `npm run build` 验证前端构建通过。

---

## Changelog | 更新记录

Recent significant changes:

| Commit | 描述 |
|--------|------|
| `acd4e17` | Ctrl+S 支持 Untitled 页面另存为；所有保存路径均刷新 outline |
| `7b32f3f` | Outline 导航改用 ProseMirror 位置映射，替代 DOM 属性查询 |
| `030a44b` | 标题栏和标签栏合并为单行统一 header（90px → 40px）|
| `6df12e3` | 修复多标签页场景下的标签堆叠和文本截断 |
| `e16736a` | 新增 Rust 层文件监控，外部文件变更时自动刷新 |
| `907dff0` | Outline 滚动导航改用 `getBoundingClientRect()` 修复定位偏移 |

---

## License

MIT — Built with Rust 🦀 for the agent-native future.
