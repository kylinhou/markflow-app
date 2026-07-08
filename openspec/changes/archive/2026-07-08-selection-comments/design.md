## Context
Currently, MarkFlow is a Tauri-based Markdown editor built on Milkdown (which wraps ProseMirror). The outline sidebar occupies the right panel (and has toggleable support to go to the left). There is no commenting or annotation capability, which is a major bottleneck for interactive collaboration and AI Agent editing integrations.

## Goals / Non-Goals

**Goals:**
- Shift the Outline sidebar permanently to the left.
- Add a dedicated Comment sidebar to the right panel.
- Implement selection-based commenting with a floating bubble popover menu.
- Use ProseMirror inline decorations for document-level anchoring without polluting saved Markdown.
- Save and restore comment metadata using a companion `.comments.json` file.
- Provide APIs for AI Agent retrieval and automated text resolution with transaction offset mapping (`tr.mapping`).
- Implement paragraph context anchoring and Levenshtein fuzzy matching to prevent position drift.
- Restrict comments to single block nodes to avoid ProseMirror nesting errors.
- Enforce sidebar mutual exclusivity on narrow viewports to preserve editor area.

**Non-Goals:**
- Nested thread replies (only single comment card per anchor is supported).
- Rich text or markdown formatting within the comment content itself.
- Real-time collaborative comment syncing (comments are local and file-companion based).

## Decisions

### 1. Inline Decorations vs. Custom ProseMirror Marks
- **Choice**: Inline Decorations (`Decoration.inline`)
- **Rationale**: Custom ProseMirror Marks would require extending the Markdown parser/serializer, resulting in custom HTML (e.g. `<span data-comment-id="...">`) being saved directly into the Markdown file. Using inline decorations keeps the document pure Markdown while rendering the yellow highlight and `data-comment-id` dynamically in the DOM.
- **Alternative Considered**: Custom Mark. Rejected because it pollutes saved files.

### 2. Companion JSON Files (`.comments.json`) vs. Database
- **Choice**: Companion JSON files stored next to the Markdown file (e.g., `doc.md.comments.json`).
- **Rationale**: Seamlessly integrates with the file-based nature of MarkFlow. When users copy, backup, or share files, they can also share the `.comments.json` file. It avoids maintaining a local database state.
- **Alternative Considered**: SQLite or LocalStorage. Rejected because comments would be lost if files are moved, renamed, or opened on another device.

### 3. Paragraph Context Anchoring & Levenshtein Fuzzy Matching
- **Choice**: Store the entire paragraph text (`context`) and `offsetInContext` inside the companion JSON. When loading, if the absolute offset is invalid, search for the paragraph text and use Levenshtein distance (up to 20% edit tolerance) to re-align. If unmatchable, mark as "orphaned".
- **Rationale**: Prevents position drift when files are modified externally.
- **Alternative Considered**: Strict offset matching only. Rejected because it easily breaks on minor external edits.

### 4. Single-block Selection Limit
- **Choice**: Only allow selections that are fully contained within a single textblock node.
- **Rationale**: Simplifies decoration rendering and prevents node nesting issues in ProseMirror.
- **Alternative Considered**: Multi-block selection. Rejected due to extreme layout complexity and rendering edge cases.

## Risks / Trade-offs

- **[Position Drift due to massive external edits]** → **Mitigation**: If the paragraph is completely rewritten or deleted, the comment is not lost but is recovered as an "orphaned comment" shown in the right sidebar without an editor highlight, alerting the user that the target text was deleted.
- **[Agent edit conflicts with user typing]** → **Mitigation**: Use ProseMirror's `tr.mapping` to translate offsets dynamically across concurrent edits, ensuring that edits target the correct text even if other transactions occur simultaneously.
- **[UI Clutter on small screens]** → **Mitigation**: Implement CSS media queries and JS layout checks. If viewport width < 1024px, opening the outline sidebar automatically hides the comment sidebar, and vice versa.
