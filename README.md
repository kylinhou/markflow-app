# MarkFlow

**The Agent Native Markdown Editor - Rust Edition**

Real-time collaboration between humans and AI agents — see your agent's changes as they happen.

This is a Rust/Tauri rewrite of the original ColaMD editor, offering significantly smaller bundle size and better performance while maintaining full feature parity.

## Features

### Agent Native
- **Live Agent Sync** — When an AI agent modifies your `.md` file, MarkFlow detects the change and refreshes instantly
- **Agent Activity Indicator** — Visual indicator showing when an agent is writing
- **Cmd+Click Links** — Click any link to open in your browser

### Editor
- **True WYSIWYG** — Type Markdown, see rich text
- **Smart Line Breaks** — Single newlines render as line breaks
- **Rich Text Copy** — Copy with formatting preserved
- **Minimal by Design** — No toolbar, no sidebar, no distractions

### Themes & Export
- **4 Built-in Themes** — Light, Dark, Elegant, Newsprint
- **Custom Themes** — Import your own CSS themes
- **Export** — PDF and HTML
- **Cross-platform** — macOS, Windows, Linux

## Tech Stack

- **Tauri** — Rust-based desktop framework
- **Milkdown** — WYSIWYG Markdown editor
- **TypeScript** — Type-safe frontend
- **Vite** — Fast development and building

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri:dev

# Build for production
npm run tauri:build
```

## Project Structure

```
MarkFlow/
├── src/                    # Frontend TypeScript code
│   ├── editor/            # Milkdown editor
│   ├── themes/            # CSS themes
│   └── main.ts            # Entry point
├── src-tauri/             # Rust backend
│   ├── src/               # Rust source files
│   │   ├── commands.rs    # Tauri commands
│   │   ├── file.rs        # File operations
│   │   ├── watcher.rs     # File watching
│   │   ├── theme.rs       # Theme management
│   │   └── menu.rs        # System menu
│   └── Cargo.toml         # Rust dependencies
└── package.json           # Node dependencies
```

## License

MIT — Free forever.

---

Built with Rust 🦀 for the agent-native future.
