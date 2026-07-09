import { Editor, rootCtx, defaultValueCtx, editorViewCtx, serializerCtx, remarkPluginsCtx, parserCtx } from '@milkdown/kit/core'
import { DOMSerializer, Slice } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { emit } from '@tauri-apps/api/event'
import remarkBreaks from 'remark-breaks'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { replaceAll, $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { htmlView } from './html-view'
import { codeBlockView } from './code-block-view'

import '@milkdown/kit/prose/view/style/prosemirror.css'
import { prism } from '@milkdown/plugin-prism'
import { math } from '@milkdown/plugin-math'
import 'katex/dist/katex.min.css'

let editorInstance: Editor | null = null
let editorViewInstance: EditorView | null = null

export function getEditorView(): EditorView | null {
  return editorViewInstance
}

const inlineStyles: Record<string, string> = {
  'h1': 'font-size:1.8em;font-weight:700;margin:1em 0 .5em;padding-bottom:.3em;border-bottom:1px solid #eee;',
  'h2': 'font-size:1.4em;font-weight:600;margin:1em 0 .5em;padding-bottom:.25em;border-bottom:1px solid #eee;',
  'h3': 'font-size:1.2em;font-weight:600;margin:.8em 0 .4em;',
  'h4': 'font-weight:600;margin:.8em 0 .4em;',
  'h5': 'font-weight:600;margin:.8em 0 .4em;',
  'h6': 'font-weight:600;margin:.8em 0 .4em;',
  'p': 'margin:.5em 0;line-height:1.75;',
  'strong': 'font-weight:600;',
  'a': 'color:#0969da;text-decoration:none;',
  'code': 'background:rgba(175,184,193,0.2);padding:2px 6px;border-radius:3px;font-size:.875em;font-family:Menlo,Monaco,monospace;',
  'pre': 'background:#f6f8fa;padding:16px;border-radius:6px;overflow-x:auto;margin:1em 0;',
  'blockquote': 'border-left:4px solid #ddd;padding-left:16px;margin:1em 0;color:#666;',
  'ul': 'padding-left:24px;margin:.5em 0;',
  'ol': 'padding-left:24px;margin:.5em 0;',
  'li': 'margin:.25em 0;',
  'table': 'border-collapse:collapse;width:100%;margin:1em 0;',
  'th': 'border:1px solid #ddd;padding:8px 12px;text-align:left;font-weight:600;background:#f6f8fa;',
  'td': 'border:1px solid #ddd;padding:8px 12px;text-align:left;',
  'hr': 'border:none;border-top:2px solid #ddd;margin:2em 0;',
  'img': 'max-width:100%;',
}

function enhanceClipboard(e: ClipboardEvent): void {
  const html = e.clipboardData?.getData('text/html')
  if (!html) return

  const doc = new DOMParser().parseFromString(html, 'text/html')

  for (const [tag, style] of Object.entries(inlineStyles)) {
    doc.querySelectorAll(tag).forEach((el) => {
      ;(el as HTMLElement).setAttribute('style', style)
    })
  }

  // pre > code: override code style inside code blocks
  doc.querySelectorAll('pre code').forEach((el) => {
    ;(el as HTMLElement).setAttribute('style', 'background:none;padding:0;font-size:.875em;line-height:1.6;font-family:Menlo,Monaco,monospace;')
  })

  e.clipboardData?.setData('text/html', doc.body.innerHTML)
}

const defaultContent = `# Welcome to MarkFlow

Start typing here...
`

export async function createEditor(
  rootId: string,
  onChange?: (markdown: string) => void
): Promise<Editor> {
  const root = document.getElementById(rootId)
  if (!root) throw new Error(`Element #${rootId} not found`)

  editorInstance = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, defaultContent)
      ctx.set(remarkPluginsCtx, [{ plugin: remarkBreaks, options: {} }])
      if (onChange) {
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          onChange(markdown)
          emit('markdown-updated', { markdown }).catch(() => {})
        })
      }
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(listener)
    .use(clipboard)
    .use(commentPlugin)
    .use(htmlView)
    .use(codeBlockView)
    .use(prism)
    .use(math)
    .create()

  // Get editorViewInstance AFTER create() completes — editorViewCtx is only
  // available once the editor is fully initialized (not during .config())
  editorInstance.action((ctx) => {
    editorViewInstance = ctx.get(editorViewCtx)
  })

  // Enhance clipboard with inline styles for rich text paste (e.g. WeChat)
  root.addEventListener('copy', enhanceClipboard)
  root.addEventListener('cut', enhanceClipboard)

  // Cmd+click (Mac) / Ctrl+click (Win/Linux) to open links in browser
  root.addEventListener('click', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return
    const link = (e.target as HTMLElement).closest('a')
    if (!link) return
    const href = link.getAttribute('href')
    if (href) {
      e.preventDefault()
      // Use Tauri shell to open external link
      import('@tauri-apps/plugin-shell').then(({ open }) => {
        open(href)
      })
    }
  })

  return editorInstance
}

export function getMarkdown(): string {
  if (!editorInstance) return ''
  let markdown = ''
  editorInstance.action((ctx) => {
    const serializer = ctx.get(serializerCtx)
    const view = ctx.get(editorViewCtx)
    markdown = serializer(view.state.doc)
  })
  return markdown
}

export function getHTML(): string {
  if (!editorInstance) return ''
  let html = ''
  editorInstance.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const div = document.createElement('div')
    const fragment = DOMSerializer.fromSchema(view.state.schema).serializeFragment(view.state.doc.content)
    div.appendChild(fragment)
    html = div.innerHTML
  })
  return html
}

export function setMarkdown(content: string): void {
  if (!editorInstance) return
  editorInstance.action(replaceAll(content))
  // Emit event so outline updates (replaceAll is programmatic, not typed by user,
  // so the listener.markdownUpdated callback in createEditor() never fires here)
  emit('markdown-updated', { markdown: content }).catch(() => {})
}

// ─── Comment Plugin & Helpers ───

export const commentPluginKey = new PluginKey('comment-plugin')

export const commentPlugin = $prose(() => {
  return new Plugin({
    key: commentPluginKey,
    state: {
      init() {
        return {
          decorations: DecorationSet.empty
        }
      },
      apply(tr, value, _oldState, _newState) {
        let decorations = value.decorations.map(tr.mapping, tr.doc)
        
        const action = tr.getMeta(commentPluginKey)
        if (action) {
          if (action.type === 'SET_DECORATIONS') {
            decorations = DecorationSet.create(tr.doc, action.decorations)
          } else if (action.type === 'ADD_COMMENT') {
            const dec = Decoration.inline(action.from, action.to, {
              class: 'comment-anchor',
              'data-comment-id': action.commentId
            })
            decorations = decorations.add(tr.doc, [dec])
          } else if (action.type === 'REMOVE_COMMENT') {
            const decs = decorations.find(undefined, undefined, (spec) => spec['data-comment-id'] === action.commentId)
            decorations = decorations.remove(decs)
          } else if (action.type === 'HIGHLIGHT_COMMENT') {
            const list = decorations.find()
            const newList = list.map(d => {
              const spec = d.spec
              const isTarget = spec['data-comment-id'] === action.commentId
              return Decoration.inline(d.from, d.to, {
                class: 'comment-anchor' + (isTarget && action.highlight ? ' highlighted' : ''),
                'data-comment-id': spec['data-comment-id']
              })
            })
            decorations = DecorationSet.create(tr.doc, newList)
          }
        }
        return { decorations }
      }
    },
    props: {
      decorations(state) {
        return commentPluginKey.getState(state)?.decorations || DecorationSet.empty
      },
      handleDOMEvents: {
        click(_view, event) {
          const target = event.target as HTMLElement
          const anchor = target.closest('.comment-anchor')
          if (anchor) {
            const commentId = anchor.getAttribute('data-comment-id')
            if (commentId) {
              const clickEvent = new CustomEvent('comment-anchor-clicked', { detail: { commentId } })
              window.dispatchEvent(clickEvent)
              return true
            }
          }
          return false
        }
      }
    },
    view(_editorView) {
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

  if (selection.from === selection.to) {
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

export function addCommentDecoration(commentId: string, from: number, to: number) {
  if (!editorViewInstance) return
  const tr = editorViewInstance.state.tr
  tr.setMeta(commentPluginKey, {
    type: 'ADD_COMMENT',
    commentId,
    from,
    to
  })
  editorViewInstance.dispatch(tr)
}

export function removeCommentDecoration(commentId: string) {
  if (!editorViewInstance) return
  const tr = editorViewInstance.state.tr
  tr.setMeta(commentPluginKey, {
    type: 'REMOVE_COMMENT',
    commentId
  })
  editorViewInstance.dispatch(tr)
}

export function highlightCommentDecoration(commentId: string, highlight: boolean) {
  if (!editorViewInstance) return
  const tr = editorViewInstance.state.tr
  tr.setMeta(commentPluginKey, {
    type: 'HIGHLIGHT_COMMENT',
    commentId,
    highlight
  })
  editorViewInstance.dispatch(tr)
}

export function getCommentRanges(): { commentId: string, from: number, to: number, quote: string }[] {
  if (!editorViewInstance) return []
  const state = editorViewInstance.state
  const pluginState = commentPluginKey.getState(state)
  if (!pluginState) return []
  const decorations = pluginState.decorations as DecorationSet
  const list = decorations.find()
  return list.map(d => {
    return {
      commentId: d.spec['data-comment-id'],
      from: d.from,
      to: d.to,
      quote: state.doc.textBetween(d.from, d.to)
    }
  })
}

export function setCommentDecorations(comments: { commentId: string, from: number, to: number, orphaned?: boolean }[]) {
  if (!editorViewInstance) return
  const tr = editorViewInstance.state.tr
  const decorations = comments
    .filter(c => !c.orphaned)
    .map(c => {
      return Decoration.inline(c.from, c.to, {
        class: 'comment-anchor',
        'data-comment-id': c.commentId
      })
    })
  tr.setMeta(commentPluginKey, {
    type: 'SET_DECORATIONS',
    decorations
  })
  editorViewInstance.dispatch(tr)
}

export function scrollEditorToRange(from: number, to: number) {
  if (!editorViewInstance) return
  const view = editorViewInstance
  const sel = TextSelection.create(view.state.doc, from, to)
  const tr = view.state.tr.setSelection(sel)
  tr.scrollIntoView()
  view.dispatch(tr)
  view.focus()
}

export function replaceRangeWithMarkdown(from: number, to: number, markdown: string, tr: any): void {
  if (!editorInstance) return
  editorInstance.action((ctx) => {
    const parser = ctx.get(parserCtx)
    const parsedDoc = parser(markdown)
    if (parsedDoc) {
      const slice = Slice.maxOpen(parsedDoc.content)
      tr.replace(from, to, slice)
    }
  })
}
