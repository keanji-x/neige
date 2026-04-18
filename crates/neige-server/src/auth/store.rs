use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuthFile {
    pub version: u32,
    pub token_hash: String,
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub rotated_at: Option<DateTime<Utc>>,
}

impl AuthFile {
    pub fn new(token_hash: String) -> Self {
        Self {
            version: 1,
            token_hash,
            created_at: Utc::now(),
            rotated_at: None,
        }
    }
}

pub fn auth_file_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".config/neige/auth.json")
}

pub fn load_auth_file(path: &Path) -> std::io::Result<Option<AuthFile>> {
    match std::fs::read_to_string(path) {
        Ok(s) => {
            let parsed: AuthFile = serde_json::from_str(&s)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
            Ok(Some(parsed))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn save_auth_file(path: &Path, file: &AuthFile) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
        }
    }
    let json = serde_json::to_string_pretty(file)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .mode(0o600)
            .open(path)?;
        f.write_all(json.as_bytes())?;
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, &json)?;
    }
    Ok(())
}

#[derive(Debug, Default)]
pub struct SessionStore {
    inner: Mutex<HashMap<Uuid, DateTime<Utc>>>,
}

impl SessionStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn create(&self, ttl: chrono::Duration) -> Uuid {
        let id = Uuid::new_v4();
        let exp = Utc::now() + ttl;
        self.inner.lock().unwrap().insert(id, exp);
        id
    }

    pub fn valid(&self, id: &Uuid) -> bool {
        let mut map = self.inner.lock().unwrap();
        match map.get(id).copied() {
            Some(exp) if exp > Utc::now() => true,
            Some(_) => {
                map.remove(id);
                false
            }
            None => false,
        }
    }

    pub fn revoke(&self, id: &Uuid) {
        self.inner.lock().unwrap().remove(id);
    }

    #[allow(dead_code)]
    pub fn revoke_all(&self) {
        self.inner.lock().unwrap().clear();
    }
}

/// Simple fixed-window rate limiter: `LIMIT` attempts per `WINDOW` per peer IP.
#[derive(Debug, Default)]
pub struct LoginRateLimiter {
    inner: Mutex<HashMap<IpAddr, (Instant, u32)>>,
}

impl LoginRateLimiter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns `true` if the request is within the limit.
    pub fn check(&self, peer: IpAddr) -> bool {
        const LIMIT: u32 = 10;
        const WINDOW: std::time::Duration = std::time::Duration::from_secs(60);
        let now = Instant::now();
        let mut map = self.inner.lock().unwrap();
        let entry = map.entry(peer).or_insert((now, 0));
        if now.duration_since(entry.0) > WINDOW {
            *entry = (now, 0);
        }
        entry.1 += 1;
        entry.1 <= LIMIT
    }
}
