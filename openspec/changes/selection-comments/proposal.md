## Why

Users want to select text in the editor and add comments to it, with the comments displayed in a right-hand sidebar. This enables a rich interactive review workflow and provides a structured interface for an AI Agent to read, resolve, and modify the document dynamically.

## What Changes

- Add a selection comment floating popover bubble menu in the editor.
- Re-align the editor layout: move the Outline sidebar to the left, and add a new Comment sidebar on the right.
- Add inline annotations (virtual marks using ProseMirror inline decorations) to highlight commented text fragments.
- Implement companion JSON serialization for comment persistence (e.g. `[filename].comments.json`).
- Implement bilateral interactions between the editor anchors and the right comment cards.
- Add Paragraph Context Anchoring (storing whole paragraph text and relative offset in the context) to prevent position drift when files are modified externally.
- Implement Levenshtein-based fuzzy matching and Orphaned Comments fallback to handle text edits gracefully.
- Restrict selection comments to single block nodes to prevent ProseMirror errors.
- Limit concurrent/competing sidebars (mutual exclusivity on low-res screens).
- Integrate dynamic mapping (`tr.mapping`) for AI Agent concurrent modifications to avoid offset drift.

## Capabilities

### New Capabilities
- `selection-comments`: Provides selection-based text commenting, bilateral highlighted card navigation, companion JSON persistence with robust fuzzy/orphaned state recovery, and clean API endpoints for AI Agent integration.

### Modified Capabilities

## Impact
- Frontend layout (`index.html`, `src/themes/base.css`, `src/main.ts`) will be updated to accommodate the left-side outline sidebar and the right-side comment panel.
- Editor module (`src/editor/editor.ts`) will be updated to include selection event handling, inline decoration mapping, and float bubble popover rendering.
- New companion files (`*.comments.json`) will be generated alongside user Markdown files for persistence.
