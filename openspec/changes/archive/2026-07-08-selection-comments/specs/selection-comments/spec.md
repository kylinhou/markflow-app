## ADDED Requirements

### Requirement: Selection Detection and Floating Bubble Menu
The system SHALL monitor text selection in the editor and display a floating comment bubble menu only when a non-empty text selection within a single block node is detected.

#### Scenario: User selects text within a paragraph
- **WHEN** user selects a text fragment within a single paragraph
- **THEN** a floating comment bubble menu displays directly above the selection

#### Scenario: User selects text across multiple block nodes
- **WHEN** user selects text spanning across multiple block nodes
- **THEN** the floating comment bubble menu SHALL NOT display

### Requirement: Layout Realignment and Right-Side Comment Panel
The system SHALL move the Outline sidebar to the left and add a comment sidebar on the right side of the editor.

#### Scenario: Initial layout rendering
- **WHEN** the application is loaded
- **THEN** the Outline sidebar is aligned on the left, and the Comment sidebar is rendered on the right

#### Scenario: Sidebar visibility toggle on low-resolution screen
- **WHEN** the screen width is less than 1024px and the user opens one sidebar
- **THEN** the other sidebar SHALL automatically close to maximize editor area

### Requirement: Position Mapping with Paragraph Context Anchoring
The system SHALL store comment metadata containing the quote text, position offsets, and the full text of the paragraph context, and mapping SHALL automatically adjust as the document is edited.

#### Scenario: Document is edited before comment anchor
- **WHEN** characters are typed before a comment anchor in the editor
- **THEN** the inline highlight and metadata positions of the comment SHALL dynamically shift to remain aligned with the same text fragment

### Requirement: Fuzzy Matching and Orphaned Comments Recovery
The system SHALL attempt Levenshtein-based fuzzy matching of paragraph context when loading companion comment files, and downgrade unmatchable comments to an orphaned state.

#### Scenario: Paragraph contains minor edits
- **WHEN** a companion comment is loaded and its paragraph context contains less than 20% edits
- **THEN** the system SHALL dynamically re-anchor the comment at the closest matching position and apply the highlight

#### Scenario: Highlighted text is completely deleted
- **WHEN** the quote text of a comment is completely deleted from the document
- **THEN** the comment SHALL degrade to an "orphaned" state, keeping the card in the sidebar but removing the editor highlight

### Requirement: Bilateral Interaction
The system SHALL highlight and scroll between comment cards and editor anchors when clicked or hovered.

#### Scenario: Clicking comment anchor in editor
- **WHEN** user clicks on a highlighted comment anchor in the editor
- **THEN** the right-side comment list scrolls to the corresponding card and highlights it

#### Scenario: Hovering comment card in sidebar
- **WHEN** user hovers over a comment card in the sidebar
- **THEN** the corresponding comment anchor in the editor is strongly highlighted

### Requirement: AI Agent Modification and Auto-Resolution API
The system SHALL expose global APIs for AI Agents to retrieve active comments and automatically apply edits with proper transaction offset mapping.

#### Scenario: AI Agent applies text replacement for resolved comment
- **WHEN** an AI Agent calls `window.applyCommentResolution(commentId, replacementText)`
- **THEN** the editor replaces the text at the comment anchor, resolves the comment, and removes the decoration using `tr.mapping` to maintain concurrent transaction consistency
