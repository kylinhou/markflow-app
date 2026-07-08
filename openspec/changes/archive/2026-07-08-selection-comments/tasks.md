## 1. UI Layout & Styles Realignment

- [x] 1.1 Move Outline sidebar to the left in index.html and update CSS order/styles in base.css
- [x] 1.2 Add right-side comment sidebar (#comment-sidebar) and double resize handles in index.html and base.css
- [x] 1.3 Implement sidebar mutual exclusivity logic for viewports under 1024px in main.ts
- [x] 1.4 Add floating comment bubble popover menu element and styles

## 2. Editor Selection & Bubble Menu Interaction

- [x] 2.1 Add custom ProseMirror plugin to monitor selection changes and calculate position coordinates
- [x] 2.2 Show/hide floating comment bubble popover menu based on selection limits (no cross-block selections allowed)
- [x] 2.3 Implement bubble menu click handler to focus input field in Comment sidebar and launch comment drafting

## 3. ProseMirror Decorations & Anchoring

- [x] 3.1 Implement inline decorations to highlight active comment ranges with background color and dashed border
- [x] 3.2 Add click listener to decorations to identify commentId and auto-scroll/highlight comment card in sidebar
- [x] 3.3 Add hover/click listener to comment cards in sidebar to auto-highlight/scroll-into-view corresponding editor decorations

## 4. State Management & companion JSON Persistence

- [x] 4.1 Define CommentMeta data structures and extend Tab object state to hold comments in main.ts
- [x] 4.2 Implement loading from and saving to companion JSON files (`*.comments.json`) in switchTab and save_file functions
- [x] 4.3 Implement Paragraph Context Anchoring (storing whole paragraph text + offset in context) in companion JSON serialization

## 5. Levenshtein Fuzzy Matching & Recovery

- [x] 5.1 Implement Levenshtein distance utility function to calculate edit difference percentage between loaded context and editor text
- [x] 5.2 Add fuzzy matching lookup on companion file load to re-anchor comment ranges (tolerating up to 20% edits)
- [x] 5.3 Implement Orphaned Comments state downgrade: preserve comment card in list, display "original text deleted" label, and hide highlight

## 6. AI Agent Integration API

- [x] 6.1 Expose window.getActiveComments() returning list of active comments and contexts
- [x] 6.2 Expose window.applyCommentResolution(commentId, replacementText) replacing target text using tr.mapping and flagging status as resolved
