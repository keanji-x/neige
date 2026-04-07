use serde::{Deserialize, Serialize};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TunnelStatus {
    Connected,
    Disconnected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortForward {
    pub remote_port: u16,
    pub local_port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelConfig {
    pub ssh_host: String,
    pub ports: Vec<PortForward>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TunnelInfo {
    pub status: TunnelStatus,
    pub ssh_host: String,
    pub ports: Vec<PortForward>,
    pub error: Option<String>,
}

pub struct TunnelManager {
    child: Option<Child>,
    config: Option<TunnelConfig>,
    last_error: Option<String>,
}

impl TunnelManager {
    pub fn new() -> Self {
        Self {
            child: None,
            config: None,
            last_error: None,
        }
    }

    pub fn status(&mut self) -> TunnelInfo {
        // Check if process is still alive
        let alive = if let Some(child) = &mut self.child {
            match child.try_wait() {
                Ok(None) => true, // still running
                Ok(Some(status)) => {
                    if !status.success() {
                        self.last_error = Some(format!("SSH exited with {}", status));
                    }
                    self.child = None;
                    false
                }
                Err(e) => {
                    self.last_error = Some(format!("process error: {e}"));
                    self.child = None;
                    false
                }
            }
        } else {
            false
        };

        TunnelInfo {
            status: if alive {
                TunnelStatus::Connected
            } else {
                TunnelStatus::Disconnected
            },
            ssh_host: self
                .config
                .as_ref()
                .map(|c| c.ssh_host.clone())
                .unwrap_or_default(),
            ports: self
                .config
                .as_ref()
                .map(|c| c.ports.clone())
                .unwrap_or_default(),
            error: self.last_error.clone(),
        }
    }

    pub fn start(&mut self, config: TunnelConfig) -> Result<TunnelInfo, String> {
        // Stop existing tunnel first
        self.stop();

        if config.ssh_host.is_empty() {
            return Err("SSH host is required".to_string());
        }
        if config.ports.is_empty() {
            return Err("At least one port forward is required".to_string());
        }

        let mut cmd = Command::new("ssh");
        cmd.arg("-N"); // no remote command
        cmd.arg("-o").arg("ExitOnForwardFailure=yes");
        cmd.arg("-o").arg("ServerAliveInterval=30");
        cmd.arg("-o").arg("ServerAliveCountMax=3");
        cmd.arg("-o").arg("StrictHostKeyChecking=accept-new");

        for pf in &config.ports {
            cmd.arg("-L")
                .arg(format!("{}:localhost:{}", pf.local_port, pf.remote_port));
        }

        cmd.arg(&config.ssh_host);
        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::null());
        cmd.stderr(Stdio::piped());

        tracing::info!(
            "starting SSH tunnel to {} with {} port forwards",
            config.ssh_host,
            config.ports.len()
        );

        match cmd.spawn() {
            Ok(child) => {
                self.child = Some(child);
                self.config = Some(config);
                self.last_error = None;
                Ok(self.status())
            }
            Err(e) => {
                let err = format!("failed to spawn ssh: {e}");
                self.last_error = Some(err.clone());
                Err(err)
            }
        }
    }

    pub fn stop(&mut self) -> TunnelInfo {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
            tracing::info!("SSH tunnel stopped");
        }
        self.last_error = None;
        self.status()
    }
}

impl Drop for TunnelManager {
    fn drop(&mut self) {
        self.stop();
    }
}

pub type SharedTunnel = Arc<Mutex<TunnelManager>>;

pub fn new_shared_tunnel() -> SharedTunnel {
    Arc::new(Mutex::new(TunnelManager::new()))
}
