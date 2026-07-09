import { $mark, $node, $view, $prose } from '@milkdown/kit/utils'
import type { NodeViewConstructor } from '@milkdown/kit/prose/view'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'

// ─── Remark AST Parser Plugin ──────────────────────────────────────────────

export const criticMarkupRemarkPlugin = function(this: any) {
  let extensions = this.data('toMarkdownExtensions') as any[] | undefined
  if (!extensions) {
    extensions = []
    this.data('toMarkdownExtensions', extensions)
  }
  extensions.push({
    handlers: {
      'critic-addition'(node: any, _: any, state: any) {
        const content = state.containerPhrasing
          ? state.containerPhrasing(node, { before: '{++', after: '++}' })
          : (state.all ? state.all(node).join('') : '')
        return `{++${content}++}`
      },
      'critic-deletion'(node: any, _: any, state: any) {
        const content = state.containerPhrasing
          ? state.containerPhrasing(node, { before: '{--', after: '--}' })
          : (state.all ? state.all(node).join('') : '')
        return `{--${content}--}`
      },
      'critic-substitution'(node: any, _: any, state: any) {
        const content = state.containerPhrasing
          ? state.containerPhrasing(node, { before: '~>', after: '~~' })
          : (state.all ? state.all(node).join('') : '')
        return `{~~${node.original}~>${content}~~}`
      },
      'critic-highlight'(node: any, _: any, state: any) {
        const content = state.containerPhrasing
          ? state.containerPhrasing(node, { before: '{==', after: '==}' })
          : (state.all ? state.all(node).join('') : '')
        return `{==${content}==}`
      },
      'critic-comment'(node: any) {
        return `{>>${node.value}<<}`
      }
    }
  })
  
  return (tree: any) => {
    walk(tree)
  }
}

function walk(node: any) {
  if (node.children) {
    const newChildren: any[] = []
    for (const child of node.children) {
      if (child.type === 'text') {
        const parts = parseCriticMarkupText(child.value)
        newChildren.push(...parts)
      } else {
        walk(child)
        newChildren.push(child)
      }
    }
    node.children = newChildren
  }
}

function parseCriticMarkupText(text: string): any[] {
  // Regex to match CriticMarkup tags
  const regex = /(\{\+\+[\s\S]*?\+\+\}|\{\-\-[\s\S]*?\-\-\}|\{\~\~[\s\S]*?\~\>[\s\S]*?\~\~\}|\{\>\>[\s\S]*?\<\<\}|\{\=\=[\s\S]*?\=\=\})/g
  const parts = text.split(regex)
  const result: any[] = []

  for (const part of parts) {
    if (!part) continue

    if (part.startsWith('{++') && part.endsWith('++}')) {
      result.push({
        type: 'critic-addition',
        children: [{ type: 'text', value: part.slice(3, -3) }]
      })
    } else if (part.startsWith('{--') && part.endsWith('--}')) {
      result.push({
        type: 'critic-deletion',
        children: [{ type: 'text', value: part.slice(3, -3) }]
      })
    } else if (part.startsWith('{~~') && part.endsWith('~~}')) {
      const inner = part.slice(3, -3)
      const arrowIdx = inner.indexOf('~>')
      if (arrowIdx !== -1) {
        const original = inner.slice(0, arrowIdx)
        const replacement = inner.slice(arrowIdx + 2)
        result.push({
          type: 'critic-substitution',
          original,
          children: [{ type: 'text', value: replacement }]
        })
      } else {
        result.push({ type: 'text', value: part })
      }
    } else if (part.startsWith('{>>') && part.endsWith('<<}')) {
      result.push({
        type: 'critic-comment',
        value: part.slice(3, -3)
      })
    } else if (part.startsWith('{==') && part.endsWith('==}')) {
      result.push({
        type: 'critic-highlight',
        children: [{ type: 'text', value: part.slice(3, -3) }]
      })
    } else {
      result.push({ type: 'text', value: part })
    }
  }

  return result
}

// ─── ProseMirror Schemas (Marks & Nodes) ───────────────────────────────────

export const criticAdditionMark = $mark('critic_addition', () => ({
  parseDOM: [{ tag: 'ins.critic-addition' }],
  toDOM: () => ['ins', { class: 'critic-addition' }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'critic-addition',
    runner: (state, node, markType) => {
      state.openMark(markType)
      state.next(node.children)
      state.closeMark(markType)
    }
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'critic_addition',
    runner: (state, mark) => {
      state.withMark(mark, 'critic-addition')
    }
  }
}))

export const criticDeletionMark = $mark('critic_deletion', () => ({
  parseDOM: [{ tag: 'del.critic-deletion' }],
  toDOM: () => ['del', { class: 'critic-deletion' }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'critic-deletion',
    runner: (state, node, markType) => {
      state.openMark(markType)
      state.next(node.children)
      state.closeMark(markType)
    }
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'critic_deletion',
    runner: (state, mark) => {
      state.withMark(mark, 'critic-deletion')
    }
  }
}))

export const criticSubstitutionMark = $mark('critic_substitution', () => ({
  attrs: {
    original: { default: '' }
  },
  parseDOM: [{
    tag: 'span.critic-substitution',
    getAttrs: (dom) => ({
      original: (dom as HTMLElement).getAttribute('data-original') || ''
    })
  }],
  toDOM: (mark) => ['span', { class: 'critic-substitution', 'data-original': mark.attrs.original }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'critic-substitution',
    runner: (state, node, markType) => {
      state.openMark(markType, { original: node.original || '' })
      state.next(node.children)
      state.closeMark(markType)
    }
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'critic_substitution',
    runner: (state, mark) => {
      state.withMark(mark, 'critic-substitution', undefined, { original: mark.attrs.original })
    }
  }
}))

export const criticHighlightMark = $mark('critic_highlight', () => ({
  parseDOM: [{ tag: 'mark.critic-highlight' }],
  toDOM: () => ['mark', { class: 'critic-highlight' }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'critic-highlight',
    runner: (state, node, markType) => {
      state.openMark(markType)
      state.next(node.children)
      state.closeMark(markType)
    }
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'critic_highlight',
    runner: (state, mark) => {
      state.withMark(mark, 'critic-highlight')
    }
  }
}))

export const criticCommentNode = $node('critic_comment', () => ({
  inline: true,
  group: 'inline',
  atom: true,
  attrs: {
    value: { default: '' }
  },
  parseDOM: [{
    tag: 'span.critic-comment-node',
    getAttrs: (dom) => ({
      value: (dom as HTMLElement).getAttribute('data-comment') || ''
    })
  }],
  toDOM: (node) => ['span', { class: 'critic-comment-node', 'data-comment': node.attrs.value }],
  parseMarkdown: {
    match: (node) => node.type === 'critic-comment',
    runner: (state, node, nodeType) => {
      state.addNode(nodeType, { value: node.value || '' })
    }
  },
  toMarkdown: {
    match: (node) => node.type.name === 'critic_comment',
    runner: (state, node) => {
      state.openNode('critic-comment', node.attrs.value)
      state.closeNode()
    }
  }
}))

// ─── Interactive Node View for Comments ─────────────────────────────────────

export const criticCommentView = $view(criticCommentNode, (): NodeViewConstructor => {
  return (node, _view, getPos) => {
    const dom = document.createElement('span')
    dom.classList.add('critic-comment-bubble')
    dom.setAttribute('title', node.attrs.value)
    dom.innerHTML = '💬'
    
    dom.addEventListener('click', (e) => {
      e.stopPropagation()
      const pos = typeof getPos === 'function' ? getPos() : 0
      const clickEvent = new CustomEvent('critic-comment-clicked', {
        detail: { comment: node.attrs.value, from: pos }
      })
      window.dispatchEvent(clickEvent)
    })

    return {
      dom,
      stopEvent: () => true
    }
  }
})

// ─── Selection Change Plugin ───────────────────────────────────────────────

export const criticSelectionPlugin = $prose(() => {
  return new Plugin({
    key: new PluginKey('critic-selection-plugin'),
    view() {
      return {
        update(view, prevState) {
          const { state } = view
          if (!prevState || !prevState.selection.eq(state.selection)) {
            handleSelectionChange(view)
          }
        }
      }
    }
  })
})

function handleSelectionChange(view: EditorView) {
  const { state } = view
  const { selection } = state
  const bubbleMenu = document.getElementById('comment-bubble-menu')
  if (!bubbleMenu) return

  if (selection.empty) {
    bubbleMenu.style.display = 'none'
    return
  }

  const { $from, $to } = selection
  if ($from.sameParent($to) === false) {
    bubbleMenu.style.display = 'none'
    return
  }

  const domSel = window.getSelection()
  if (!domSel || domSel.isCollapsed || domSel.rangeCount === 0) {
    bubbleMenu.style.display = 'none'
    return
  }

  const range = domSel.getRangeAt(0)
  const rect = range.getBoundingClientRect()

  bubbleMenu.style.display = 'flex'
  const menuWidth = bubbleMenu.offsetWidth
  const menuHeight = bubbleMenu.offsetHeight

  let left = rect.left + rect.width / 2 - menuWidth / 2
  let top = rect.top - menuHeight - 8

  left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8))
  top = Math.max(8, top)

  bubbleMenu.style.left = `${left}px`
  bubbleMenu.style.top = `${top}px`

  bubbleMenu.dataset.from = String(selection.from)
  bubbleMenu.dataset.to = String(selection.to)
  bubbleMenu.dataset.quote = state.doc.textBetween(selection.from, selection.to)
}

// ─── Export Combined Plugins ────────────────────────────────────────────────

export const criticMarkupPlugins = [
  criticAdditionMark,
  criticDeletionMark,
  criticSubstitutionMark,
  criticHighlightMark,
  criticCommentNode,
  criticCommentView,
  criticSelectionPlugin
]
