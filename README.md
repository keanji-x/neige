# neige

A web-based terminal session manager for [Claude Code](https://github.com/anthropics/claude-code) and other CLI tools.

Manage multiple Claude Code conversations side-by-side in your browser with drag-and-drop split panes, persistent sessions, and SSH tunnel support.

## Features

- **Multi-session** — Run multiple Claude Code instances simultaneously
- **Split panes** — Drag tabs to split horizontally/vertically (powered by [dockview](https://github.com/mathuo/dockview))
- **Real terminal** — Full PTY passthrough via WebSocket, rendered with [xterm.js](https://xtermjs.org/)
- **Session persistence** — Sessions survive browser refresh; resume detached sessions automatically
- **Worktree support** — Each Claude Code session can run in its own git worktree
- **Directory picker** — Browse and select working directories with autocomplete and git repo detection
- **Proxy support** — Configure HTTP/HTTPS proxy per session, persisted to disk
- **Port forwarding** — Configure port mappings in the web UI, automatically synced to SSH tunnel
- **Remote access** — `neige-connect` CLI tunnels to a remote host; auto-provisions neige if not installed
- **Layout persistence** — Split layout saved to `.neige/layout.json`, config saved to `~/.config/neige/config.json`
- **Works with any CLI** — Not limited to Claude Code; run `aider`, `gemini`, or any program

## Architecture

```
Browser (React + xterm.js + dockview)
    ↕ WebSocket (raw PTY bytes)
Rust server (axum + portable-pty)
    ↕ PTY
claude / aider / any CLI program
```

The server manages session lifecycle — creating, detaching, resuming, and persisting sessions to `.neige/sessions/`. A separate `neige-connect` CLI provides SSH ControlMaster-based tunneling for remote access, with automatic provisioning.

## Prerequisites

- [Rust](https://rustup.rs/) (1.85+)
- [Node.js](https://nodejs.org/) (20+)

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

## Remote Access

Use `neige-connect` to connect to a remote host. If neige isn't running there, it will automatically clone, build, and start it.

```bash
# Connect to remote host (auto-provisions if needed)
neige-connect myserver

# Custom local port
neige-connect myserver -l 8080

# Specify remote working directory
neige-connect myserver -d ~/projects

# Skip auto-provisioning
neige-connect myserver --no-provision
```

Port mappings are configured in the web UI and automatically synced to the SSH tunnel.

## Project Structure

```
neige/
├── crates/
│   ├── neige-server/             # Main backend
│   │   └── src/
│   │       ├── main.rs           # axum server, binds :3030
│   │       ├── api/mod.rs        # REST + WebSocket routes
│   │       ├── conversation/     # Session manager + persistence
│   │       └── pty/              # PTY wrapper (portable-pty)
│   └── neige-connect/            # Remote access CLI with auto-provisioning
│       └── src/main.rs
└── web/                          # React + Vite frontend
    └── src/
        ├── App.tsx
        ├── components/
        │   ├── Sidebar.tsx           # Collapsible session list
        │   ├── PortForwardPanel.tsx   # Port forwarding config
        │   ├── TerminalPanel.tsx      # Dockview-based split terminal
        │   ├── CreateDialog.tsx       # New session dialog
        │   └── ConfirmDialog.tsx      # Confirmation modal
        └── hooks/
            ├── useTerminal.ts         # xterm.js + WebSocket hook
            ├── useConversations.ts    # Session CRUD + polling
            └── useConfig.ts           # Config persistence
```

## License

MIT
