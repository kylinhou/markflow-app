import { invoke } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { createEditor, getMarkdown, getHTML, setMarkdown } from './editor/editor'
import { applyTheme, loadSavedTheme, setContentWidth, loadContentWidth, applyContentWidth } from './themes/theme-manager'
import { initOutline, updateOutline, toggleSidebar, restoreOutlineState, setSidebarDirection } from './editor/outline'
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

interface Tab {
  id: string          // unique tab identifier (file path or temp id)
  path: string | null // null = untitled
  name: string        // display name
  isDirty: boolean    // unsaved changes
  content: string     // current editor content for this tab
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
  contextMenuEl.style.left = `${x}px`
  contextMenuEl.style.top = `${y}px`
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
    }
  }

  const tab: Tab = { id, path, name, isDirty: false, content }
  tabs.push(tab)
  activeTabId = id

  setMarkdown(content)
  document.title = name + ' — MarkFlow'

  // Update active file in backend state
  invoke('update_active_file', { path: tab.path }).catch(() => {})

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
      if (tab.path) {
        // backend uses WindowState.file_path, which we update in switchTab/openTab
        await invoke('save_file', { content: getMarkdown() })
        tab.isDirty = false
        document.title = tab.name + ' — MarkFlow'
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

init().catch((e) => console.error('MarkFlow init failed:', e))