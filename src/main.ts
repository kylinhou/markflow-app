import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { createEditor, getMarkdown, getHTML, setMarkdown } from './editor/editor'
import { applyTheme, loadSavedTheme } from './themes/theme-manager'
import { initOutline, updateOutline, toggleSidebar, restoreOutlineState } from './editor/outline'
import './themes/base.css'

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

    list.appendChild(el)
  }
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

  renderTabs()
  updateOutline()
}

function openTab(path: string | null, content: string, name: string): Tab {
  const id = path || `untitled-${Date.now()}`

  // If tab already exists, just switch to it
  const existing = tabs.find(t => t.id === id)
  if (existing) {
    activeTabId = id
    setMarkdown(existing.content)
    renderTabs()
    updateOutline()
    return existing
  }

  const tab: Tab = { id, path, name, isDirty: false, content }
  tabs.push(tab)
  activeTabId = id

  setMarkdown(content)
  document.title = name + ' — MarkFlow'

  renderTabs()
  updateOutline()

  return tab
}

function closeTab(id: string): void {
  const index = tabs.findIndex(t => t.id === id)
  if (index === -1) return

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
    activeTabId = tabs[newIndex].id
    setMarkdown(tabs[newIndex].content)
    document.title = tabs[newIndex].name + ' — MarkFlow'
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
  await createEditor('editor')

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

  // Ctrl+S: save — Untitled pages trigger Save As, saved pages call save directly
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      // Re-dispatch as a menu-save event so the existing handler takes care of everything
      window.dispatchEvent(new CustomEvent('menu-save'))
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

  listen('menu-save', async () => {
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
          // save_file_as returns new path info — update the tab
          tab.path = result.path
          tab.name = tabName(result.path)
          tab.isDirty = false
          document.title = tab.name + ' — MarkFlow'
          renderTabs()
          updateOutline()
        }
      }
    } catch (e) {
      console.error('Failed to save file:', e)
    }
  })

  listen('menu-save-as', async () => {
    const tab = getActiveTab()
    if (!tab) return
    try {
      const result = await invoke<FileData | null>('save_file_as', { content: getMarkdown() })
      if (result) {
        tab.path = result.path
        tab.name = tabName(result.path)
        tab.isDirty = false
        document.title = tab.name + ' — MarkFlow'
        renderTabs()
        updateOutline()
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

  // Start with a blank tab
  openTab(null, '', 'Untitled')
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