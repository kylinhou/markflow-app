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
let scrollSpyObserver: IntersectionObserver | null = null
let activeId: string | null = null

// When user clicks a heading, we disable auto-scroll-spy for this period
// to prevent the observer from overriding the user's explicit choice.
let spySuppressed = false
let spySuppressTimer: ReturnType<typeof setTimeout> | null = null

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
 * Find the rendered DOM element for a heading using multiple strategies:
 * 1. Primary: view.nodeDOM(pos) — fast but may be stale after DOM mutations
 * 2. Fallback: scan headingEls for the one whose ProseMirror pos matches
 *
 * Returns null if the element cannot be resolved.
 */
function getHeadingElement(view: EditorView, item: HeadingItem, headingEls: HTMLElement[]): HTMLElement | null {
  // Strategy 1: fast path
  const fast = view.nodeDOM(item.pos)
  if (fast instanceof HTMLElement) return fast

  // Strategy 2: scan all resolved heading elements by position
  // Use the editor's DOM coordinate system to verify
  for (const el of headingEls) {
    const from = view.posAtDOM(el, 0)
    const to = view.posAtDOM(el, el.childNodes.length)
    if (from <= item.pos && item.pos < to) {
      return el
    }
  }

  return null
}

/**
 * Scroll the editor container so the target heading sits below the header.
 * Returns true when a heading DOM node was resolved and scrolled to.
 */
function scrollEditorToHeading(view: EditorView, item: HeadingItem, editorEl: HTMLElement, headingEls: HTMLElement[]): boolean {
  const headingEl = getHeadingElement(view, item, headingEls)
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
 * Navigate to a heading with immediate active highlight.
 *
 * Suppresses the scroll-spy for 300ms so IntersectionObserver can't
 * override the user's explicit navigation choice during the settle phase.
 */
function scrollToHeading(item: HeadingItem): void {
  const view = getEditorView()
  if (!view) return

  const editorEl = document.getElementById('editor')
  if (!editorEl) return

  // ── Immediate: set active right now ──
  activeId = item.id
  updateActiveHighlight(item.id)

  // ── Suppress auto-scroll-spy during and after scroll ──
  if (spySuppressTimer) clearTimeout(spySuppressTimer)
  spySuppressed = true
  spySuppressTimer = setTimeout(() => {
    spySuppressed = false
  }, 300)

  // ── Phase 1: move selection / preserve editor state ──
  const pos = item.pos
  const sel = TextSelection.near(view.state.doc.resolve(pos))
  const tr = view.state.tr.setSelection(sel)
  tr.scrollIntoView()
  view.dispatch(tr)
  view.focus()

  // ── Phase 2: precise DOM scroll (double rAF to wait for settle) ──
  const headings = extractHeadings()
  const headingEls = headings
    .map(h => getHeadingElement(view, h, []))
    .filter((el): el is HTMLElement => el !== null)

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scrollEditorToHeading(view, item, editorEl, headingEls)
    })
  })
}

// ─── Scroll Spy ─────────────────────────────────────────────────────────────

/**
 * Pick the best active heading using "distance from top of viewport" algorithm.
 *
 * We track ALL visible entries (not just isIntersecting), compute the distance
 * of each heading's top edge from the top of the viewport, and pick the smallest
 * POSITIVE distance — i.e., the topmost heading that is currently visible in
 * the editor area.
 *
 * This correctly handles:
 * - Multiple headings on screen: picks the one closest to the top edge
 * - Bottom of document: when scrollTop + clientHeight approaches maxScroll,
 *   we fall back to the last heading
 */
function pickActiveHeading(
  entries: IntersectionObserverEntry[],
  headingEls: Map<Element, string>,
  editorEl: HTMLElement,
  allHeadingEls: HTMLElement[],
): string | null {
  if (entries.length === 0) return null

  const scrollTop = editorEl.scrollTop
  const clientHeight = editorEl.clientHeight
  const maxScroll = editorEl.scrollHeight - clientHeight

  // Special case: scrolled to the very bottom — always pick last heading
  if (scrollTop >= maxScroll - 10) {
    const last = allHeadingEls[allHeadingEls.length - 1]
    return last ? (headingEls.get(last) ?? null) : null
  }

  // Find the heading with minimum positive distance from viewport top.
  // A heading's "top in viewport" = boundingClientRect.top - editorTop + scrollTop
  // But since root = editorEl, we can use boundingClientRect.top directly
  // relative to editorEl's top edge.
  let best: string | null = null
  let bestScore = Infinity

  for (const entry of entries) {
    if (!headingEls.has(entry.target)) continue
    const id = headingEls.get(entry.target)!

    // entry.boundingClientRect.top is relative to editorEl (our root)
    // Positive = below the top edge of editor, Negative = above it
    const distFromTop = entry.boundingClientRect.top

    // Only consider headings that are below the editor top (distFromTop >= 0)
    // or very slightly above (within 5px, to handle edge cases)
    if (distFromTop < -5) continue

    if (distFromTop < bestScore) {
      bestScore = distFromTop
      best = id
    }
  }

  return best
}

function setupScrollSpy(headings: HeadingItem[]): void {
  if (scrollSpyObserver) {
    scrollSpyObserver.disconnect()
    scrollSpyObserver = null
  }

  const view = getEditorView()
  if (!view) return

  const editorEl = document.getElementById('editor')
  if (!editorEl) return

  // Build element→id map using coord-based fallback for stability
  const headingEls = headings
    .map(h => ({ el: getHeadingElement(view, h, []), id: h.id }))
    .filter(({ el }) => el !== null) as Array<{ el: HTMLElement; id: string }>

  if (headingEls.length === 0) return

  const elToId = new Map<Element, string>(headingEls.map(({ el, id }) => [el, id]))
  const allEls = headingEls.map(h => h.el)

  // Use a generous rootMargin: observe headings in the middle portion of the viewport
  scrollSpyObserver = new IntersectionObserver(
    (entries) => {
      if (spySuppressed) return

      const winner = pickActiveHeading(entries, elToId, editorEl, allEls)
      if (winner && winner !== activeId) {
        activeId = winner
        updateActiveHighlight(winner)
      }
    },
    {
      root: editorEl,
      // Observe headings in the top 85% of the viewport (not too close to edges)
      rootMargin: '-5% 0px -15% 0px',
      threshold: 0,
    }
  )

  headingEls.forEach(({ el }) => scrollSpyObserver!.observe(el))

  // Also watch editor scroll for bottom-of-document detection
  editorEl.addEventListener('scroll', handleEditorScroll, { passive: true })
}

let lastScrollTop = 0
function handleEditorScroll(this: HTMLElement): void {
  const scrollTop = this.scrollTop
  const maxScroll = this.scrollHeight - this.clientHeight

  // Bottom of document: pick the last heading
  if (scrollTop >= maxScroll - 10 && scrollTop !== lastScrollTop) {
    if (spySuppressed) return
    const treeEl = document.getElementById('outline-tree')
    if (!treeEl) return
    const items = treeEl.querySelectorAll('.outline-item')
    if (items.length === 0) return
    const last = items[items.length - 1] as HTMLElement
    const id = last.dataset.id
    if (id && id !== activeId) {
      activeId = id
      updateActiveHighlight(id)
    }
  }

  lastScrollTop = scrollTop
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
  }, 150)
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

  // Restore sidebar direction (right by default)
  const savedDir = localStorage.getItem('markflow-sidebar-direction') as 'right' | 'left' | null
  const dir = savedDir || 'right'
  layout.classList.remove('sidebar-right', 'sidebar-left')
  layout.classList.add(`sidebar-${dir}`)
  sidebar.classList.remove('sidebar-right', 'sidebar-left')
  sidebar.classList.add(`sidebar-${dir}`)
}

/** Set sidebar position: 'right' or 'left'. Persists to localStorage. */
export function setSidebarDirection(dir: 'right' | 'left'): void {
  const sidebar = document.getElementById('outline-sidebar')
  const layout = document.getElementById('editor-layout')
  if (!sidebar || !layout) return

  layout.classList.remove('sidebar-right', 'sidebar-left')
  layout.classList.add(`sidebar-${dir}`)
  sidebar.classList.remove('sidebar-right', 'sidebar-left')
  sidebar.classList.add(`sidebar-${dir}`)
  localStorage.setItem('markflow-sidebar-direction', dir)
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
