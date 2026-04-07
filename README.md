# neige

A web-based terminal session manager for [Claude Code](https://github.com/anthropics/claude-code) and other CLI tools.

Manage multiple Claude Code conversations side-by-side in your browser with drag-and-drop split panes.

## Features

- **Multi-session** — Run multiple Claude Code instances simultaneously
- **Split panes** — Drag tabs to split horizontally/vertically (powered by [dockview](https://github.com/mathuo/dockview))
- **Real terminal** — Full PTY passthrough via WebSocket, rendered with [xterm.js](https://xtermjs.org/)
- **Directory picker** — Browse and select working directories when creating sessions
- **Proxy support** — Configure HTTP/HTTPS proxy per session, persisted to disk
- **Layout persistence** — Split layout saved to localStorage, config saved to `~/.config/neige/config.json`
- **Works with any CLI** — Not limited to Claude Code; run `aider`, `gemini`, or any program

## Architecture

```
Browser (React + xterm.js + dockview)
    ↕ WebSocket (raw PTY bytes)
Rust server (axum + portable-pty)
    ↕ PTY
claude / aider / any CLI program
```

## Prerequisites

- [Rust](https://rustup.rs/) (1.85+)
- [Node.js](https://nodejs.org/) (20+)
- [tmux](https://github.com/tmux/tmux/wiki/Installing) (optional, not currently used)

## Quick Start

```bash
# Build frontend
cd web && npm install && npm run build && cd ..

# Build and run
cargo run
```

Open `http://localhost:3030`

## Development

```bash
# Terminal 1: Rust backend
cargo run

# Terminal 2: Frontend dev server (with hot reload + API proxy)
cd web && npm run dev
```

Dev server runs on `http://localhost:5173` with API proxied to `:3030`.

## Project Structure

```
neige/
├── src/
│   ├── main.rs              # axum server
│   ├── api/mod.rs            # REST + WebSocket routes
│   ├── conversation/mod.rs   # Session manager
│   └── tmux/mod.rs           # PTY wrapper (portable-pty)
└── web/
    └── src/
        ├── App.tsx               # Main layout
        ├── components/
        │   ├── Sidebar.tsx       # Collapsible session list
        │   ├── TerminalPanel.tsx  # Dockview-based split terminal
        │   └── CreateDialog.tsx   # New session dialog
        └── hooks/
            ├── useTerminal.ts     # xterm.js + WebSocket hook
            ├── useConversations.ts
            └── useConfig.ts
```

## License

MIT
