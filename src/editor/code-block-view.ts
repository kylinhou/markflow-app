import { $view } from '@milkdown/kit/utils'
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark'
import type { NodeViewConstructor } from '@milkdown/kit/prose/view'
import { TextSelection } from '@milkdown/kit/prose/state'
import mermaid from 'mermaid'

// 初始化 mermaid
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark', // 默认深色，渲染时可根据当前系统主题调整
  securityLevel: 'loose'
})

// 防抖函数，避免打字时过于频繁地渲染图表
function debounce(fn: (...args: any[]) => void, delay: number) {
  let timer: any = null
  return (...args: any[]) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      fn(...args)
    }, delay)
  }
}

/**
 * 修正 Mermaid SVG 中 foreignObject 的尺寸问题。
 * 
 * 在 Tauri WebView2 (Windows Edge WebView) 中，foreignObject 内的 HTML 元素
 * 字体计量与标准 Chrome 存在差异，Mermaid 计算的 foreignObject 高度可能偏小，
 * 导致中文等 CJK 文字底部被裁切。
 * 
 * 此函数在 SVG 插入 DOM 后执行，检测并修正所有尺寸不足的 foreignObject。
 */
function fixForeignObjectSizes(container: HTMLElement) {
  const svg = container.querySelector('svg')
  if (!svg) return

  let maxHeightGrowth = 0

  svg.querySelectorAll('foreignObject').forEach((fo) => {
    const inner = fo.querySelector('div, span') as HTMLElement | null
    if (!inner) return

    const foHeight = parseFloat(fo.getAttribute('height') || '0')
    const actualHeight = inner.scrollHeight

    if (actualHeight > foHeight + 1) { // +1 容忍亚像素差异
      const growth = actualHeight - foHeight
      fo.setAttribute('height', String(actualHeight))
      if (growth > maxHeightGrowth) {
        maxHeightGrowth = growth
      }
    }
  })

  // 如果有任何 foreignObject 被扩大了，同步扩大 SVG 的 viewBox 高度
  if (maxHeightGrowth > 0) {
    const viewBox = svg.getAttribute('viewBox')
    if (viewBox) {
      const parts = viewBox.split(/[\s,]+/)
      if (parts.length === 4) {
        const vbHeight = parseFloat(parts[3])
        parts[3] = String(vbHeight + maxHeightGrowth * 2) // 乘 2 留足余量
        svg.setAttribute('viewBox', parts.join(' '))
      }
    }
  }
}

// ── Mermaid 多主题配置注册表 (Theme Registry) ──
// 每个主题可在此注册其专属的 Mermaid 配色方案。
// 未注册的主题会根据页面亮度自动 Fallback 到内置的 default/dark 主题。
// 新增主题时只需在此字典中添加一项，无需修改渲染函数。

interface MermaidThemeConfig {
  theme: 'default' | 'dark' | 'forest' | 'base'
  themeVariables: (bodyFont: string) => Record<string, any>
}

const MermaidThemeRegistry: Record<string, MermaidThemeConfig> = {
  'theme-elegant': {
    theme: 'base',
    themeVariables: (font) => ({
      fontFamily: font,
      background: '#eae6e1',
      primaryColor: '#eae6e1',
      primaryTextColor: '#2c2c2c',
      primaryBorderColor: '#c44b2b',
      lineColor: '#777777',
      secondaryColor: '#eae6e1',
      tertiaryColor: '#f0edea',
      edgeLabelBackground: '#eae6e1',
      // 时序图
      actorBkg: '#eae6e1',
      actorBorder: '#c44b2b',
      actorTextColor: '#2c2c2c',
      actorLineColor: '#777777',
      signalColor: '#2c2c2c',
      signalTextColor: '#2c2c2c',
      labelBoxBkgColor: '#eae6e1',
      labelBoxBorderColor: '#d8d3ce',
      labelTextColor: '#2c2c2c',
      loopLimitBorderColor: '#c44b2b',
      loopLimitBkgColor: '#eae6e1',
      noteBkgColor: '#eae6e1',
      noteBorderColor: '#c44b2b',
      noteTextColor: '#2c2c2c',
      // 甘特图
      gridColor: '#d8d3ce',
      taskColor: '#eae6e1',
      taskBorderColor: '#c44b2b',
      taskTextColor: '#2c2c2c',
      sectionColor: '#f0edea',
      sectionColor2: '#eae6e1'
    })
  }
  // 其他主题如需深度定制，可在此追加，完全隔离
}

/**
 * 根据当前激活的主题获取 Mermaid 渲染配置。
 * 优先查找 MermaidThemeRegistry 中的精确匹配，
 * 否则根据页面背景亮度自动选择内置的 default 或 dark 主题。
 */
function getMermaidConfig(isDark: boolean, bodyFont: string): { theme: string; themeVariables: Record<string, any> } {
  const activeClass = Array.from(document.body.classList).find(cls => cls.startsWith('theme-'))

  if (activeClass && MermaidThemeRegistry[activeClass]) {
    const config = MermaidThemeRegistry[activeClass]
    return {
      theme: config.theme,
      themeVariables: config.themeVariables(bodyFont)
    }
  }

  return {
    theme: isDark ? 'dark' : 'default',
    themeVariables: { fontFamily: bodyFont }
  }
}

export const codeBlockView = $view(codeBlockSchema.node, (): NodeViewConstructor => {
  return (node, view, getPos) => {
    // 创建容器
    const dom = document.createElement('div')
    dom.classList.add('milkdown-code-block-container')
    // 移除容器级别的 contenteditable="false"，确保 ProseMirror 的 contentDOM 能获得焦点和编辑
    // 我们仅在按钮和预览区设置 contenteditable="false"

    // 代码编辑器 pre > code
    const pre = document.createElement('pre')
    pre.setAttribute('contenteditable', 'true')
    const code = document.createElement('code')
    code.setAttribute('contenteditable', 'true')
    pre.appendChild(code)
    dom.appendChild(pre)

    // 创建右上角切换按钮
    const toggleBtn = document.createElement('button')
    toggleBtn.classList.add('code-toggle-btn')
    toggleBtn.setAttribute('contenteditable', 'false')
    dom.appendChild(toggleBtn)

    // 创建 Mermaid 预览区域
    const previewDOM = document.createElement('div')
    previewDOM.classList.add('milkdown-mermaid-preview')
    previewDOM.setAttribute('contenteditable', 'false')
    dom.appendChild(previewDOM)

    let currentNode = node
    let renderMermaidDebounced: (...args: any[]) => void
    let isCollapsed = true // 默认收起代码部分

    const updateVisibility = (n: typeof node) => {
      const language = n.attrs.language || n.attrs.info || ''
      if (language === 'mermaid') {
        dom.classList.add('is-mermaid')
        previewDOM.style.display = 'block'
        toggleBtn.style.display = 'inline-flex'
        
        if (isCollapsed) {
          pre.style.display = 'none'
          toggleBtn.textContent = '编辑源码'
          toggleBtn.classList.remove('active')
        } else {
          pre.style.display = 'block'
          toggleBtn.textContent = '收起源码'
          toggleBtn.classList.add('active')
        }
      } else {
        dom.classList.remove('is-mermaid')
        previewDOM.style.display = 'none'
        toggleBtn.style.display = 'none'
        pre.style.display = 'block'
      }
    }

    // 按钮点击事件
    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      isCollapsed = !isCollapsed
      updateVisibility(currentNode)
      
      // 如果展开，使用 ProseMirror 选区机制把焦点和光标定位进代码块中
      if (!isCollapsed && typeof getPos === 'function') {
        setTimeout(() => {
          const pos = getPos()
          if (typeof pos === 'number') {
            const { state, dispatch } = view
            // pos 是代码块节点的起始位置，pos + 1 是代码块内部内容的起始位置
            try {
              const tr = state.tr.setSelection(TextSelection.create(state.doc, pos + 1))
              dispatch(tr)
              view.focus()
            } catch (err) {
              console.error('Failed to focus on code block:', err)
            }
          }
        }, 50)
      }
    })

    const renderMermaid = () => {
      const language = currentNode.attrs.language || currentNode.attrs.info || ''
      if (language !== 'mermaid') return

      const codeText = currentNode.textContent.trim()
      if (!codeText) {
        previewDOM.innerHTML = '<div class="mermaid-empty">点击“编辑源码”输入 Mermaid 语法以生成图表</div>'
        return
      }

      // 根据页面实际背景亮度判断深色/浅色模式（纯亮度计算，不依赖具体主题类名）
      const detectDarkMode = (): boolean => {
        const bgColor = getComputedStyle(document.body).backgroundColor
        const match = bgColor.match(/\d+/g)
        if (match && match.length >= 3) {
          const [r, g, b] = match.map(Number)
          const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
          return luminance < 0.5
        }
        return false
      }
      const isDark = detectDarkMode()
      
      // 动态获取当前编辑器的实际字体，使图表内的文本与正文完美融为一体
      const bodyFont = getComputedStyle(document.querySelector('.ProseMirror') || document.body).fontFamily || 'sans-serif'
      
      // 通过 Theme Registry 获取当前主题对应的 Mermaid 配置（完全隔离，互不影响）
      const { theme, themeVariables } = getMermaidConfig(isDark, bodyFont)

      // 每次渲染前重新配置 Mermaid 单例（有意为之：用户可能在两次渲染之间切换主题）
      mermaid.initialize({
        startOnLoad: false,
        theme: theme as any,
        themeVariables,
        securityLevel: 'loose',
        flowchart: {
          htmlLabels: true,
          useMaxWidth: true
        },
        gantt: {
          barHeight: 28,
          barGap: 6,
          topPadding: 60,
          fontSize: 13,
          useMaxWidth: false
        }
      })

      // 生成唯一的 id 避免冲突
      const id = `mermaid-${Math.random().toString(36).substring(2, 9)}`

      try {
        mermaid.render(id, codeText)
          .then(({ svg }) => {
            previewDOM.innerHTML = svg
            // WebView2 (Tauri/Windows) 对 foreignObject 内的字体计量与标准 Chrome
            // 不完全一致，可能导致 Mermaid 计算的 foreignObject 高度偏小，中文文字
            // 底部被裁切。渲染完毕后用 JS 后处理，修正所有尺寸不足的 foreignObject。
            requestAnimationFrame(() => fixForeignObjectSizes(previewDOM))
          })
          .catch((err) => {
            // 清理可能产生的残余 DOM 元素
            const badElement = document.getElementById(id)
            if (badElement) badElement.remove()

            const errMsg = err instanceof Error ? err.message : String(err)
            previewDOM.innerHTML = `<div class="mermaid-error">语法错误: ${errMsg}</div>`
          })
      } catch (e: any) {
        previewDOM.innerHTML = `<div class="mermaid-error">语法错误: ${e.message || '无效的 Mermaid 语法'}</div>`
      }
    }

    renderMermaidDebounced = debounce(renderMermaid, 300)

    // 初始化显示
    updateVisibility(currentNode)
    // 延迟 100ms 首次渲染，确保节点已成功挂载到 DOM 树中，从而能够加载正确的字体，计算准确的节点字宽，防止文本挤压变形
    setTimeout(renderMermaid, 100)

    return {
      dom,
      contentDOM: code,
      update: (newNode) => {
        if (newNode.type !== currentNode.type) return false
        currentNode = newNode
        updateVisibility(currentNode)
        renderMermaidDebounced()
        return true
      },
      ignoreMutation: (mutation) => {
        // 忽略所有属性的突变（例如 style、class、contenteditable等改变），防止 ProseMirror 重建整个 NodeView
        if (mutation.type === 'attributes') {
          return true
        }
        // 忽略在 previewDOM 和 toggleBtn 内部的一切 DOM 变化
        if (previewDOM.contains(mutation.target) || toggleBtn.contains(mutation.target)) {
          return true
        }
        return false
      },
      stopEvent: (event) => {
        const isButtonOrPreview = toggleBtn.contains(event.target as Node) || previewDOM.contains(event.target as Node);
        if (isButtonOrPreview) {
          return true
        }
        return false
      }
    }
  }
})

