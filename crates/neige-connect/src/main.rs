use clap::Parser;
use serde::Deserialize;
use std::collections::HashSet;
use std::process::{Command, Stdio};

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

    /// Poll interval in seconds for dynamic port forwarding
    #[arg(long, default_value = "5")]
    poll_interval: u64,

    /// Don't open browser automatically
    #[arg(long)]
    no_browser: bool,

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
