import { invoke } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { createEditor, getMarkdown, getHTML, setMarkdown, getEditorView, parseMarkdownToSlice } from './editor/editor'
import { applyTheme, loadSavedTheme, setContentWidth, loadContentWidth, applyContentWidth } from './themes/theme-manager'
import { initOutline, updateOutline, toggleSidebar, restoreOutlineState, setSidebarDirection } from './editor/outline'
import { Selection } from '@milkdown/kit/prose/state'
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
    
    // 智能 Tooltip 展示：仅在文本溢出被截断时展示完整文件路径/文件名
    name.addEventListener('mouseenter', (e) => {
      const target = e.currentTarget as HTMLElement
      // 检查当前文字 of 实际渲染宽度是否大于容器的可视宽度
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

    // 监听右键点击事件
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

// 关闭左侧文档
function closeLeftTabs(targetId: string): void {
  const targetIdx = tabs.findIndex(t => t.id === targetId)
  if (targetIdx <= 0) return

  // 首要执行当前 active 状态 Tab 的内容回写以防止数据丢失
  if (activeTabId) {
    const current = getActiveTab()
    if (current) {
      current.content = getMarkdown()
    }
  }

  // 提取左侧待关闭的所有文档并通知后端清理
  const tabsToClose = tabs.slice(0, targetIdx)
  tabsToClose.forEach(cleanupTabBackend)

  // 判定当前激活 of Tab 索引位置
  const activeTab = getActiveTab()
  const activeIdx = activeTab ? tabs.indexOf(activeTab) : -1

  // 数组切片保留 target 及其右侧元素
  tabs = tabs.slice(targetIdx)

  // 重定位激活状态
  if (activeIdx >= 0 && activeIdx < targetIdx) {
    switchTab(targetId)
  } else {
    renderTabs()
    updateOutline()
  }
}

// 关闭右侧文档
function closeRightTabs(targetId: string): void {
  const targetIdx = tabs.findIndex(t => t.id === targetId)
  if (targetIdx === -1 || targetIdx >= tabs.length - 1) return

  // 首要执行当前 active 状态 Tab 的内容回写以防止数据丢失
  if (activeTabId) {
    const current = getActiveTab()
    if (current) {
      current.content = getMarkdown()
    }
  }

  // 提取右侧待关闭的所有文档并通知后端清理
  const tabsToClose = tabs.slice(targetIdx + 1)
  tabsToClose.forEach(cleanupTabBackend)

  // 判定当前激活 of Tab 索引位置
  const activeTab = getActiveTab()
  const activeIdx = activeTab ? tabs.indexOf(activeTab) : -1

  // 数组切片仅保留 0 到 target 索引区间
  tabs = tabs.slice(0, targetIdx + 1)

  // 重定位激活状态
  if (activeIdx > targetIdx) {
    switchTab(targetId)
  } else {
    renderTabs()
    updateOutline()
  }
}

// 关闭其他文档
function closeOtherTabs(targetId: string): void {
  const targetIdx = tabs.findIndex(t => t.id === targetId)
  if (targetIdx === -1) return

  // 首要执行当前 active 状态 Tab 的内容回写以防止数据丢失
  if (activeTabId) {
    const current = getActiveTab()
    if (current) {
      current.content = getMarkdown()
    }
  }

  // 清理除目标外所有标签的后端监听
  const tabsToClose = tabs.filter(t => t.id !== targetId)
  tabsToClose.forEach(cleanupTabBackend)

  // 状态只保留这唯一的目标文档
  tabs = [tabs[targetIdx]]

  // 强制切换激活焦点到该文档上
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

function scrollEditorToRange(from: number, _to: number): void {
  const view = getEditorView()
  if (!view) return
  const tr = view.state.tr
  try {
    const $pos = view.state.doc.resolve(from)
    const selection = Selection.near($pos)
    tr.setSelection(selection)
    tr.scrollIntoView()
    view.dispatch(tr)
    view.focus()
  } catch (e) {
    console.error('Failed to scroll editor to range:', e)
  }
}

// ─── CriticMarkup Panel & Actions ───────────────────────────────────────────

interface CriticItem {
  type: 'addition' | 'deletion' | 'substitution' | 'comment' | 'highlight'
  id: string
  from: number
  to: number
  content: string
  quote: string
  original?: string
}

function scanCriticMarkup(): CriticItem[] {
  const view = getEditorView()
  if (!view) return []

  const doc = view.state.doc
  const items: CriticItem[] = []

  doc.descendants((node, pos) => {
    // Check nodes (critic-comment is a node)
    if (node.type.name === 'critic_comment') {
      items.push({
        type: 'comment',
        id: `comment-${pos}`,
        from: pos,
        to: pos + node.nodeSize,
        content: node.attrs.value || '',
        quote: ''
      })
    }

    // Check marks
    node.marks.forEach(mark => {
      if (mark.type.name === 'critic_addition') {
        items.push({
          type: 'addition',
          id: `addition-${pos}`,
          from: pos,
          to: pos + node.nodeSize,
          content: '建议插入此文本',
          quote: node.textContent
        })
      } else if (mark.type.name === 'critic_deletion') {
        items.push({
          type: 'deletion',
          id: `deletion-${pos}`,
          from: pos,
          to: pos + node.nodeSize,
          content: '建议删除此文本',
          quote: node.textContent
        })
      } else if (mark.type.name === 'critic_substitution') {
        items.push({
          type: 'substitution',
          id: `substitution-${pos}`,
          from: pos,
          to: pos + node.nodeSize,
          original: mark.attrs.original || '',
          content: `建议替换为 "${node.textContent}"`,
          quote: node.textContent
        })
      } else if (mark.type.name === 'critic_highlight') {
        items.push({
          type: 'highlight',
          id: `highlight-${pos}`,
          from: pos,
          to: pos + node.nodeSize,
          content: '高亮文本',
          quote: node.textContent
        })
      }
    })
  })

  const merged = mergeAdjacentCriticItems(items)
  renderCriticPanel(merged)
  return merged
}

function mergeAdjacentCriticItems(items: CriticItem[]): CriticItem[] {
  if (items.length === 0) return []

  items.sort((a, b) => a.from - b.from)

  const merged: CriticItem[] = [items[0]]

  for (let i = 1; i < items.length; i++) {
    const last = merged[merged.length - 1]
    const curr = items[i]

    if (curr.type !== 'comment' && last.type === curr.type && curr.from <= last.to) {
      last.to = Math.max(last.to, curr.to)
      if (curr.type === 'substitution') {
        last.original = (last.original || '') + (curr.original || '')
        last.quote += curr.quote
        last.content = `建议替换为 "${last.quote}"`
      } else {
        last.quote += curr.quote
      }
    } else {
      merged.push(curr)
    }
  }

  return merged
}

function renderCriticPanel(items: CriticItem[]): void {
  const container = document.getElementById('comment-list')
  const emptyEl = document.getElementById('comment-empty')
  if (!container) return

  container.innerHTML = ''

  if (items.length === 0) {
    emptyEl?.classList.add('visible')
    return
  }

  emptyEl?.classList.remove('visible')

  items.forEach(item => {
    const card = document.createElement('div')
    card.className = `comment-card ${item.type}`
    card.dataset.from = String(item.from)
    card.dataset.to = String(item.to)

    // Tag / Badge
    const tag = document.createElement('span')
    tag.className = 'comment-card-tag'
    if (item.type === 'addition') tag.textContent = '建议增加'
    else if (item.type === 'deletion') tag.textContent = '建议删除'
    else if (item.type === 'substitution') tag.textContent = '建议替换'
    else if (item.type === 'comment') tag.textContent = '批注'
    else if (item.type === 'highlight') tag.textContent = '高亮'
    card.appendChild(tag)

    // Quote text (for marks)
    if (item.type !== 'comment' && item.quote) {
      const quote = document.createElement('p')
      if (item.type === 'substitution' && item.original) {
        quote.className = 'comment-quote'
        quote.textContent = `原: ${item.original}`
      } else {
        quote.className = 'comment-quote'
        quote.textContent = item.quote
      }
      card.appendChild(quote)
    }

    // Content description
    const content = document.createElement('p')
    content.className = 'comment-content'
    content.textContent = item.content
    card.appendChild(content)

    // Meta + Action buttons
    const meta = document.createElement('div')
    meta.className = 'comment-meta'

    const actions = document.createElement('div')
    actions.className = 'comment-actions'

    if (item.type === 'comment') {
      const resolveBtn = document.createElement('button')
      resolveBtn.className = 'comment-btn accept'
      resolveBtn.textContent = '解决'
      resolveBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        resolveCriticComment(item.from, item.to)
      })
      actions.appendChild(resolveBtn)
    } else if (item.type === 'addition' || item.type === 'deletion' || item.type === 'substitution' || item.type === 'highlight') {
      const acceptBtn = document.createElement('button')
      acceptBtn.className = 'comment-btn accept'
      acceptBtn.textContent = '接受'
      acceptBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        acceptCriticSuggestion(item.type, item.from, item.to)
      })

      const rejectBtn = document.createElement('button')
      rejectBtn.className = 'comment-btn reject'
      rejectBtn.textContent = '拒绝'
      rejectBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        rejectCriticSuggestion(item.type, item.from, item.to, item.original || '')
      })

      actions.appendChild(acceptBtn)
      actions.appendChild(rejectBtn)
    }

    meta.appendChild(actions)
    card.appendChild(meta)

    // Click card to scroll editor to the item range
    card.addEventListener('click', () => {
      scrollEditorToRange(item.from, item.to)
      // Visually highlight card
      document.querySelectorAll('.comment-card').forEach(c => c.classList.remove('highlighted'))
      card.classList.add('highlighted')
    })

    container.appendChild(card)
  })
}

// ─── Suggestions/Comments Transactions ─────────────────────────────────────

function resolveCriticComment(from: number, to: number): void {
  const view = getEditorView()
  if (!view) return
  const tr = view.state.tr
  tr.delete(from, to)
  view.dispatch(tr)
  view.focus()
  scanCriticMarkup()
  markDirty()
}

function acceptCriticSuggestion(type: string, from: number, to: number): void {
  const view = getEditorView()
  if (!view) return
  const tr = view.state.tr
  const schema = view.state.schema

  if (type === 'addition') {
    tr.removeMark(from, to, schema.marks.critic_addition)
  } else if (type === 'deletion') {
    tr.delete(from, to)
  } else if (type === 'substitution') {
    tr.removeMark(from, to, schema.marks.critic_substitution)
  } else if (type === 'highlight') {
    tr.removeMark(from, to, schema.marks.critic_highlight)
  }

  view.dispatch(tr)
  view.focus()
  scanCriticMarkup()
  markDirty()
}

function rejectCriticSuggestion(type: string, from: number, to: number, original: string): void {
  const view = getEditorView()
  if (!view) return
  const tr = view.state.tr
  const schema = view.state.schema

  if (type === 'addition') {
    tr.delete(from, to)
  } else if (type === 'deletion') {
    tr.removeMark(from, to, schema.marks.critic_deletion)
  } else if (type === 'substitution') {
    const slice = parseMarkdownToSlice(original)
    if (slice) {
      tr.replace(from, to, slice)
    } else {
      tr.delete(from, to)
    }
  } else if (type === 'highlight') {
    tr.removeMark(from, to, schema.marks.critic_highlight)
  }

  view.dispatch(tr)
  view.focus()
  scanCriticMarkup()
  markDirty()
}

// ─── Comment Sidebar UI Controls ──────────────────────────────────────────

function toggleCommentSidebar(show?: boolean): void {
  const sidebar = document.getElementById('comment-sidebar')
  const handle = document.getElementById('comment-resize-handle')
  if (!sidebar || !handle) return

  const isHidden = sidebar.classList.contains('comment-hidden')
  const targetShow = show !== undefined ? show : isHidden

  if (targetShow) {
    sidebar.classList.remove('comment-hidden')
    handle.style.display = 'block'
    scanCriticMarkup()
  } else {
    sidebar.classList.add('comment-hidden')
    handle.style.display = 'none'
  }
}

function setupCommentResizeHandle(): void {
  const handle = document.getElementById('comment-resize-handle')
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
    handle.classList.add('resizing')
    document.body.style.cursor = 'ew-resize'
    e.preventDefault()
  })

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!dragging) return
    const dx = e.clientX - startX
    const newWidth = Math.min(480, Math.max(200, startWidth - dx))
    sidebar.style.width = newWidth + 'px'
  })

  document.addEventListener('mouseup', () => {
    if (!dragging) return
    dragging = false
    handle.classList.remove('resizing')
    document.body.style.cursor = ''
  })
}

// ─── Draft Creation Helpers ─────────────────────────────────────────────────

function addCriticCommentDraft(from: number, to: number): void {
  const comment = prompt("请输入批注内容：")
  if (!comment) return

  const view = getEditorView()
  if (!view) return
  const tr = view.state.tr
  const schema = view.state.schema
  const markType = schema.marks.critic_highlight
  const nodeType = schema.nodes.critic_comment

  tr.addMark(from, to, markType.create())
  tr.insert(to, nodeType.create({ value: comment }))
  view.dispatch(tr)
  view.focus()
  scanCriticMarkup()
  markDirty()
}

function addCriticSubstitutionDraft(from: number, to: number, original: string): void {
  const replacement = prompt("请输入建议替换的新文本：", original)
  if (replacement === null || replacement === original) return

  const view = getEditorView()
  if (!view) return
  const tr = view.state.tr
  const schema = view.state.schema
  const markType = schema.marks.critic_substitution

  tr.replaceWith(from, to, schema.text(replacement))
  const newTo = from + replacement.length
  tr.addMark(from, newTo, markType.create({ original }))
  
  view.dispatch(tr)
  view.focus()
  scanCriticMarkup()
  markDirty()
}

function addCriticDeletionDraft(from: number, to: number): void {
  const view = getEditorView()
  if (!view) return
  const tr = view.state.tr
  const schema = view.state.schema
  const markType = schema.marks.critic_deletion

  tr.addMark(from, to, markType.create())
  view.dispatch(tr)
  view.focus()
  scanCriticMarkup()
  markDirty()
}

function addCriticAdditionDraft(from: number, to: number): void {
  const view = getEditorView()
  if (!view) return
  const tr = view.state.tr
  const schema = view.state.schema
  const markType = schema.marks.critic_addition

  if (from === to) {
    const insertion = prompt("请输入建议插入的文本：")
    if (!insertion) return
    tr.insertText(insertion, from)
    tr.addMark(from, from + insertion.length, markType.create())
  } else {
    tr.addMark(from, to, markType.create())
  }
  view.dispatch(tr)
  view.focus()
  scanCriticMarkup()
  markDirty()
}

function addCriticHighlightDraft(from: number, to: number): void {
  const view = getEditorView()
  if (!view) return
  const tr = view.state.tr
  const schema = view.state.schema
  const markType = schema.marks.critic_highlight

  tr.addMark(from, to, markType.create())
  view.dispatch(tr)
  view.focus()
  scanCriticMarkup()
  markDirty()
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

  // Create editor
  await createEditor('editor', (markdown) => {
    emit('markdown-updated', { markdown }).catch(() => {})
  })

  // Restore outline sidebar visibility preference
  restoreOutlineState()

  // Initialize outline with current document
  initOutline()

  // Update outline and CriticMarkup panel on every content change (with debounce)
  let scanTimer: ReturnType<typeof setTimeout> | null = null
  listen('markdown-updated', () => {
    markDirty()
    updateOutline()
    if (scanTimer) clearTimeout(scanTimer)
    scanTimer = setTimeout(() => {
      scanCriticMarkup()
    }, 300)
  })

  // New Tab button
  document.getElementById('tab-new')?.addEventListener('click', () => {
    openTab(null, '', 'Untitled')
  })

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      handleSave()
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
      e.preventDefault()
      toggleSidebar()
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
      e.preventDefault()
      toggleCommentSidebar()
    }
  })

  // Outline toggle button in titlebar
  document.getElementById('outline-toggle')?.addEventListener('click', () => {
    toggleSidebar()
  })

  // Content Width Slider
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

  // Unified save handler
  async function handleSave(): Promise<void> {
    const tab = getActiveTab()
    if (!tab) return
    try {
      if (tab.path) {
        await invoke('save_file', { content: getMarkdown() })
        tab.isDirty = false
        document.title = tab.name + ' — MarkFlow'
        renderTabs()
        updateOutline()
      } else {
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
      }
    } catch (e) {
      console.error('Failed to save file:', e)
    }
  }

  // Menu event listeners
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
  listen<string>('sidebar-direction', (event) => {
    const dir = event.payload as 'right' | 'left'
    setSidebarDirection(dir)
  })

  // Handle file opened from CLI
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

  // File change listener
  listen<{ path: string }>('file-changed', async (event) => {
    const changedPath = event.payload.path
    const tab = tabs.find(t => t.path === changedPath)
    if (!tab) return

    updateAgentStatus()

    try {
      const result = await invoke<FileData | null>('open_file_path', { path: changedPath })
      if (result) {
        if (tab.id === activeTabId) {
          setMarkdown(result.content)
          showToast('文档已刷新')
        } else {
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
  })

  // 全局点击关闭右键菜单
  document.addEventListener('click', () => {
    hideTabContextMenu()
  })

  // ── Comment Sidebar & Resize Handle Setup ──
  setupCommentResizeHandle()

  document.getElementById('comment-close-btn')?.addEventListener('click', () => {
    toggleCommentSidebar(false)
  })

  // Hide bubble menu on scroll of the editor
  const editorEl = document.getElementById('editor')
  if (editorEl) {
    editorEl.addEventListener('scroll', () => {
      const bubbleMenu = document.getElementById('comment-bubble-menu')
      if (bubbleMenu && bubbleMenu.style.display !== 'none') {
        bubbleMenu.style.display = 'none'
      }
    })
  }

  // Hide bubble menu on click outside editor / bubble menu
  document.addEventListener('mousedown', (e) => {
    const bubbleMenu = document.getElementById('comment-bubble-menu')
    if (bubbleMenu && bubbleMenu.style.display !== 'none') {
      const target = e.target as HTMLElement
      if (!bubbleMenu.contains(target) && !document.getElementById('editor')?.contains(target)) {
        bubbleMenu.style.display = 'none'
      }
    }
  })

  // Custom Event for inline comment bubbles click
  window.addEventListener('critic-comment-clicked', (e: Event) => {
    toggleCommentSidebar(true)
    const detail = (e as CustomEvent).detail
    const from = detail.from
    const card = document.querySelector(`.comment-card[data-from="${from}"]`)
    if (card) {
      document.querySelectorAll('.comment-card').forEach(c => c.classList.remove('highlighted'))
      card.classList.add('highlighted')
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  })

  // Bubble menu actions
  document.getElementById('bubble-comment-btn')?.addEventListener('click', () => {
    const bubbleMenu = document.getElementById('comment-bubble-menu')
    if (!bubbleMenu) return
    const from = parseInt(bubbleMenu.dataset.from || '0', 10)
    const to = parseInt(bubbleMenu.dataset.to || '0', 10)
    bubbleMenu.style.display = 'none'
    addCriticCommentDraft(from, to)
  })

  document.getElementById('bubble-substitution-btn')?.addEventListener('click', () => {
    const bubbleMenu = document.getElementById('comment-bubble-menu')
    if (!bubbleMenu) return
    const from = parseInt(bubbleMenu.dataset.from || '0', 10)
    const to = parseInt(bubbleMenu.dataset.to || '0', 10)
    const quote = bubbleMenu.dataset.quote || ''
    bubbleMenu.style.display = 'none'
    addCriticSubstitutionDraft(from, to, quote)
  })

  document.getElementById('bubble-deletion-btn')?.addEventListener('click', () => {
    const bubbleMenu = document.getElementById('comment-bubble-menu')
    if (!bubbleMenu) return
    const from = parseInt(bubbleMenu.dataset.from || '0', 10)
    const to = parseInt(bubbleMenu.dataset.to || '0', 10)
    bubbleMenu.style.display = 'none'
    addCriticDeletionDraft(from, to)
  })

  document.getElementById('bubble-addition-btn')?.addEventListener('click', () => {
    const bubbleMenu = document.getElementById('comment-bubble-menu')
    if (!bubbleMenu) return
    const from = parseInt(bubbleMenu.dataset.from || '0', 10)
    const to = parseInt(bubbleMenu.dataset.to || '0', 10)
    bubbleMenu.style.display = 'none'
    addCriticAdditionDraft(from, to)
  })

  document.getElementById('bubble-highlight-btn')?.addEventListener('click', () => {
    const bubbleMenu = document.getElementById('comment-bubble-menu')
    if (!bubbleMenu) return
    const from = parseInt(bubbleMenu.dataset.from || '0', 10)
    const to = parseInt(bubbleMenu.dataset.to || '0', 10)
    bubbleMenu.style.display = 'none'
    addCriticHighlightDraft(from, to)
  })

  // Start with a blank tab
  openTab(null, '', 'Untitled')
}

// ─── Agent Status Indicator ──────────────────────────────────────────────────

let agentStatusTimer: ReturnType<typeof setTimeout> | null = null

function updateAgentStatus(): void {
  const dot = document.getElementById('agent-dot')
  if (!dot) return

  dot.classList.remove('cooldown')
  dot.classList.add('active')

  if (agentStatusTimer) clearTimeout(agentStatusTimer)

  agentStatusTimer = setTimeout(() => {
    dot.classList.remove('active')
    dot.classList.add('cooldown')

    agentStatusTimer = setTimeout(() => {
      dot.classList.remove('cooldown')
    }, 5000)
  }, 3000)
}

// ─── Export HTML Generation Helper ───────────────────────────────────────────

function generateExportHTML(): string {
  const tab = getActiveTab()
  const title = tab ? tab.name : 'Untitled'
  const computedStyle = getComputedStyle(document.body)
  const fontSans = computedStyle.getPropertyValue('--font-sans')
  const bgColor = computedStyle.getPropertyValue('--bg-color')
  const textColor = computedStyle.getPropertyValue('--text-color')
  const linkColor = computedStyle.getPropertyValue('--link-color')
  const borderColor = computedStyle.getPropertyValue('--border-color')
  const tableHeaderBg = computedStyle.getPropertyValue('--table-header-bg')
  const tableBorder = computedStyle.getPropertyValue('--table-border')
  const selectionBg = computedStyle.getPropertyValue('--selection-bg')
  const codeBg = computedStyle.getPropertyValue('--code-bg')
  const codeColor = computedStyle.getPropertyValue('--code-color')
  const codeBlockBg = computedStyle.getPropertyValue('--code-block-bg')
  const codeBlockText = computedStyle.getPropertyValue('--code-block-text')
  const blockquoteBg = computedStyle.getPropertyValue('--blockquote-bg')
  const blockquoteBorder = computedStyle.getPropertyValue('--blockquote-border')
  const textMuted = computedStyle.getPropertyValue('--text-muted')
  const strongColor = computedStyle.getPropertyValue('--strong-color')

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>
body{font-family:${fontSans};background:${bgColor};color:${textColor};line-height:1.6;padding:40px max(24px, (100vw - 780px)/2)}
h1,h2,h3,h4,h5,h6{color:${textColor}}
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
th,td{border:1px solid ${tableBorder || borderColor};padding:8px 12px}
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

// ─── AI Agent APIs ──────────────────────────────────────────────────────────

;(window as any).getActiveComments = () => {
  return scanCriticMarkup().map(item => ({
    commentId: item.id,
    type: item.type,
    from: item.from,
    to: item.to,
    content: item.content,
    quote: item.quote,
    original: item.original
  }))
}

;(window as any).applyCommentResolution = (commentId: string, action: string) => {
  const items = scanCriticMarkup()
  const item = items.find(i => i.id === commentId)
  if (!item) return false

  if (action === 'accept') {
    if (item.type === 'comment') {
      resolveCriticComment(item.from, item.to)
    } else {
      acceptCriticSuggestion(item.type, item.from, item.to)
    }
    return true
  } else if (action === 'reject') {
    if (item.type === 'comment') {
      resolveCriticComment(item.from, item.to)
    } else {
      rejectCriticSuggestion(item.type, item.from, item.to, item.original || '')
    }
    return true
  }
  return false
}

;(window as any).addCriticComment = (from: number, to: number, comment: string) => {
  const view = getEditorView()
  if (!view) return false
  const tr = view.state.tr
  const schema = view.state.schema
  const markType = schema.marks.critic_highlight
  const nodeType = schema.nodes.critic_comment

  tr.addMark(from, to, markType.create())
  tr.insert(to, nodeType.create({ value: comment }))
  view.dispatch(tr)
  view.focus()
  scanCriticMarkup()
  markDirty()
  return true
}

;(window as any).addCriticSuggestion = (from: number, to: number, newText: string) => {
  const view = getEditorView()
  if (!view) return false
  const tr = view.state.tr
  const schema = view.state.schema
  const markType = schema.marks.critic_substitution
  const original = view.state.doc.textBetween(from, to)

  tr.replaceWith(from, to, schema.text(newText))
  tr.addMark(from, from + newText.length, markType.create({ original }))
  view.dispatch(tr)
  view.focus()
  scanCriticMarkup()
  markDirty()
  return true
}

;(window as any).addCriticDeletion = (from: number, to: number) => {
  const view = getEditorView()
  if (!view) return false
  const tr = view.state.tr
  const schema = view.state.schema
  const markType = schema.marks.critic_deletion

  tr.addMark(from, to, markType.create())
  view.dispatch(tr)
  view.focus()
  scanCriticMarkup()
  markDirty()
  return true
}

;(window as any).acceptAllSuggestions = () => {
  const items = scanCriticMarkup()
  if (items.length === 0) return 0
  
  items.sort((a, b) => b.from - a.from)
  
  items.forEach(item => {
    if (item.type === 'comment') {
      resolveCriticComment(item.from, item.to)
    } else {
      acceptCriticSuggestion(item.type, item.from, item.to)
    }
  })
  return items.length
}

;(window as any).rejectAllSuggestions = () => {
  const items = scanCriticMarkup()
  if (items.length === 0) return 0
  
  items.sort((a, b) => b.from - a.from)
  
  items.forEach(item => {
    if (item.type === 'comment') {
      resolveCriticComment(item.from, item.to)
    } else {
      rejectCriticSuggestion(item.type, item.from, item.to, item.original || '')
    }
  })
  return items.length
}

// ─── Start ──────────────────────────────────────────────────────────────────

init().catch((e) => console.error('MarkFlow init failed:', e))