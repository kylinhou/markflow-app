import { invoke } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { createEditor, getMarkdown, getHTML, setMarkdown, getCommentRanges, addCommentDecoration, removeCommentDecoration, highlightCommentDecoration, setCommentDecorations, scrollEditorToRange, getEditorView, commentPluginKey } from './editor/editor'
import { applyTheme, loadSavedTheme, setContentWidth, loadContentWidth, applyContentWidth } from './themes/theme-manager'
import { initOutline, updateOutline, toggleSidebar, restoreOutlineState, setSidebarDirection } from './editor/outline'
import { readTextFile, writeTextFile, exists, remove } from '@tauri-apps/plugin-fs'
import './themes/base.css'

// Expose editor API to window for testing/automation
;(window as any).setMarkdown = setMarkdown
;(window as any).getMarkdown = getMarkdown
;(window as any).applyTheme = applyTheme

// ─── Types ─────────────────────────────────────────────────────────────────

interface FileData {
  path: string
  content: string
}

interface CommentMeta {
  commentId: string
  quote: string
  content: string
  author: 'user' | 'agent'
  status: 'active' | 'resolved'
  timestamp: number
  from: number
  to: number
  context: string
  offsetInContext: number
  orphaned?: boolean
}

interface Tab {
  id: string          // unique tab identifier (file path or temp id)
  path: string | null // null = untitled
  name: string        // display name
  isDirty: boolean    // unsaved changes
  content: string     // current editor content for this tab
  comments?: CommentMeta[]
}

// Levenshtein distance utility for fuzzy matching
function getLevenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []
  for (let i = 0; i <= b.length; i++) matrix[i] = [i]
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }
  return matrix[b.length][a.length]
}

// ─── State ─────────────────────────────────────────────────────────────────

let tabs: Tab[] = []
let activeTabId: string | null = null

// ─── 右键菜单状态 ─────────────────────────────────────────────────────────────
let rightClickedTabId: string | null = null
let contextMenuEl: HTMLDivElement | null = null

// ─── Tab Management ─────────────────────────────────────────────────────────

function getActiveTab(): Tab | undefined {
  return tabs.find(t => t.id === activeTabId)
}

function tabName(path: string | null): string {
  if (!path) return 'Untitled'
  return path.split(/[\\/]/).pop() || 'Untitled'
}

function renderTabs(): void {
  const list = document.getElementById('tab-list')
  if (!list) return
  list.innerHTML = ''

  for (const tab of tabs) {
    const el = document.createElement('div')
    el.className = 'tab' + (tab.id === activeTabId ? ' active' : '') + (tab.isDirty ? ' dirty' : '')
    el.dataset.tabId = tab.id

    const name = document.createElement('span')
    name.className = 'tab-name'
    name.textContent = tab.name
    
    // 【新增】智能 Tooltip 展示：仅在文本溢出被截断时展示完整文件路径/文件名
    name.addEventListener('mouseenter', (e) => {
      const target = e.currentTarget as HTMLElement
      // 检查当前文字的实际渲染宽度是否大于容器的可视宽度
      const isOverflowing = target.scrollWidth > target.clientWidth
      if (isOverflowing) {
        // 展示完整的路径（如果存在）或完整的文档名称
        target.title = tab.path || tab.name
      } else {
        target.removeAttribute('title')
      }
    })
    el.appendChild(name)

    const dirty = document.createElement('span')
    dirty.className = 'tab-dirty'
    el.appendChild(dirty)

    const close = document.createElement('button')
    close.className = 'tab-close'
    close.textContent = '×'
    close.addEventListener('click', (e) => {
      e.stopPropagation()
      closeTab(tab.id)
    })
    el.appendChild(close)

    el.addEventListener('click', () => switchTab(tab.id))

    // 【新增】监听右键点击事件
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      e.stopPropagation()
      showTabContextMenu(tab.id, e.clientX, e.clientY)
    })

    list.appendChild(el)
  }
}

// 显示右键菜单
function showTabContextMenu(tabId: string, x: number, y: number): void {
  rightClickedTabId = tabId
  
  if (!contextMenuEl) {
    contextMenuEl = document.createElement('div')
    contextMenuEl.id = 'tab-context-menu'
    contextMenuEl.className = 'tab-context-menu'
    document.body.appendChild(contextMenuEl)
    
    // 利用事件委托监听菜单项点击
    contextMenuEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement
      if (!target.classList.contains('tab-context-menu-item') || !rightClickedTabId) return
      
      const action = target.dataset.action
      if (action === 'close-current') {
        closeTab(rightClickedTabId)
      } else if (action === 'close-left') {
        closeLeftTabs(rightClickedTabId)
      } else if (action === 'close-right') {
        closeRightTabs(rightClickedTabId)
      } else if (action === 'close-others') {
        closeOtherTabs(rightClickedTabId)
      }
      hideTabContextMenu()
    })
  }

  // 动态生成菜单项
  contextMenuEl.innerHTML = `
    <div class="tab-context-menu-item" data-action="close-current">关闭当前文档</div>
    <div class="tab-context-menu-item" data-action="close-left">关闭左侧文档</div>
    <div class="tab-context-menu-item" data-action="close-right">关闭右侧文档</div>
    <div class="tab-context-menu-item" data-action="close-others">关闭其他文档</div>
  `

  contextMenuEl.style.display = 'block'

  // 防溢出安全定位
  const vw = window.innerWidth
  const vh = window.innerHeight
  const menuWidth = contextMenuEl.offsetWidth
  const menuHeight = contextMenuEl.offsetHeight

  let left = x
  let top = y

  if (x + menuWidth > vw) {
    left = vw - menuWidth - 8
  }
  if (y + menuHeight > vh) {
    top = vh - menuHeight - 8
  }

  left = Math.max(0, left)
  top = Math.max(0, top)

  contextMenuEl.style.left = `${left}px`
  contextMenuEl.style.top = `${top}px`
}

// 隐藏右键菜单
function hideTabContextMenu(): void {
  if (contextMenuEl) {
    contextMenuEl.style.display = 'none'
  }
  rightClickedTabId = null
}

// 辅助函数：关闭单个标签时的底层清理（通知 Rust 后端停止文件监听）
function cleanupTabBackend(tab: Tab): void {
  if (tab.path) {
    invoke('stop_watching_file', { path: tab.path }).catch(() => {})
  }
}

// ─── 3.1 关闭左侧文档 ───
function closeLeftTabs(targetId: string): void {
  const targetIdx = tabs.findIndex(t => t.id === targetId)
  if (targetIdx <= 0) return

  // 0. 首要执行当前 active 状态 Tab 的内容回写以防止数据丢失
  if (activeTabId) {
    const current = getActiveTab()
    if (current) {
      current.content = getMarkdown()
    }
  }

  // 1. 提取左侧待关闭的所有文档并通知后端清理
  const tabsToClose = tabs.slice(0, targetIdx)
  tabsToClose.forEach(cleanupTabBackend)

  // 2. 判定当前激活 of Tab 索引位置
  const activeTab = getActiveTab()
  const activeIdx = activeTab ? tabs.indexOf(activeTab) : -1

  // 3. 数组切片保留 target 及其右侧元素
  tabs = tabs.slice(targetIdx)

  // 4. 重定位激活状态
  if (activeIdx >= 0 && activeIdx < targetIdx) {
    // 激活页在被关闭的左侧区域，则强制将焦点切到当前选中的 targetId 文档上
    switchTab(targetId)
  } else {
    // 激活页在右侧完好无损，仅需重绘页签组件
    renderTabs()
    updateOutline()
  }
}

// ─── 3.2 关闭右侧文档 ───
function closeRightTabs(targetId: string): void {
  const targetIdx = tabs.findIndex(t => t.id === targetId)
  if (targetIdx === -1 || targetIdx >= tabs.length - 1) return

  // 0. 首要执行当前 active 状态 Tab 的内容回写以防止数据丢失
  if (activeTabId) {
    const current = getActiveTab()
    if (current) {
      current.content = getMarkdown()
    }
  }

  // 1. 提取右侧待关闭的所有文档并通知后端清理
  const tabsToClose = tabs.slice(targetIdx + 1)
  tabsToClose.forEach(cleanupTabBackend)

  // 2. 判定当前激活 of Tab 索引位置
  const activeTab = getActiveTab()
  const activeIdx = activeTab ? tabs.indexOf(activeTab) : -1

  // 3. 数组切片仅保留 0 到 target 索引区间
  tabs = tabs.slice(0, targetIdx + 1)

  // 4. 重定位激活状态
  if (activeIdx > targetIdx) {
    // 激活页在被关闭的右侧区域，则强制将焦点切到 targetId 文档上
    switchTab(targetId)
  } else {
    // 激活页在左侧完好无损，重绘组件
    renderTabs()
    updateOutline()
  }
}

// ─── 3.3 关闭其他文档 ───
function closeOtherTabs(targetId: string): void {
  const targetIdx = tabs.findIndex(t => t.id === targetId)
  if (targetIdx === -1) return

  // 0. 首要执行当前 active 状态 Tab 的内容回写以防止数据丢失
  if (activeTabId) {
    const current = getActiveTab()
    if (current) {
      current.content = getMarkdown()
    }
  }

  // 1. 清理除目标外所有标签的后端监听
  const tabsToClose = tabs.filter(t => t.id !== targetId)
  tabsToClose.forEach(cleanupTabBackend)

  // 2. 状态只保留这唯一的目标文档
  tabs = [tabs[targetIdx]]

  // 3. 强制切换激活焦点到该文档上
  switchTab(targetId)
}

function switchTab(id: string): void {
  // Save current tab's content before switching
  if (activeTabId) {
    const current = getActiveTab()
    if (current) {
      current.content = getMarkdown()
      syncCommentsFromEditor(current)
    }
  }

  activeTabId = id
  const tab = getActiveTab()
  if (!tab) return

  // Load the tab's content into the editor
  setMarkdown(tab.content)

  // Update window title
  document.title = tab.name + (tab.isDirty ? ' •' : '') + ' — MarkFlow'

  // Update active file in backend state so Ctrl+S saves the right file
  invoke('update_active_file', { path: tab.path }).catch(() => {})

  // Restore comments
  restoreCommentsForTab(tab).then(() => {
    renderComments()
  })

  renderTabs()
  updateOutline()
}

function openTab(path: string | null, content: string, name: string): Tab {
  const id = path || `untitled-${Date.now()}`

  // If tab already exists, just switch to it
  const existing = tabs.find(t => t.id === id)
  if (existing) {
    switchTab(id)
    return existing
  }

  // Save current tab's editor content before switching away
  if (activeTabId) {
    const currentTab = getActiveTab()
    if (currentTab) {
      currentTab.content = getMarkdown()
      syncCommentsFromEditor(currentTab)
    }
  }

  const tab: Tab = { id, path, name, isDirty: false, content }
  tabs.push(tab)
  activeTabId = id

  setMarkdown(content)
  document.title = name + ' — MarkFlow'

  // Update active file in backend state
  invoke('update_active_file', { path: tab.path }).catch(() => {})

  // Load and restore comments
  restoreCommentsForTab(tab).then(() => {
    renderComments()
  })

  renderTabs()
  updateOutline()

  return tab
}

function closeTab(id: string): void {
  const tab = tabs.find(t => t.id === id)
  if (!tab) return
  const index = tabs.indexOf(tab)

  // If the tab has a path, tell backend to stop watching it
  if (tab.path) {
    invoke('stop_watching_file', { path: tab.path }).catch(() => {})
  }

  // If it's the last tab, create a new untitled one
  if (tabs.length === 1) {
    tabs = []
    activeTabId = null
    openTab(null, '', 'Untitled')
    return
  }

  // Remove this tab
  tabs.splice(index, 1)

  // If closing the active tab, switch to another
  if (activeTabId === id) {
    const newIndex = Math.min(index, tabs.length - 1)
    const nextTab = tabs[newIndex]
    activeTabId = nextTab.id
    setMarkdown(nextTab.content)
    document.title = nextTab.name + ' — MarkFlow'
    invoke('update_active_file', { path: nextTab.path }).catch(() => {})
  }

  renderTabs()
  updateOutline()
}

function markDirty(): void {
  const tab = getActiveTab()
  if (!tab) return
  if (tab.isDirty) return
  tab.isDirty = true
  document.title = tab.name + ' • — MarkFlow'
  renderTabs()
}

// ─── Init ───────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  // Initialize theme
  const savedTheme = loadSavedTheme()
  applyTheme(savedTheme)

  // Apply saved content width (independent of theme)
  applyContentWidth(loadContentWidth())

  // Restore custom theme CSS from disk
  if (savedTheme.startsWith('custom:')) {
    const fileName = savedTheme.slice(7)
    try {
      const css = await invoke<string | null>('load_theme_css', { fileName })
      if (css) applyTheme(savedTheme, css)
    } catch (e) {
      console.error('Failed to load custom theme:', e)
    }
  }

  // Create editor — pass onChange so Milkdown's markdownUpdated listener
  // gets registered. Without this, emit('markdown-updated') is never called
  // and outline never refreshes during typing.
  await createEditor('editor', (markdown) => {
    emit('markdown-updated', { markdown }).catch(() => {})
  })

  // Restore outline sidebar visibility preference
  restoreOutlineState()

  // Initialize outline with current document
  initOutline()

  // Update outline on every content change
  listen('markdown-updated', () => {
    markDirty()
    updateOutline()
  })

  // ── New Tab button ──
  document.getElementById('tab-new')?.addEventListener('click', () => {
    openTab(null, '', 'Untitled')
  })

  // ── Keyboard shortcuts ──

  // Ctrl+S: save — direct call, not dispatchEvent (Tauri listen() does not
  // receive DOM CustomEvents from window.dispatchEvent in the webview)
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      handleSave()
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
      e.preventDefault()
      toggleSidebar()
    }
  })

  // Outline toggle button in titlebar
  document.getElementById('outline-toggle')?.addEventListener('click', () => {
    toggleSidebar()
  })

  // ── Content Width Slider ──
  const sliderWrap = document.getElementById('content-width-slider-wrap')!
  const slider = document.getElementById('content-width-slider') as HTMLInputElement
  const widthValue = document.getElementById('content-width-value')!

  // Sync slider + label from saved value on init
  const initialWidth = loadContentWidth()
  slider.value = String(initialWidth)
  widthValue.textContent = String(initialWidth)

  // Click the "780px" label to toggle slider panel
  document.getElementById('content-width-toggle')?.addEventListener('click', () => {
    sliderWrap.classList.toggle('open')
  })

  // Live preview while dragging
  slider.addEventListener('input', () => {
    const w = parseInt(slider.value, 10)
    applyContentWidth(w)
    widthValue.textContent = String(w)
  })

  // Save on mouseup / touchend
  slider.addEventListener('change', () => {
    setContentWidth(parseInt(slider.value, 10))
  })

  // ── Unified save handler — called by both Ctrl+S and menu-save ──
  async function handleSave(): Promise<void> {
    const tab = getActiveTab()
    if (!tab) return
    try {
      syncCommentsFromEditor(tab)

      if (tab.path) {
        // backend uses WindowState.file_path, which we update in switchTab/openTab
        await invoke('save_file', { content: getMarkdown() })
        tab.isDirty = false
        document.title = tab.name + ' — MarkFlow'
        await saveCompanionComments(tab.path, tab.comments || [])
        renderTabs()
        updateOutline()
      } else {
        const result = await invoke<FileData | null>('save_file_as', { content: getMarkdown() })
        if (result) {
          tab.path = result.path
          tab.id = result.path // upgrade ID from untitled to path
          tab.name = tabName(result.path)
          tab.isDirty = false
          document.title = tab.name + ' — MarkFlow'
          await saveCompanionComments(tab.path, tab.comments || [])
          renderTabs()
          updateOutline()
          // Update backend active file since the path changed
          invoke('update_active_file', { path: tab.path }).catch(() => {})
        }
      }
    } catch (e) {
      console.error('Failed to save file:', e)
    }
  }

  // ── Menu event listeners ──

  listen('menu-new', () => {
    openTab(null, '', 'Untitled')
  })

  listen('menu-open', async () => {
    try {
      const result = await invoke<FileData | null>('open_file')
      if (result) {
        openTab(result.path, result.content, tabName(result.path))
      }
    } catch (e) {
      console.error('Failed to open file:', e)
    }
  })

  listen('menu-save', () => {
    handleSave()
  })

  listen('menu-save-as', async () => {
    const tab = getActiveTab()
    if (!tab) return
    try {
      const result = await invoke<FileData | null>('save_file_as', { content: getMarkdown() })
      if (result) {
        tab.path = result.path
        tab.id = result.path
        tab.name = tabName(result.path)
        tab.isDirty = false
        document.title = tab.name + ' — MarkFlow'
        renderTabs()
        updateOutline()
        invoke('update_active_file', { path: tab.path }).catch(() => {})
      }
    } catch (e) {
      console.error('Failed to save file as:', e)
    }
  })

  listen('menu-export-pdf', async () => {
    try {
      await invoke('export_pdf')
    } catch (e) {
      console.error('Failed to export PDF:', e)
    }
  })

  listen('menu-export-html', async () => {
    try {
      const html = generateExportHTML()
      await invoke('export_html', { htmlContent: html })
    } catch (e) {
      console.error('Failed to export HTML:', e)
    }
  })

  // View → Sidebar → Right / Left
  listen< string>('sidebar-direction', (event) => {
    const dir = event.payload as 'right' | 'left'
    setSidebarDirection(dir)
  })

  // Handle file opened from CLI (double-click or file association)
  listen('open-file-from-cli', async (event) => {
    const filePath = event.payload as string
    try {
      const result = await invoke<FileData | null>('open_file_path', { path: filePath })
      if (result) {
        openTab(result.path, result.content, tabName(result.path))
      }
    } catch (e) {
      console.error('Failed to open file from CLI:', e)
    }
  })

  listen('menu-import-theme', async () => {
    try {
      const result = await invoke<{ name: string; css: string } | null>('load_custom_theme')
      if (result) {
        applyTheme(`custom:${result.name}`, result.css)
      }
    } catch (e) {
      console.error('Failed to import theme:', e)
    }
  })

  listen('set-theme', (event) => {
    const theme = event.payload as string
    applyTheme(theme)
  })

  // File change listener — route to the correct tab by path
  listen<{ path: string }>('file-changed', async (event) => {
    const changedPath = event.payload.path
    const tab = tabs.find(t => t.path === changedPath)
    if (!tab) return

    updateAgentStatus()

    try {
      const result = await invoke<FileData | null>('open_file_path', { path: changedPath })
      if (result) {
        if (tab.id === activeTabId) {
          // Active tab — reload directly
          setMarkdown(result.content)
          showToast('文档已刷新')
        } else {
          // Background tab — update content but don't switch
          tab.content = result.content
        }
      }
    } catch (e) {
      console.error('Failed to reload file:', e)
    }
  })

  // Handle drag-and-drop
  document.addEventListener('dragover', (e) => e.preventDefault())
  document.addEventListener('drop', async (e) => {
    e.preventDefault()
    const file = e.dataTransfer?.files[0]
    if (!file) return
    // In Tauri, we can use the path from the file object
    // For now, we'll need to handle this differently
    // This is a simplified version
  })

  // 【新增】全局点击关闭右键菜单
  document.addEventListener('click', () => {
    hideTabContextMenu()
  })

  // ── Comment Sidebar & Resize Handle Setup ──
  setupCommentResizeHandle()

  document.getElementById('comment-close-btn')?.addEventListener('click', () => {
    toggleCommentSidebar(false)
  })

  document.getElementById('comment-bubble-menu')?.addEventListener('click', () => {
    const bubbleMenu = document.getElementById('comment-bubble-menu')
    if (!bubbleMenu) return
    const from = parseInt(bubbleMenu.dataset.from || '0', 10)
    const to = parseInt(bubbleMenu.dataset.to || '0', 10)
    const quote = bubbleMenu.dataset.quote || ''
    
    bubbleMenu.style.display = 'none'
    addCommentDraft(from, to, quote)
  })

  window.addEventListener('comment-anchor-clicked', (e: Event) => {
    const commentId = (e as CustomEvent).detail.commentId
    const card = document.querySelector(`.comment-card[data-comment-id="${commentId}"]`)
    if (card) {
      document.querySelectorAll('.comment-card').forEach(c => c.classList.remove('highlighted'))
      card.classList.add('highlighted')
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  })

  // Start with a blank tab
  openTab(null, '', 'Untitled')
}

// ─── Agent Status Indicator ──────────────────────────────────────────────────

let agentStatusTimer: ReturnType<typeof setTimeout> | null = null

function updateAgentStatus(): void {
  const dot = document.getElementById('agent-dot')
  if (!dot) return

  // Transition to active (breathe animation)
  dot.classList.remove('cooldown')
  dot.classList.add('active')

  if (agentStatusTimer) clearTimeout(agentStatusTimer)

  // After 3s of no updates, transition to cooldown (green)
  agentStatusTimer = setTimeout(() => {
    dot.classList.remove('active')
    dot.classList.add('cooldown')

    // After another 5s, go back to idle
    agentStatusTimer = setTimeout(() => {
      dot.classList.remove('cooldown')
      agentStatusTimer = null
    }, 5000)
  }, 3000)
}

// ─── Export ─────────────────────────────────────────────────────────────────

function generateExportHTML(): string {
  const s = getComputedStyle(document.body)
  const v = (name: string) => s.getPropertyValue(name).trim()

  const bgColor = v('--bg-color')
  const textColor = v('--text-color')
  const textMuted = v('--text-muted')
  const borderColor = v('--border-color')
  const linkColor = v('--link-color')
  const codeBg = v('--code-bg')
  const codeBlockBg = v('--code-block-bg')
  const codeBlockText = v('--code-block-text') || textColor
  const blockquoteBorder = v('--blockquote-border')
  const blockquoteBg = v('--blockquote-bg') || 'transparent'
  const tableHeaderBg = v('--table-header-bg')
  const selectionBg = v('--selection-bg')

  const editor = document.querySelector('#editor .ProseMirror')
  const fontFamily = editor ? getComputedStyle(editor).fontFamily : '-apple-system,BlinkMacSystemFont,sans-serif'

  const getElColor = (selector: string, fallback: string): string => {
    const el = document.querySelector(`#editor .ProseMirror ${selector}`)
    return el ? getComputedStyle(el).color : fallback
  }
  const strongColor = getElColor('strong', textColor)
  const codeColor = getElColor('code', textColor)

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>MarkFlow Export</title>
<style>
body{max-width:780px;margin:40px auto;padding:20px;font-family:${fontFamily};line-height:1.75;background:${bgColor};color:${textColor}}
h1{font-size:2em;font-weight:700;border-bottom:1px solid ${borderColor};padding-bottom:.3em}
h2{font-size:1.5em;font-weight:600;border-bottom:1px solid ${borderColor};padding-bottom:.25em}
h3{font-size:1.25em;font-weight:600}
strong{color:${strongColor}}
a{color:${linkColor};text-decoration:none}
code{background:${codeBg};color:${codeColor};padding:2px 6px;border-radius:3px;font-size:.875em;font-family:'SF Mono','Fira Code',Menlo,monospace}
pre{background:${codeBlockBg};color:${codeBlockText};padding:16px;border-radius:6px;overflow-x:auto;margin:1em 0}
pre code{background:none;padding:0;color:inherit}
blockquote{border-left:4px solid ${blockquoteBorder};background:${blockquoteBg};padding-left:16px;margin:1em 0;color:${textMuted}}
table{border-collapse:collapse;width:100%;margin:1em 0}
th,td{border:1px solid ${borderColor};padding:8px 12px}
th{background:${tableHeaderBg};font-weight:600}
hr{border:none;border-top:2px solid ${borderColor};margin:2em 0}
img{max-width:100%}
::selection{background:${selectionBg}}
</style>
</head><body>${getHTML()}</body></html>`
}

// ─── Toast Notifications ─────────────────────────────────────────────────────

function showToast(message: string, duration = 3000): void {
  const toast = document.createElement('div')
  toast.className = 'toast'
  toast.textContent = message
  document.body.appendChild(toast)

  toast.offsetHeight

  toast.classList.add('toast-enter')

  setTimeout(() => {
    toast.classList.remove('toast-enter')
    toast.classList.add('toast-leave')
    setTimeout(() => toast.remove(), 400)
  }, duration)
}

// ─── Comment Management & Sidebar rendering ───

function toggleCommentSidebar(show?: boolean): void {
  const sidebar = document.getElementById('comment-sidebar')
  if (!sidebar) return

  const isHidden = sidebar.classList.contains('comment-hidden')
  const shouldShow = show !== undefined ? show : isHidden

  if (shouldShow) {
    sidebar.classList.remove('comment-hidden')
    
    // Low resolution check: if screen width < 1024px, hide outline sidebar
    if (window.innerWidth < 1024) {
      const outlineSidebar = document.getElementById('outline-sidebar')
      const layout = document.getElementById('editor-layout')
      if (outlineSidebar && !outlineSidebar.classList.contains('outline-hidden')) {
        outlineSidebar.classList.add('outline-hidden')
        layout?.classList.add('outline-full')
      }
    }
  } else {
    sidebar.classList.add('comment-hidden')
  }
}

function renderComments(): void {
  const container = document.getElementById('comment-list')
  const emptyEl = document.getElementById('comment-empty')
  if (!container) return

  container.innerHTML = ''
  
  const tab = getActiveTab()
  const comments = tab?.comments || []
  const activeComments = comments.filter(c => c.status === 'active')

  if (activeComments.length === 0) {
    emptyEl?.classList.add('visible')
    return
  }
  
  emptyEl?.classList.remove('visible')

  activeComments.forEach(comment => {
    const card = document.createElement('div')
    card.className = 'comment-card' + (comment.orphaned ? ' orphaned' : '')
    card.dataset.commentId = comment.commentId

    const quote = document.createElement('p')
    quote.className = 'comment-quote'
    quote.textContent = comment.orphaned ? `${comment.quote} (原文字已被删除)` : comment.quote
    card.appendChild(quote)

    const content = document.createElement('p')
    content.className = 'comment-content'
    content.textContent = comment.content
    card.appendChild(content)

    const meta = document.createElement('div')
    meta.className = 'comment-meta'

    const author = document.createElement('span')
    author.className = 'comment-author ' + comment.author
    author.textContent = comment.author === 'agent' ? 'AI Agent' : 'User'
    meta.appendChild(author)

    const resolveBtn = document.createElement('button')
    resolveBtn.className = 'comment-resolve-btn'
    resolveBtn.textContent = '解决'
    resolveBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      resolveComment(comment.commentId)
    })
    meta.appendChild(resolveBtn)

    card.appendChild(meta)

    card.addEventListener('mouseenter', () => {
      if (!comment.orphaned) {
        highlightCommentDecoration(comment.commentId, true)
      }
    })
    card.addEventListener('mouseleave', () => {
      if (!comment.orphaned) {
        highlightCommentDecoration(comment.commentId, false)
      }
    })

    card.addEventListener('click', () => {
      if (!comment.orphaned) {
        scrollEditorToComment(comment.commentId)
      }
    })

    container.appendChild(card)
  })
}

function resolveComment(commentId: string): void {
  const tab = getActiveTab()
  if (!tab || !tab.comments) return

  const comment = tab.comments.find(c => c.commentId === commentId)
  if (comment) {
    comment.status = 'resolved'
    removeCommentDecoration(commentId)
    renderComments()
    markDirty()
  }
}

function scrollEditorToComment(commentId: string): void {
  const ranges = getCommentRanges()
  const range = ranges.find(r => r.commentId === commentId)
  if (range) {
    scrollEditorToRange(range.from, range.to)
  }
}

function addCommentDraft(from: number, to: number, quote: string): void {
  const container = document.getElementById('comment-list')
  const emptyEl = document.getElementById('comment-empty')
  if (!container) return

  emptyEl?.classList.remove('visible')
  
  toggleCommentSidebar(true)

  const existingDraft = document.querySelector('.comment-draft-card')
  if (existingDraft) existingDraft.remove()

  const draftCard = document.createElement('div')
  draftCard.className = 'comment-draft-card'

  const quoteEl = document.createElement('p')
  quoteEl.className = 'comment-quote'
  quoteEl.textContent = quote
  draftCard.appendChild(quoteEl)

  const textarea = document.createElement('textarea')
  textarea.className = 'comment-draft-textarea'
  textarea.placeholder = '输入评论或修改建议...'
  draftCard.appendChild(textarea)

  const actions = document.createElement('div')
  actions.className = 'comment-draft-actions'

  const cancelBtn = document.createElement('button')
  cancelBtn.className = 'comment-btn comment-btn-secondary'
  cancelBtn.textContent = '取消'
  cancelBtn.addEventListener('click', () => {
    draftCard.remove()
    renderComments()
  })
  actions.appendChild(cancelBtn)

  const saveBtn = document.createElement('button')
  saveBtn.className = 'comment-btn comment-btn-primary'
  saveBtn.textContent = '提交'
  saveBtn.addEventListener('click', () => {
    const text = textarea.value.trim()
    if (!text) return
    
    const commentId = `comment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    const view = getEditorView()
    if (view) {
      const $from = view.state.doc.resolve(from)
      const start = $from.start()
      const end = $from.end()
      const context = view.state.doc.textBetween(start, end)
      const offsetInContext = from - start

      const tab = getActiveTab()
      if (tab) {
        if (!tab.comments) tab.comments = []
        
        const newComment: CommentMeta = {
          commentId,
          quote,
          content: text,
          author: 'user',
          status: 'active',
          timestamp: Date.now(),
          from,
          to,
          context,
          offsetInContext
        }
        tab.comments.push(newComment)
        
        addCommentDecoration(commentId, from, to)
        
        draftCard.remove()
        renderComments()
        markDirty()
      }
    }
  })
  actions.appendChild(saveBtn)

  draftCard.appendChild(actions)
  container.appendChild(draftCard)
  
  textarea.focus()
  draftCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

function setupCommentResizeHandle(): void {
  const handle = document.getElementById('resize-handle-right')
  const sidebar = document.getElementById('comment-sidebar')
  if (!handle || !sidebar) return

  let dragging = false
  let startX = 0
  let startWidth = 0

  handle.addEventListener('mousedown', (e: MouseEvent) => {
    if (sidebar.classList.contains('comment-hidden')) return
    dragging = true
    startX = e.clientX
    startWidth = sidebar.offsetWidth
    handle.classList.add('dragging')
    document.body.style.cursor = 'ew-resize'
    e.preventDefault()
  })

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!dragging) return
    const dx = e.clientX - startX
    const newWidth = Math.min(480, Math.max(240, startWidth - dx))
    sidebar.style.setProperty('--comment-width', newWidth + 'px')
  })

  document.addEventListener('mouseup', () => {
    if (!dragging) return
    dragging = false
    handle.classList.remove('dragging')
    document.body.style.cursor = ''
    const w = sidebar.offsetWidth
    localStorage.setItem('markflow-comment-width', String(w))
  })
}

async function loadCompanionComments(path: string): Promise<CommentMeta[]> {
  try {
    const companionPath = path + '.comments.json'
    const fileExists = await exists(companionPath)
    if (!fileExists) return []

    const text = await readTextFile(companionPath)
    const comments = JSON.parse(text) as CommentMeta[]
    return comments
  } catch (e) {
    console.error('Failed to load companion comments:', e)
    return []
  }
}

async function saveCompanionComments(path: string, comments: CommentMeta[]): Promise<void> {
  try {
    const companionPath = path + '.comments.json'
    if (comments.length === 0) {
      const fileExists = await exists(companionPath)
      if (fileExists) {
        await remove(companionPath)
      }
      return
    }

    const text = JSON.stringify(comments, null, 2)
    await writeTextFile(companionPath, text)
  } catch (e) {
    console.error('Failed to save companion comments:', e)
  }
}

function syncCommentsFromEditor(tab: Tab): void {
  if (!tab || !tab.comments) return
  
  const ranges = getCommentRanges()
  
  tab.comments.forEach(comment => {
    const range = ranges.find(r => r.commentId === comment.commentId)
    if (range) {
      comment.from = range.from
      comment.to = range.to
      comment.quote = range.quote
      comment.orphaned = false

      const view = getEditorView()
      if (view) {
        const $from = view.state.doc.resolve(range.from)
        const start = $from.start()
        const end = $from.end()
        comment.context = view.state.doc.textBetween(start, end)
        comment.offsetInContext = range.from - start
      }
    } else if (!comment.orphaned && comment.status === 'active') {
      comment.orphaned = true
    }
  })
}

async function restoreCommentsForTab(tab: Tab): Promise<void> {
  if (!tab.comments) {
    if (tab.path) {
      tab.comments = await loadCompanionComments(tab.path)
    } else {
      tab.comments = []
    }
  }

  const view = getEditorView()
  if (!view) return

  const doc = view.state.doc

  tab.comments.forEach(comment => {
    if (comment.status === 'resolved') return

    if (comment.from < doc.content.size && comment.to <= doc.content.size) {
      const currentText = doc.textBetween(comment.from, comment.to)
      if (currentText === comment.quote) {
        comment.orphaned = false
        return
      }
    }

    let bestMatch: { pos: number; text: string; distance: number } | null = null
    let minDistance = Infinity
    const threshold = Math.ceil(comment.context.length * 0.20)

    doc.descendants((node: any, pos: number) => {
      if (node.isTextblock) {
        const text = node.textContent
        if (!text) return
        
        const dist = getLevenshteinDistance(comment.context, text)
        if (dist <= threshold && dist < minDistance) {
          minDistance = dist
          bestMatch = { pos, text, distance: dist }
        }
      }
    })

    if (bestMatch) {
      const match = bestMatch as { pos: number; text: string; distance: number }
      let index = match.text.indexOf(comment.quote)
      if (index === -1) {
        index = Math.max(0, Math.min(comment.offsetInContext, match.text.length - comment.quote.length))
      }
      
      comment.from = match.pos + 1 + index
      comment.to = comment.from + comment.quote.length
      comment.orphaned = false
      
      comment.context = match.text
      comment.offsetInContext = index
    } else {
      comment.orphaned = true
    }
  })

  setCommentDecorations(tab.comments)
}

// ─── AI Agent APIs ───

;(window as any).getActiveComments = () => {
  const tab = getActiveTab()
  if (!tab || !tab.comments) return []
  
  syncCommentsFromEditor(tab)

  return tab.comments
    .filter(c => c.status === 'active')
    .map(c => ({
      commentId: c.commentId,
      quote: c.quote,
      content: c.content,
      author: c.author,
      status: c.status,
      timestamp: c.timestamp,
      from: c.from,
      to: c.to,
      orphaned: c.orphaned,
      context: c.context,
      offsetInContext: c.offsetInContext
    }))
}

;(window as any).applyCommentResolution = (commentId: string, replacementText: string) => {
  const tab = getActiveTab()
  if (!tab || !tab.comments) return false

  syncCommentsFromEditor(tab)

  const comment = tab.comments.find(c => c.commentId === commentId)
  if (!comment || comment.status !== 'active') return false

  const view = getEditorView()
  if (!view) return false

  if (comment.orphaned) {
    comment.status = 'resolved'
    renderComments()
    markDirty()
    return true
  }

  const tr = view.state.tr
  tr.replaceWith(comment.from, comment.to, view.state.schema.text(replacementText))
  
  tr.setMeta(commentPluginKey, {
    type: 'REMOVE_COMMENT',
    commentId
  })

  comment.status = 'resolved'

  view.dispatch(tr)
  view.focus()

  syncCommentsFromEditor(tab)
  renderComments()
  markDirty()

  return true
}

init().catch((e) => console.error('MarkFlow init failed:', e))