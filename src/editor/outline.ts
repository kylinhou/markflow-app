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

/** Walk doc and extract all heading nodes with their positions */
function extractHeadings(): HeadingItem[] {
  const view = getEditorView()
  if (!view) return []

  const items: HeadingItem[] = []
  let index = 0

  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const level = node.attrs.level as number
      const text = node.textContent.trim()
      if (text) {
        items.push({
          id: generateId(index),
          text: text.length > 60 ? text.slice(0, 60) + '…' : text,
          level,
          pos,
        })
        index++
      }
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

    // Pop stack until we find a node with lower level (or stack empties)
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

  // Click → scroll editor to this heading
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

function scrollToHeading(item: HeadingItem): void {
  const view = getEditorView()
  if (!view) return

  try {
    // Find the heading DOM element with matching data-outline-id and scroll to it
    const el = view.dom.querySelector(`[data-outline-id="${item.id}"]`) as HTMLElement | null
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  } catch (e) {
    console.warn('[outline] Failed to scroll to heading:', e)
  }
}

// ─── Scroll Spy ─────────────────────────────────────────────────────────────

/** Assign data-id attributes to heading DOM elements so IntersectionObserver works */
function syncHeadingIds(headings: HeadingItem[]): void {
  const view = getEditorView()
  if (!view) return

  const dom = view.dom
  const headingElements = dom.querySelectorAll('h1, h2, h3, h4, h5, h6')

  // Build a map: pos → id
  const posToId = new Map<number, string>()
  headings.forEach(h => posToId.set(h.pos, h.id))

  let headingIndex = 0
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading' && node.textContent.trim()) {
      const el = headingElements[headingIndex]
      if (el && posToId.has(pos)) {
        el.setAttribute('data-outline-id', posToId.get(pos)!)
      }
      headingIndex++
    }
  })
}

function setupScrollSpy(headings: HeadingItem[]): void {
  if (observer) {
    observer.disconnect()
    observer = null
  }

  const view = getEditorView()
  if (!view) return

  syncHeadingIds(headings)

  const headingEls: Element[] = []
  view.dom.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(el => {
    if (el.hasAttribute('data-outline-id')) {
      headingEls.push(el)
    }
  })

  if (headingEls.length === 0) return

  observer = new IntersectionObserver(
    (entries) => {
      // Find the topmost intersecting heading
      const visible = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)

      if (visible.length > 0) {
        const id = (visible[0].target as HTMLElement).dataset.outlineId
        if (id && id !== activeId) {
          activeId = id
          updateActiveHighlight(id)
        }
      }
    },
    {
      root: null,
      rootMargin: '-10% 0px -70% 0px',
      threshold: 0,
    }
  )

  headingEls.forEach(el => observer!.observe(el))
}

function updateActiveHighlight(id: string): void {
  document.querySelectorAll('.outline-item').forEach(el => {
    el.classList.toggle('active', (el as HTMLElement).dataset.id === id)
  })
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Initialize outline after editor is ready */
export function initOutline(): void {
  updateOutline()
}

/** Debounced update — call this on every content change */
export function updateOutline(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
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

  // Save preference
  localStorage.setItem('markflow-outline-visible', hidden ? 'false' : 'true')
}

/** Restore sidebar state from localStorage */
export function restoreOutlineState(): void {
  const sidebar = document.getElementById('outline-sidebar')
  const layout = document.getElementById('editor-layout')
  if (!sidebar || !layout) return

  const saved = localStorage.getItem('markflow-outline-visible')
  if (saved === 'false') {
    sidebar.classList.add('outline-hidden')
    layout.classList.add('outline-full')
  }
}
