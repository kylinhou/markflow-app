# MarkFlow Selection Comments & AI Agent Integration Design Scheme

This document details the architecture, UI changes, and data structures for selection-based comments and their integration with autonomous AI Agents.

---

## 1. Interface Layout Realignment

### Outline Sidebar Left-Alignment
- Shift `#outline-sidebar` to the left side of the editor.
- Update DOM order in index.html to place the outline sidebar before the editor.
- Update CSS in base.css to swap sidebars:
  - Outline sidebar (`#outline-sidebar`) is left-aligned, with `border-right` instead of `border-left`.
  - The resize handle (`#resize-handle-left`) is placed between the outline sidebar and the editor.

### New Right-Side Comment Panel
- Introduce `#comment-sidebar` on the right side of the editor.
- Introduce `#resize-handle-right` between the editor and the comment sidebar.
- Layout:
  ```
  [Outline Sidebar] | [Left Resize] | [Editor] | [Right Resize] | [Comment Sidebar]
  ```
- The comment panel will display:
  - A header with a close/toggle button.
  - A scrollable list of active and resolved comment cards.
  - An empty state: "暂无评论，选中文本即可发起评论" (No comments, select text to add comment) when there are no comments.

---

## 2. Selection Detection & Bubble Popover

### Selection Listener
- Register a custom ProseMirror `Plugin` within the Milkdown editor in editor.ts to track selection changes:
  - When the selection is non-empty (user selected text) and does not span invalid blocks, compute coordinates.
  - Display the floating comment bubble menu above the selection.

### Floating Bubble Menu
- Render a absolute-positioned floating bubble button (`#comment-bubble-menu`) above the selection rect.
- Calculate bounding box of the selected text using:
  ```typescript
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) {
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    // Position bubble menu at (rect.left + rect.width / 2, rect.top - menuHeight)
  }
  ```
- Clicking the "Add Comment" button in the bubble menu will pop up a mini input box or focus the input box in the right comment panel to create a new comment.

---

## 3. Data Structures & Inline Anchoring

### Comment Metadata
```typescript
interface CommentMeta {
  commentId: string    // UUID
  quote: string        // Selected text fragment
  content: string      // Comment text/instruction
  author: 'user' | 'agent'
  status: 'active' | 'resolved'
  timestamp: number
  from: number         // ProseMirror starting position
  to: number           // ProseMirror ending position
}
```

### Inline Anchor Decorations
- Instead of polluting the saved Markdown file with custom HTML tags, we will use ProseMirror **inline decorations**.
- A decoration will wrap the commented text range `[from, to]` in a `span` with attributes:
  - `class="comment-anchor"`
  - `data-comment-id="[UUID]"`
- Style in base.css:
  ```css
  .comment-anchor {
    background-color: rgba(255, 235, 59, 0.3); /* Pale yellow highlight */
    border-bottom: 2px dashed #fbc02d;
    cursor: pointer;
    transition: background-color 0.2s;
  }
  .comment-anchor:hover, .comment-anchor.highlighted {
    background-color: rgba(255, 235, 59, 0.5); /* Stronger highlight on hover */
  }
  ```
- Position mapping (updating positions as the user edits the document) is automatically handled by ProseMirror's `DecorationSet`.

---

## 4. Companion JSON Serialization (Data Persistence)

- **Untitled Tabs**: Keep comments in memory under `tab.comments`.
- **Saved Files**: When a file `/path/to/file.md` is saved:
  - We serialize the comments list into a companion JSON file `/path/to/file.md.comments.json`.
  - When the file is loaded, we read `/path/to/file.md.comments.json` if it exists, parse the comments, and recreate the ProseMirror decorations.
  - If a file is saved under a new path (Save As), we copy or rename the companion JSON file.

---

## 5. Bilateral Interaction (双向联动)

- **Editor ➔ Comment Sidebar**:
  - Clicking on a `.comment-anchor` span in the editor will retrieve the `data-comment-id`.
  - Scroll the comment list to the card with `data-comment-id` and highlight it.
- **Comment Sidebar ➔ Editor**:
  - Hovering on a comment card in the list highlights the corresponding `.comment-anchor` span in the editor.
  - Clicking on a comment card scrolls the editor to the corresponding anchor position.

---

## 6. AI Agent Integration & Auto-Resolution

- **Comments Export for Agent**:
  - Expose a global API `window.getActiveComments()` which returns all active (`status: 'active'`) comments with their `commentId`, `quote`, `content`, and positions.
  - The AI Agent can retrieve this list to find out what needs to be changed.
- **Agent Modification API**:
  - Provide a function `window.applyCommentResolution(commentId, replacementText)`:
    - Locates the decoration for `commentId`.
    - Replaces the text between `from` and `to` with `replacementText` via a ProseMirror transaction.
    - Sets the comment status to `'resolved'`.
    - Removes the decoration and updates the UI.
- **Companion File Update**:
  - The resolved comments are saved as `'resolved'` (or deleted) in the `.comments.json` file.
