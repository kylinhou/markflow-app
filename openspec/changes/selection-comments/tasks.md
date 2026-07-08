## 1. UI Layout & Styles Realignment

- [ ] 1.1 Move Outline sidebar to the left in index.html and update CSS order/styles in base.css
- [ ] 1.2 Add right-side comment sidebar (#comment-sidebar) and double resize handles in index.html and base.css
- [ ] 1.3 Implement sidebar mutual exclusivity logic for viewports under 1024px in main.ts
- [ ] 1.4 Add floating comment bubble popover menu element and styles

## 2. Editor Selection & Bubble Menu Interaction

- [ ] 2.1 Add custom ProseMirror plugin to monitor selection changes and calculate position coordinates
- [ ] 2.2 Show/hide floating comment bubble popover menu based on selection limits (no cross-block selections allowed)
- [ ] 2.3 Implement bubble menu click handler to focus input field in Comment sidebar and launch comment drafting

## 3. ProseMirror Decorations & Anchoring

- [ ] 3.1 Implement inline decorations to highlight active comment ranges with background color and dashed border
- [ ] 3.2 Add click listener to decorations to identify commentId and auto-scroll/highlight comment card in sidebar
- [ ] 3.3 Add hover/click listener to comment cards in sidebar to auto-highlight/scroll-into-view corresponding editor decorations

## 4. State Management & companion JSON Persistence

- [ ] 4.1 Define CommentMeta data structures and extend Tab object state to hold comments in main.ts
- [ ] 4.2 Implement loading from and saving to companion JSON files (`*.comments.json`) in switchTab and save_file functions
- [ ] 4.3 Implement Paragraph Context Anchoring (storing whole paragraph text + offset in context) in companion JSON serialization

## 5. Levenshtein Fuzzy Matching & Recovery

- [ ] 5.1 Implement Levenshtein distance utility function to calculate edit difference percentage between loaded context and editor text
- [ ] 5.2 Add fuzzy matching lookup on companion file load to re-anchor comment ranges (tolerating up to 20% edits)
- [ ] 5.3 Implement Orphaned Comments state downgrade: preserve comment card in list, display "original text deleted" label, and hide highlight

## 6. AI Agent Integration API

- [ ] 6.1 Expose window.getActiveComments() returning list of active comments and contexts
- [ ] 6.2 Expose window.applyCommentResolution(commentId, replacementText) replacing target text using tr.mapping and flagging status as resolved
