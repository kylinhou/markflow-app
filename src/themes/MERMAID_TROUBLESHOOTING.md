# Mermaid 样式重构与避坑指南 (Troubleshooting & Lessons)

本篇文档用于总结在 **MarkFlow** 多主题（如 Elegant, Paper 等）开发中，针对 Mermaid 图表样式美化与排版时遇到的严重布局 Bug 及其底层原理，避免后续开发中再次引入类似问题。

---

## 🛑 Bug 1：流程图 (Flowchart) 节点文字下半部被截断/显示不全

### 1. 现象描述
在所有主题下，流程图节点内的中文字体（如“开始”、“监控”、“协作”等）底部会被齐刷刷切断一截，导致文字显示不全。

### 2. 根本原因 (Root Cause)
1. **渲染技术限制**：新版 Mermaid v10+ 在渲染 Flowchart 节点文本时，使用 SVG 的 `<foreignObject>` 容器嵌入 HTML 来实现多行文本排版。
2. **默认浏览器外边距干扰**：Mermaid 生成的 HTML 内部使用了 `<p>` 标签。而在各现代浏览器中，`<p>` 标签默认带有上下各 `1em` (约为 `16px`) 的外边距 (`margin`)。
3. **字体度量基线偏离**：当主题通过 CSS 强制应用自定义字体（如中文字体 'LXGW WenKai'）时，由于不同字体的 metrics（度量高度和基线）大于默认的无衬线体，外加 `<p>` 标签默认的 `margin-top` 产生的向下挤压，文字块在垂直方向上发生了偏移，被整体推向了 `<foreignObject>` 的下边界。
4. **硬裁剪限制**：`<foreignObject>` 的 `height` 属性是 Mermaid 引擎提前计算并在 DOM 属性上写死的。内容一旦超出该高度边界，就会被 SVG 默认的 `overflow: hidden` 强制截断，导致文字下半部分彻底看不见。

### 3. 解决方案 (Solution)
必须全局消除 Mermaid 流程图节点内部 HTML 标签的默认边距干扰，并规范行高，在 [base.css](file:///c:/AIHome/markflow/markflow-app/src/themes/base.css) 中加入如下规则：
```css
.milkdown-mermaid-preview svg .nodeLabel p,
.milkdown-mermaid-preview svg .node .label p {
  margin: 0 !important;
  padding: 0 !important;
  line-height: 1.35 !important;
}
```

---

## 🛑 Bug 2：连线关系文字（“是”、“否”）偏移或在部分浏览器下消失

### 1. 现象描述
连线上的关系文本标签（如“是”、“否”）位置偏离了连线的中点，重叠在下方的节点框上，或者在部分浏览器下彻底看不见。

### 2. 根本原因 (Root Cause)
1. **定位冲突**：Mermaid 依靠在 `<foreignObject>` 本身上设置内联的 `transform: translate(x, y)` 属性来把文字定位到连线的正中点。
2. **权重覆盖破坏布局**：之前为了让文字背景遮挡连线，CSS 里写了 `width: 38px !important; height: 22px !important; transform: translate(-50%, -50%) !important;`。这里的 `!important` 彻底重写并冲掉了 Mermaid 自身的坐标定位，导致所有的标签都被强行移到了 SVG 画布的左上角 `(0, 0)`（或发生了奇怪的偏移），从而完全消失或者严重错位。

### 3. 解决方案 (Solution)
1. **释放 foreignObject 定位控制权**：绝对不能去覆盖 `<foreignObject>` 自身的 `transform`、`width` 和 `height`，让 Mermaid 的几何引擎自行放置它。仅设置 `overflow: visible !important;` 保证其允许内部 padding 溢出显示。
2. **内部绝对居中对齐**：在 `<foreignObject>` 内部的 `div` 遮罩上应用绝对定位，让它的中心点和外层 `foreignObject` 的中心点始终完美重合：
```css
body.theme-elegant .milkdown-mermaid-preview svg .edgeLabels div,
body.theme-elegant .milkdown-mermaid-preview svg .edgeLabel div {
  position: absolute !important;
  left: 50% !important;
  top: 50% !important;
  transform: translate(-50%, -50%) !important;
  white-space: nowrap !important;
  display: flex !important;
  justify-content: center !important;
  align-items: center;
  /* 后面配置背景遮罩颜色和内边距 */
}
```

---

## 🛑 Bug 3：甘特图 (Gantt) 样式选择器失效，任务条回退到默认颜色

### 1. 现象描述
甘特图中的活跃任务（active）、完成任务（done）和关键任务（crit）均未能呈现主题指定的配色，回退成了默认的灰蓝色，文字在暗色主题下看不清。

### 2. 根本原因 (Root Cause)
新版 Mermaid 甘特图在生成 DOM 时，任务的类名后缀了当前的索引编号，例如：
`class="task active0 "`、`class="task crit0 "`、`class="task done0 "`。
原有的 `.task.active` 等选择器完全无法匹配包含数字的动态类，导致样式链条断裂。

### 3. 解决方案 (Solution)
使用属性选择器包含匹配（`*=`)，来模糊匹配任何数字后缀的类名：
```css
body.theme-elegant .milkdown-mermaid-preview svg rect.task[class*="active"] { ... }
body.theme-elegant .milkdown-mermaid-preview svg rect.task[class*="crit"] { ... }
body.theme-elegant .milkdown-mermaid-preview svg rect.task[class*="done"] { ... }
```
这样不管后缀数字是多少，均能完美适配，展现丰富的主题科技或古风配色。

---

## 🛑 Bug 4：暗色主题下文本在部分环境（如 Webview 生产包）下回退为暗黑色

### 1. 现象描述
在开发服务器（Chrome 浏览器）测试中展示正常的文字（如甘特图任务文本、时序图参与者框文字），在真实的客户端环境（如 Webview2 / Tauri 生产环境包）下，突然回退成了暗黑色，在深色背景中完全看不清。

### 2. 根本原因 (Root Cause)
由于 SVG 的继承层级与 HTML 节点存在本质区别，SVG 的 `<text>` 和 `<tspan>` 节点如果缺乏强力的、全局性主题类覆盖（如 `body.theme-paper svg text`），它们在不同的 Webview 宿主环境中会隐式地继承外层宿主节点（如编辑器主体或文档框架）的默认 `fill`（可能被某种全局样式隐式污染为深色），或者由于特定的 CSS 选择器特异性不够高，导致前景色在生产包中发生回退。

### 3. 解决方案 (Solution)
必须在暗色/亮色主题的顶级入口处，使用 `!important` 对 SVG 内部**所有可能的文本标签**进行绝对防御性的全局 fill 重写覆盖，以防任何继承泄露。

在 [base.css](file:///c:/AIHome/markflow/markflow-app/src/themes/base.css) 中加入的防线：
```css
/* ── 统一 SVG 内部所有文本的字体与颜色（防止出现继承浅灰色/黑色看不清的问题） ── */
body.theme-paper .milkdown-mermaid-preview svg text,
body.theme-paper .milkdown-mermaid-preview svg tspan,
body.theme-paper .milkdown-mermaid-preview svg span,
body.theme-paper .milkdown-mermaid-preview svg p,
body.theme-paper .milkdown-mermaid-preview svg div {
  font-family: 'Inter', 'PingFang SC', 'Segoe UI', system-ui, sans-serif !important;
  fill: #e2e8f0 !important;
  color: #e2e8f0 !important;
}
```
通过这类最高权重的显式覆盖，彻底规避任何环境依赖下的“暗色主题隐形字”Bug。

（更新于：2026-06-13 13:31）
