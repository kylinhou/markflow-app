import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { createEditor, getMarkdown, getHTML, setMarkdown } from './editor/editor'
import { applyTheme, loadSavedTheme } from './themes/theme-manager'
import { initOutline, updateOutline, toggleSidebar, restoreOutlineState } from './editor/outline'
import './themes/base.css'

// Types
interface FileData {
  path: string
  content: string
}

// State
let currentFilePath: string | null = null

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
    updateOutline()
  })

  // Keyboard shortcut: Ctrl+Shift+O toggles outline sidebar
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
      e.preventDefault()
      toggleSidebar()
    }
  })

  // Outline toggle button in titlebar
  const toggleBtn = document.getElementById('outline-toggle')
  toggleBtn?.addEventListener('click', () => {
    toggleSidebar()
  })

  // Menu event listeners
  listen('menu-open', async () => {
    try {
      const result = await invoke<FileData | null>('open_file')
      if (result) {
        currentFilePath = result.path
        setMarkdown(result.content)
      }
    } catch (e) {
      console.error('Failed to open file:', e)
    }
  })

  listen('menu-save', async () => {
    try {
      await invoke('save_file', { content: getMarkdown() })
    } catch (e) {
      console.error('Failed to save file:', e)
    }
  })

  listen('menu-save-as', async () => {
    try {
      await invoke('save_file_as', { content: getMarkdown() })
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
      const result = await invoke<{ content: string; path: string } | null>('open_file_path', { path: filePath })
      if (result) {
        currentFilePath = result.path
        setMarkdown(result.content)
        // Update window title
        const fileName = result.path.split(/[\/]/).pop() || 'Untitled'
        document.title = fileName + ' — MarkFlow'
      }
    } catch (e) {
      console.error('Failed to open file from CLI:', e)
    }
  })

  listen('menu-new', () => {
    currentFilePath = null
    setMarkdown('')
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
  listen('file-changed', async () => {
    if (currentFilePath) {
      try {
        const result = await invoke<FileData | null>('open_file_path', { 
          path: currentFilePath 
        })
        if (result) {
          setMarkdown(result.content)
        }
      } catch (e) {
        console.error('Failed to reload file:', e)
      }
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
}

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

init().catch((e) => console.error('MarkFlow init failed:', e))
