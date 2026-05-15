/**
 * Outline / Table of Contents sidebar for MarkFlow
 *
 * Features:
 * - Extracts h1-h6 headings from the ProseMirror document
 * - Renders a collapsible tree in the right sidebar
 * - Scroll spy: highlights the currently visible heading
 * - Click to navigate: scrolls editor to the heading
 */

import { getEditorView } from './editor'
import { TextSelection } from 'prosemirror-state'
import type { EditorView } from '@milkdown/kit/prose/view'

// ─── Types ─────────────────────────────────────────────────────────────────

interface HeadingItem {
  id: string       // unique DOM id assigned to the heading element
  text: string     // heading text content
  level: number    // 1-6
  pos: number      // ProseMirror document position
}

interface OutlineNode {
  item: HeadingItem
  children: OutlineNode[]
  collapsed: boolean
}

// ─── State ─────────────────────────────────────────────────────────────────

let currentTree: OutlineNode[] = []
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let observer: IntersectionObserver | null = null
let activeId: string | null = null

// ─── Utilities ─────────────────────────────────────────────────────────────

function generateId(index: number): string {
  return `outline-heading-${index}`
}

/**
 * Walk the ProseMirror doc and extract all heading nodes.
 * Uses node.textContent directly — no DOM fallback needed.
 * Empty headings (no text) are skipped.
 */
function extractHeadings(): HeadingItem[] {
  const view = getEditorView()
  if (!view) return []

  const items: HeadingItem[] = []
  let counter = 0

  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const level = node.attrs.level as number
      const text = node.textContent.trim()
      if (!text) return
      items.push({
        id: generateId(counter),
        text: text.length > 60 ? text.slice(0, 60) + '…' : text,
        level,
        pos,
      })
      counter++
    }
  })

  return items
}

/** Group flat heading list into a nested tree based on heading levels */
function buildTree(headings: HeadingItem[]): OutlineNode[] {
  const roots: OutlineNode[] = []
  const stack: OutlineNode[] = []

  for (const item of headings) {
    const node: OutlineNode = { item, children: [], collapsed: false }

    while (stack.length > 0 && stack[stack.length - 1].item.level >= item.level) {
      stack.pop()
    }

    if (stack.length === 0) {
      roots.push(node)
    } else {
      stack[stack.length - 1].children.push(node)
    }

    stack.push(node)
  }

  return roots
}

// ─── DOM Rendering ──────────────────────────────────────────────────────────

function createToggleIcon(node: OutlineNode): HTMLElement {
  const icon = document.createElement('span')
  icon.className = 'toggle-icon'
  icon.textContent = node.children.length > 0 ? (node.collapsed ? '▶' : '▼') : ''
  icon.addEventListener('click', (e) => {
    e.stopPropagation()
    node.collapsed = !node.collapsed
    renderTree(currentTree)
  })
  return icon
}

function createOutlineItem(node: OutlineNode): HTMLElement {
  const el = document.createElement('div')
  el.className = `outline-item level-${node.item.level}`
  el.dataset.id = node.item.id

  const indent = (node.item.level - 1) * 12 + 8
  el.style.paddingLeft = `${indent}px`

  if (node.children.length > 0) {
    el.appendChild(createToggleIcon(node))
  }

  const text = document.createElement('span')
  text.className = 'outline-text'
  text.textContent = node.item.text
  el.appendChild(text)

  el.addEventListener('click', () => {
    scrollToHeading(node.item)
  })

  return el
}

function renderTree(nodes: OutlineNode[], container?: HTMLElement) {
  const treeEl = document.getElementById('outline-tree')
  const emptyEl = document.getElementById('outline-empty')
  if (!treeEl) return

  if (nodes.length === 0) {
    treeEl.innerHTML = ''
    emptyEl?.classList.add('visible')
    return
  }

  emptyEl?.classList.remove('visible')

  if (!container) {
    treeEl.innerHTML = ''
    container = treeEl
  }

  for (const node of nodes) {
    const el = createOutlineItem(node)
    container.appendChild(el)
    if (node.children.length > 0 && !node.collapsed) {
      renderTree(node.children, container)
    }
  }
}

// ─── Navigation ─────────────────────────────────────────────────────────────

/**
 * Resolve the rendered DOM element for a heading from its ProseMirror position.
 *
 * Use ProseMirror's position map as the source of truth. Hand-written
 * data-* attributes inside the editor DOM are not stable: ProseMirror owns
 * that DOM and may recreate/normalize nodes after transactions.
 */
function getHeadingElement(view: EditorView, item: HeadingItem): HTMLElement | null {
  const node = view.nodeDOM(item.pos)
  return node instanceof HTMLElement ? node : null
}

/**
 * Scroll the editor container so the target heading sits below the header.
 * Returns true when a heading DOM node was resolved and scrolled to.
 */
function scrollEditorToHeading(view: EditorView, item: HeadingItem, editorEl: HTMLElement): boolean {
  const headingEl = getHeadingElement(view, item)
  if (!headingEl) return false

  const headingRect = headingEl.getBoundingClientRect()
  const editorRect = editorEl.getBoundingClientRect()

  // Distance from heading's top edge to editor's top edge,
  // in the editor's own scroll coordinate space.
  const targetScroll = Math.max(
    0,
    headingRect.top - editorRect.top + editorEl.scrollTop - 40,
  )

  editorEl.scrollTo({ top: targetScroll, behavior: 'instant' })
  return true
}

/**
 * Navigate to a heading using ProseMirror position as the single source of truth:
 *
 * Phase 1 — ProseMirror transaction: set selection at the heading's document
 *   position. This preserves editor state and cursor position.
 *
 * Phase 2 — Precise DOM scroll: resolve the rendered heading via
 *   view.nodeDOM(item.pos), then scroll the actual #editor container manually.
 *   Do not rely on manually injected data-outline-id attributes inside the
 *   editor DOM; ProseMirror/Milkdown can remove them during DOM sync.
 */
function scrollToHeading(item: HeadingItem): void {
  const view = getEditorView()
  if (!view) return

  const editorEl = document.getElementById('editor')
  if (!editorEl) return

  // ── Phase 1: move selection / preserve editor state ──
  const pos = item.pos
  const sel = TextSelection.near(view.state.doc.resolve(pos))
  const tr = view.state.tr.setSelection(sel)
  tr.scrollIntoView()
  view.dispatch(tr)
  view.focus()

  // ── Phase 2: precise DOM fallback (run after render settles) ──
  // ProseMirror's scrollIntoView() is unreliable in MarkFlow's nested scroll
  // container, so always perform the explicit container scroll as the final step.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scrollEditorToHeading(view, item, editorEl)
    })
  })
}

// ─── Scroll Spy ─────────────────────────────────────────────────────────────

function setupScrollSpy(headings: HeadingItem[]): void {
  if (observer) {
    observer.disconnect()
    observer = null
  }

  const view = getEditorView()
  if (!view) return

  const editorEl = document.getElementById('editor')
  if (!editorEl) return

  const headingEntries: Array<{ el: HTMLElement; id: string }> = []
  headings.forEach((item) => {
    const el = getHeadingElement(view, item)
    if (el) headingEntries.push({ el, id: item.id })
  })

  if (headingEntries.length === 0) return

  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)

      if (visible.length > 0) {
        const entry = headingEntries.find(({ el }) => el === visible[0].target)
        const id = entry?.id
        if (id && id !== activeId) {
          activeId = id
          updateActiveHighlight(id)
        }
      }
    },
    {
      root: editorEl,
      rootMargin: '-10% 0px -70% 0px',
      threshold: 0,
    }
  )

  headingEntries.forEach(({ el }) => observer!.observe(el))
}

function updateActiveHighlight(id: string): void {
  document.querySelectorAll('.outline-item').forEach(el => {
    el.classList.toggle('active', (el as HTMLElement).dataset.id === id)
  })
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Initialize outline after editor is ready.
 * Uses double rAF to ensure Milkdown's DOM rendering has settled before
 * we query heading elements — single rAF can race with async rendering.
 */
export function initOutline(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const view = getEditorView()
      if (!view) return
      const headings = extractHeadings()
      currentTree = buildTree(headings)
      renderTree(currentTree)
      setupScrollSpy(headings)
      setupResizeHandle()
    })
  })
}

/** Debounced update — call this on every content change */
export function updateOutline(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    const view = getEditorView()
    if (!view) return
    const headings = extractHeadings()
    currentTree = buildTree(headings)
    renderTree(currentTree)
    setupScrollSpy(headings)
  }, 300)
}

/** Show or hide the sidebar */
export function toggleSidebar(): void {
  const sidebar = document.getElementById('outline-sidebar')
  const layout = document.getElementById('editor-layout')
  if (!sidebar || !layout) return

  const hidden = sidebar.classList.toggle('outline-hidden')
  layout.classList.toggle('outline-full', hidden)
  localStorage.setItem('markflow-outline-visible', hidden ? 'false' : 'true')
}

/** Restore sidebar state and width from localStorage */
export function restoreOutlineState(): void {
  const sidebar = document.getElementById('outline-sidebar')
  const layout = document.getElementById('editor-layout')
  if (!sidebar || !layout) return

  const saved = localStorage.getItem('markflow-outline-visible')
  if (saved === 'false') {
    sidebar.classList.add('outline-hidden')
    layout.classList.add('outline-full')
  }

  // Restore user-set width
  const savedWidth = localStorage.getItem('markflow-outline-width')
  if (savedWidth) {
    sidebar.style.setProperty('--outline-width', savedWidth + 'px')
  }
}

// ─── Resize Handle ─────────────────────────────────────────────────────────

/** Set up the draggable resize handle between editor and sidebar */
function setupResizeHandle(): void {
  const handle = document.getElementById('resize-handle')
  const sidebar = document.getElementById('outline-sidebar')
  if (!handle || !sidebar) return

  let dragging = false
  let startX = 0
  let startWidth = 0

  handle.addEventListener('mousedown', (e: MouseEvent) => {
    if (sidebar.classList.contains('outline-hidden')) return
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
    const newWidth = Math.min(480, Math.max(160, startWidth + dx))
    sidebar.style.setProperty('--outline-width', newWidth + 'px')
  })

  document.addEventListener('mouseup', () => {
    if (!dragging) return
    dragging = false
    handle.classList.remove('dragging')
    document.body.style.cursor = ''
    // Save width to localStorage
    const w = sidebar.offsetWidth
    localStorage.setItem('markflow-outline-width', String(w))
  })
}
