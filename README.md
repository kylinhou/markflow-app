# MarkFlow

**The Agent-Native Markdown Editor**

A native desktop Markdown editor built for the human–AI co-editing workflow. AI agent writes to your `.md` file, MarkFlow detects and refreshes instantly. Navigate long documents via live outline. No toolbar, no distractions.

---

## 简介

MarkFlow 是一款专为 AI 协作场景设计的原生桌面 Markdown 编辑器，基于 Rust/Tauri 构建，采用 Milkdown（ProseMirror）作为富文本编辑引擎。

**核心理念**：Agent-Native（Agent 友好）—— 让 AI 和人类在同一份文档上无缝协作。

**技术亮点**：
- Rust 后端毫秒级文件监控（`notify` 库）
- Milkdown 所见即所得编辑，GFM 全支持
- 多标签页并行编辑
- 大纲导航采用双阶段定位（ProseMirror 文档位置 + DOM 坐标计算）
- 主题 CSS 变量系统，支持导入自定义 CSS

---

## 功能 | Features

### AI 协作 (Agent Native)

| 功能 | 说明 |
|------|------|
| **外部文件监控** | Rust 层用 `notify` 库监控当前已打开的 `.md` 文件，外部变更时前端自动刷新 |
| **后台标签页也更新** | 非活动标签页检测到文件变更时，内容被静默更新但不切换视图 |
| **Agent 状态指示器** | 右上角圆点：呼吸动画 = Agent 写作中，绿色 = 冷却中 |
| **⌘/Ctrl + 单击链接** | 在默认浏览器打开链接 |
| **CLI 文件参数** | 支持 `markflow document.md` 直接打开文件 |
| **文件关联** | 注册 `.md` 系列扩展名，双击可在 MarkFlow 中打开 |

### 编辑器 (Editor)

| 功能 | 说明 |
|------|------|
| **所见即所得** | 输入 Markdown 即时渲染，无需预览模式 |
| **GFM 完整支持** | 表格、任务列表、删除线、代码高亮、自动链接等 |
| **智能换行** | 单个换行符渲染为视觉换行（`remark-breaks`）|
| **富文本粘贴** | 从微信、Word 等复制内容时保留内联样式（通过剪贴板增强）|
| **多标签页** | 并行编辑多个文档，标签栏管理，独立内容缓存 |
| **撤销/重做** | Milkdown 内置历史记录插件 |
| **文档大纲** | 右侧面板，提取 h1–h6 标题构建嵌套树，点击跳转 |
| **滚动监听** | `IntersectionObserver` 高亮当前可见章节 |
| **大纲折叠** | 多级标题树支持展开/折叠 |
| **拖拽调整宽度** | 编辑器和侧边栏之间的可拖拽分隔条，宽度记忆到 localStorage |

### 主题 (Themes)

| 主题 | 风格描述 |
|------|----------|
| **Light** | GitHub 风格浅色，代码块高亮 |
| **Dark** | GitHub Dark 暗色主题 |
| **Elegant** | 暖米色背景 + 霞鹜文楷字体，衬线中文风格 |
| **Newsprint** | 报纸质感米色纸张 |
| **Custom** | 导入任意 `.css` 文件作为自定义主题 |

### 导出 (Export)

- **HTML 导出**：当前主题配色的完整 HTML（含内联样式），支持深色/浅色主题一致外观
- **文件另存为**：`.md` 格式，通过 Tauri 原生对话框

### 快捷键 (Keyboard Shortcuts)

| 快捷键 | 功能 |
|--------|------|
| `Ctrl/⌘ + S` | 保存（有路径→直接保存，Untitled→另存为）|
| `Ctrl/⌘ + Shift + S` | 另存为 |
| `Ctrl/⌘ + Shift + O` | 切换大纲侧边栏 |
| `Ctrl/⌘ + O` | 打开文件 |
| `Ctrl/⌘ + N` | 新建标签页 |
| `Ctrl/⌘ + Z` | 撤销 |
| `Ctrl/⌘ + Shift + Z` | 重做 |
| `Ctrl/⌘ + A` | 全选 |

---

## 系统架构 | Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (WebView)                        │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Milkdown v7 (ProseMirror)                             │  │
│  │  editor.ts · outline.ts · theme-manager.ts · main.ts   │  │
│  └───────────────────────────────────────────────────────┘  │
│                           │ invoke / listen                 │
└───────────────────────────┼─────────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────┐
│                     Rust Backend (Tauri v2)                  │
│  ┌────────────────┬─────────────────────────────────────┐  │
│  │ commands.rs    │ open_file / save_file / export_html │  │
│  │ file.rs        │ 原生对话框 · 文件读写 · 文件名建议   │  │
│  │ watcher.rs     │ notify 文件监控（独立线程 + mpsc）   │  │
│  │ theme.rs       │ 自定义主题加载（~/.markflow/themes）  │  │
│  │ menu.rs        │ 原生菜单构建 · 菜单事件分发           │  │
│  │ lib.rs         │ AppState（窗口状态 + watcher handle） │  │
│  └────────────────┴──────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### 核心设计决策

**大纲导航定位策略**

大纲点击跳转采用双阶段精确方案，避免依赖 DOM 属性注入（ProseMirror 会在事务后重建 DOM，手动注入的 `data-*` 属性会丢失）：

1. **Phase 1 — ProseMirror 事务**：通过 `doc.resolve(pos)` 设置选区，触发内置 `scrollIntoView()`
2. **Phase 2 — 精确 DOM 滚动**（双重 `requestAnimationFrame` 后执行）：用 `view.nodeDOM(item.pos)` 获取渲染 DOM，再用 `getBoundingClientRect()` 计算偏移量，手动控制 `#editor` 容器的 `scrollTop`

**文件监控机制**

```
WatcherHandle = mpsc::Sender<()>
WatcherMap    = Mutex<HashMap<window_label, WatcherHandle>>

notify::RecommendedWatcher 运行在独立线程
  → 检测到文件变更
  → emit_to("file-changed", { path })
  → 前端 route 到对应标签页刷新
```

切换文件时，先 `guards.remove(label)` 丢弃旧的 `Sender`，channel 关闭，监控线程自然退出，再启动新的。

---

## 技术栈 | Tech Stack

| 层级 | 技术 | 版本 |
|------|------|------|
| 桌面框架 | Tauri | v2.10 |
| 编辑引擎 | Milkdown（ProseMirror）| v7.19 |
| 前端构建 | Vite | v6 |
| 语言 | TypeScript | v5.7 |
| 后端语言 | Rust | ≥1.77 |
| 文件监控 | notify | v6.1 |
| 异步运行时 | tokio | v1.35 |
| 原生对话框 | tauri-plugin-dialog | v2 |
| 文件系统 | tauri-plugin-fs | v2 |
| 外链打开 | tauri-plugin-shell | v2 |

---

## 项目结构 | Project Structure

```
markflow-app/
├── index.html                          # 应用入口 HTML
├── package.json                        # npm 依赖
├── vite.config.ts                      # Vite 配置
├── tsconfig.json / tsconfig.node.json
│
├── src/                               # 前端 TypeScript
│   ├── main.ts                         # 入口：标签页管理、菜单事件、导出、Toast
│   ├── editor/
│   │   ├── editor.ts                  # Milkdown 初始化 · getMarkdown · getHTML · setMarkdown
│   │   ├── outline.ts                  # 大纲提取 · 导航 · 滚动监听 · 侧边栏宽度
│   │   └── html-view.ts               # HTML 内联节点视图（Milkdown 插件）
│   └── themes/
│       ├── base.css                    # 全部样式 + CSS 变量 + 4 个内置主题
│       └── theme-manager.ts            # 主题切换 · localStorage 持久化
│
└── src-tauri/                         # Rust 后端
    ├── Cargo.toml                      # Rust 依赖
    ├── tauri.conf.json                 # Tauri 配置（窗口、权限、文件关联）
    ├── capabilities/default.json
    └── src/
        ├── main.rs                     # 入口：CLI 文件参数处理
        ├── lib.rs                      # AppState · 窗口状态 · watcher map
        ├── commands.rs                 # Tauri 命令：open / save / export / theme
        ├── file.rs                     # 文件对话框 · 读写 · 文件名建议
        ├── watcher.rs                  # notify 文件监控实现
        ├── theme.rs                    # 自定义主题加载 · 目录管理
        └── menu.rs                     # 原生菜单构建 · 菜单事件分发
```

---

## 开发 | Development

### 环境要求

- Node.js ≥ 18
- Rust ≥ 1.77
- npm

### 常用命令

```bash
# 安装依赖
npm install

# Tauri 开发模式（前端热重载 + Rust 编译）
npm run tauri:dev

# 仅前端热重载（不需要 Rust）
npm run dev

# 完整构建（Tauri bundle，所有平台）
npm run tauri:build

# 仅构建前端 dist/
npm run build
```

---

## 版本历史 | Changelog

| Commit | 描述 |
|--------|------|
| `acd4e17` | Ctrl+S 对 Untitled 页面触发另存为；所有保存路径均刷新 outline |
| `7b32f3f` | 大纲导航改用 ProseMirror 文档位置替代 DOM 属性查询 |
| `030a44b` | 合并标题栏和标签栏为单行统一 header（90px → 40px）|
| `6df12e3` | 修复多标签页标签堆叠和文本截断问题 |
| `e16736a` | 新增 Rust 层 `notify` 文件监控，外部文件变更时自动刷新 |
| `962995a` | 新增 Toast 通知（外部刷新时提示"文档已刷新"）|
| `907dff0` | 大纲滚动导航改用 `getBoundingClientRect()` 修复定位偏移 |

---

## License

MIT — Built with Rust 🦀 for the agent-native future.
