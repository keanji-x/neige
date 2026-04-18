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
- **Token auth** — First-run login URL with fragment-delivered token; session cookie (`HttpOnly; SameSite=Strict`) afterwards
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

On first launch the server prints a one-time login URL to stdout:

```
Open this URL in your browser to sign in:
  http://127.0.0.1:3030/login#token=<…>
```

Open that URL once — the token is delivered via URL fragment (never sent to the server over the wire or written to access logs). After login, an `HttpOnly; SameSite=Strict` session cookie (30-day) is used for subsequent requests.

The hash of the token is persisted at `~/.config/neige/auth.json` (mode `0600`). The plaintext token is shown only once; if you lose it, generate a new one:

```bash
cargo run -- auth rotate   # prints a new token, invalidates all sessions
```

### Binding

Default bind is `127.0.0.1` — LAN peers cannot reach the port directly. To expose over LAN (relying on the token for access control):

```bash
cargo run -- --listen 0.0.0.0
```

For multi-user remote hosts, prefer `neige-connect` over `--listen 0.0.0.0`. Note that TCP loopback is *not* a per-user boundary on shared Linux hosts — other local users can reach `127.0.0.1:3030` too, and only the token stops them.

### CLI flags

| Flag | Default | Purpose |
| --- | --- | --- |
| `--port <N>` | `3030` | Listen port |
| `--listen <ADDR>` | `127.0.0.1` | Listen address (use `0.0.0.0` for LAN) |
| `--allowed-origin <URL>` | — | Additional allowed Origin (repeatable); loopback is always allowed |
| `--no-auth` | off | Disable auth entirely (DEV ONLY, forces `--listen 127.0.0.1`) |
| `--auth-file <PATH>` | `~/.config/neige/auth.json` | Override auth file location |

## Development

```bash
# Terminal 1: Rust backend
cargo run

# Terminal 2: Frontend dev server (with hot reload + API proxy)
cd web && npm run dev
```

Dev server runs on `http://localhost:5173` with API proxied to `:3030`. For faster iteration during frontend work, pass `--no-auth` to the backend.

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

> **Auth note:** the SSH tunnel forwards `localhost:<local>` on your machine to `localhost:<remote>` on the target. Since the server requires a token, you need to open the remote-printed login URL once. `neige-connect` does not yet automate token retrieval — SSH into the host and either run `neige-server auth rotate` or check `~/.config/neige/auth.json` was already set up by a prior direct login.

## Project Structure

```
neige/
├── crates/
│   ├── neige-server/             # Main backend
│   │   └── src/
│   │       ├── main.rs           # axum server, CLI, auth wiring
│   │       ├── api/mod.rs        # REST + WebSocket routes + SSRF blocklist
│   │       ├── auth/             # Token, session cookie, Origin check, login page
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
