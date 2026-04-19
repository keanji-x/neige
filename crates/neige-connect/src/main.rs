use clap::Parser;
use serde::Deserialize;
use std::collections::HashSet;
use std::process::{Command, Stdio};

const REPO_URL: &str = "https://github.com/keanji-x/neige.git";

#[derive(Parser)]
#[command(name = "neige-connect", about = "Connect to a remote neige server via SSH tunnel")]
struct Cli {
    /// SSH host (e.g. user@hostname or SSH config alias)
    host: String,

    /// Remote neige port
    #[arg(short, long, default_value = "3030")]
    port: u16,

    /// Local port to bind (defaults to same as remote port)
    #[arg(short, long)]
    local_port: Option<u16>,

    /// Project working directory on the remote host (where neige-server runs)
    #[arg(short = 'd', long, default_value = "~")]
    remote_dir: String,

    /// Installation directory for neige on the remote host
    #[arg(long, default_value = "~/.neige/install")]
    install_dir: String,

    /// Poll interval in seconds for dynamic port forwarding
    #[arg(long, default_value = "5")]
    poll_interval: u64,

    /// Don't open browser automatically
    #[arg(long)]
    no_browser: bool,

    /// Skip auto-provisioning if neige is not running
    #[arg(long)]
    no_provision: bool,

    /// SSH control socket path (auto-generated if not set)
    #[arg(long)]
    control_path: Option<String>,
}

#[derive(Deserialize, Debug)]
struct PortForward {
    #[serde(alias = "remotePort")]
    remote_port: u16,
    #[serde(alias = "localPort")]
    local_port: u16,
}

#[derive(Deserialize, Debug, Default)]
#[serde(default)]
struct NeigeConfig {
    #[serde(alias = "portForwards")]
    port_forwards: Vec<PortForward>,
}

fn default_control_path(host: &str) -> String {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    format!("{home}/.ssh/neige-ctrl-{host}")
}

/// Ensure neige is up-to-date and running on the remote host.
/// Always pulls latest code; rebuilds and restarts if there are changes.
fn ensure_remote(host: &str, port: u16, remote_dir: &str, install_dir: &str) -> bool {
    // Source shell profile so nvm/cargo are available in non-interactive SSH
    let source_profile = r#"for f in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile" "$HOME/.cargo/env"; do [ -f "$f" ] && source "$f" 2>/dev/null || true; done"#;

    // Check if cargo and node (20+) are available
    let check_deps = format!(
        r#"{source_profile}; command -v cargo >/dev/null 2>&1 && command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 && node -e "if(parseInt(process.version.slice(1))<20){{console.error('Node.js 20+ required, got '+process.version);process.exit(1)}}""#
    );
    let deps_ok = Command::new("ssh")
        .args([host, &check_deps])
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    if !deps_ok {
        eprintln!("Remote host is missing cargo, node (20+), or npm. Cannot auto-provision.");
        eprintln!("Please install Rust and Node.js 20+ on the remote host first.");
        return false;
    }

    let script = format!(
        r#"# Load shell profile for nvm/cargo in non-interactive SSH
for f in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile" "$HOME/.cargo/env"; do [ -f "$f" ] && source "$f" 2>/dev/null || true; done

set -e
INSTALL_DIR=$(eval echo "{install_dir}")
WORK_DIR=$(eval echo "{remote_dir}")
BIN="$INSTALL_DIR/neige/target/release/neige-server"
NEED_BUILD=0

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Clone or pull
if [ -d neige/.git ]; then
    cd neige
    OLD_HEAD=$(git rev-parse HEAD)
    echo "[neige] Checking for updates..."
    git pull --ff-only
    NEW_HEAD=$(git rev-parse HEAD)
    if [ "$OLD_HEAD" != "$NEW_HEAD" ]; then
        echo "[neige] Code updated (${{OLD_HEAD:0:7}} → ${{NEW_HEAD:0:7}}), rebuilding..."
        NEED_BUILD=1
    fi
else
    echo "[neige] Cloning repository..."
    git clone {REPO_URL}
    cd neige
    NEED_BUILD=1
fi

# Build if needed (new clone, code changed, or binary missing)
if [ "$NEED_BUILD" = "1" ] || [ ! -x "$BIN" ]; then
    echo "[neige] Building frontend..."
    cd web && npm install --no-audit --no-fund && npm run build && cd ..

    echo "[neige] Building server..."
    cargo build --release -p neige-server 2>&1

    # Kill old server if running (will be restarted below)
    OLD_PID=$(pgrep -f "$BIN" | grep -v $$ || true)
    if [ -n "$OLD_PID" ]; then
        kill $OLD_PID 2>/dev/null || true
        echo "[neige] Stopped old server (pid=$OLD_PID)."
        sleep 1
    fi
else
    echo "[neige] Up to date."
fi

# Start server if not running
if curl -sf -o /dev/null --max-time 1 http://localhost:{port}/api/healthz 2>/dev/null; then
    echo "[neige] Server already running on port {port}."
    exit 0
fi

echo "[neige] Starting neige-server on port {port} in $WORK_DIR..."
cd "$WORK_DIR"
TERM=xterm-256color COLORTERM=truecolor nohup "$BIN" --port {port} --static-dir "$INSTALL_DIR/neige/web/dist" > "$INSTALL_DIR/neige/.neige-server.log" 2>&1 &
disown
NEIGE_PID=$!

# Wait for server to be ready
LOG="$INSTALL_DIR/neige/.neige-server.log"
for i in $(seq 1 15); do
    if curl -sf -o /dev/null --max-time 1 http://localhost:{port}/api/healthz 2>/dev/null; then
        echo "[neige] Server is ready (pid=$NEIGE_PID, cwd=$WORK_DIR)"
        if grep -q "Open this URL" "$LOG" 2>/dev/null; then
            echo ""
            echo "[neige] First-time setup — save this login URL (shown only once):"
            grep -A 3 "Open this URL" "$LOG"
        fi
        exit 0
    fi
    sleep 1
done

echo "[neige] Server failed to start. Check $INSTALL_DIR/neige/.neige-server.log"
exit 1
"#
    );

    println!("Checking remote neige...\n");

    let status = Command::new("ssh")
        .args([host, &script])
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status();

    match status {
        Ok(s) if s.success() => {
            println!();
            true
        }
        Ok(s) => {
            eprintln!("\nProvisioning failed (exit code: {})", s.code().unwrap_or(-1));
            false
        }
        Err(e) => {
            eprintln!("SSH error: {e}");
            false
        }
    }
}

fn start_master(host: &str, neige_port: u16, local_port: u16, control_path: &str) -> bool {
    println!("Establishing SSH tunnel to {host}...");
    println!("  Forwarding localhost:{local_port} → {host}:{neige_port}");

    let status = Command::new("ssh")
        .args([
            "-f", "-N",
            "-M", // ControlMaster
            "-S", control_path,
            "-L", &format!("{local_port}:localhost:{neige_port}"),
            "-o", "ExitOnForwardFailure=yes",
            "-o", "ServerAliveInterval=30",
            "-o", "ServerAliveCountMax=3",
            host,
        ])
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status();

    match status {
        Ok(s) if s.success() => {
            println!("SSH tunnel established.");
            true
        }
        Ok(s) => {
            eprintln!("SSH failed with exit code: {}", s.code().unwrap_or(-1));
            false
        }
        Err(e) => {
            eprintln!("Failed to spawn ssh: {e}");
            false
        }
    }
}

fn add_forward(host: &str, control_path: &str, local: u16, remote: u16) -> bool {
    let status = Command::new("ssh")
        .args([
            "-S", control_path,
            "-O", "forward",
            "-L", &format!("{local}:localhost:{remote}"),
            host,
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .status();

    match status {
        Ok(s) if s.success() => {
            println!("  + Forward localhost:{local} → {host}:{remote}");
            true
        }
        _ => false,
    }
}

fn cancel_forward(host: &str, control_path: &str, local: u16, remote: u16) -> bool {
    let status = Command::new("ssh")
        .args([
            "-S", control_path,
            "-O", "cancel",
            "-L", &format!("{local}:localhost:{remote}"),
            host,
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    match status {
        Ok(s) if s.success() => {
            println!("  - Removed localhost:{local} → {host}:{remote}");
            true
        }
        _ => false,
    }
}

fn check_master(host: &str, control_path: &str) -> bool {
    Command::new("ssh")
        .args(["-S", control_path, "-O", "check", host])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn stop_master(host: &str, control_path: &str) {
    let _ = Command::new("ssh")
        .args(["-S", control_path, "-O", "exit", host])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn open_browser(port: u16) {
    let url = format!("http://localhost:{port}");
    #[cfg(target_os = "macos")]
    let _ = Command::new("open").arg(&url).status();
    #[cfg(target_os = "linux")]
    let _ = Command::new("xdg-open").arg(&url).status();
    #[cfg(target_os = "windows")]
    let _ = Command::new("cmd").args(["/c", "start", &url]).status();
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    let local_port = cli.local_port.unwrap_or(cli.port);
    let control_path = cli
        .control_path
        .unwrap_or_else(|| default_control_path(&cli.host));

    // Ensure neige is up-to-date and running on remote
    if !cli.no_provision {
        if !ensure_remote(&cli.host, cli.port, &cli.remote_dir, &cli.install_dir) {
            std::process::exit(1);
        }
    }

    // Start SSH master connection with neige port forwarded
    if !start_master(&cli.host, cli.port, local_port, &control_path) {
        std::process::exit(1);
    }

    // Open browser
    if !cli.no_browser {
        println!("Opening http://localhost:{local_port}");
        open_browser(local_port);
    }

    println!("Watching for port forward changes (poll every {}s)...", cli.poll_interval);
    println!("Press Ctrl+C to disconnect.\n");

    // Track currently forwarded ports (excluding neige's own port)
    let mut active_forwards: HashSet<(u16, u16)> = HashSet::new();

    // Setup Ctrl+C handler
    let ctrl_path = control_path.clone();
    let host = cli.host.clone();
    tokio::spawn(async move {
        tokio::signal::ctrl_c().await.ok();
        println!("\nDisconnecting...");
        stop_master(&host, &ctrl_path);
        std::process::exit(0);
    });

    let client = reqwest::Client::new();
    let base_url = format!("http://localhost:{local_port}");

    loop {
        tokio::time::sleep(std::time::Duration::from_secs(cli.poll_interval)).await;

        // Check if SSH connection is still alive
        if !check_master(&cli.host, &control_path) {
            eprintln!("SSH connection lost. Exiting.");
            break;
        }

        // Poll neige config for port forward list
        let desired = match client
            .get(format!("{base_url}/api/config"))
            .send()
            .await
        {
            Ok(res) if res.status().is_success() => {
                match res.json::<NeigeConfig>().await {
                    Ok(config) => config
                        .port_forwards
                        .into_iter()
                        .filter(|p| p.remote_port != cli.port) // exclude neige itself
                        .map(|p| (p.local_port, p.remote_port))
                        .collect::<HashSet<_>>(),
                    Err(_) => continue,
                }
            }
            _ => continue,
        };

        // Add new forwards
        let to_add: Vec<_> = desired.difference(&active_forwards).copied().collect();
        for (local, remote) in to_add {
            if add_forward(&cli.host, &control_path, local, remote) {
                active_forwards.insert((local, remote));
            }
        }

        // Remove stale forwards
        let to_remove: Vec<_> = active_forwards
            .difference(&desired)
            .copied()
            .collect();
        for (local, remote) in to_remove {
            if cancel_forward(&cli.host, &control_path, local, remote) {
                active_forwards.remove(&(local, remote));
            }
        }
    }

    stop_master(&cli.host, &control_path);
}
