use crate::tmux::PtySession;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Running,
    Dead,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConvInfo {
    pub id: Uuid,
    pub title: String,
    pub status: Status,
    pub program: String,
    pub cwd: String,
    pub created_at: String,
}

/// A single conversation backed by a PTY session.
pub struct Conversation {
    pub id: Uuid,
    pub title: String,
    pub program: String,
    pub cwd: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub pty: PtySession,
}

impl Conversation {
    pub fn info(&self) -> ConvInfo {
        let status = if self.pty.is_alive() {
            Status::Running
        } else {
            Status::Dead
        };
        ConvInfo {
            id: self.id,
            title: self.title.clone(),
            status,
            program: self.program.clone(),
            cwd: self.cwd.clone(),
            created_at: self.created_at.to_rfc3339(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct CreateConvRequest {
    pub title: String,
    #[serde(default = "default_program")]
    pub program: String,
    #[serde(default = "default_cwd")]
    pub cwd: String,
    pub proxy: Option<String>,
}

fn default_program() -> String {
    "claude".to_string()
}

fn default_cwd() -> String {
    std::env::current_dir()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string()
}

/// Manages all conversations.
pub struct ConversationManager {
    convs: HashMap<Uuid, Conversation>,
}

impl ConversationManager {
    pub fn new() -> Self {
        Self {
            convs: HashMap::new(),
        }
    }

    pub fn create(&mut self, req: CreateConvRequest) -> Result<ConvInfo, String> {
        let id = Uuid::new_v4();
        let env = req.proxy.as_deref().map(|p| {
            vec![
                ("HTTP_PROXY".to_string(), p.to_string()),
                ("HTTPS_PROXY".to_string(), p.to_string()),
                ("http_proxy".to_string(), p.to_string()),
                ("https_proxy".to_string(), p.to_string()),
            ]
        }).unwrap_or_default();
        let pty = PtySession::spawn(&req.program, &req.cwd, 200, 50, &env)?;

        let conv = Conversation {
            id,
            title: req.title,
            program: req.program,
            cwd: req.cwd,
            created_at: chrono::Utc::now(),
            pty,
        };

        let info = conv.info();
        self.convs.insert(id, conv);
        Ok(info)
    }

    pub fn list(&self) -> Vec<ConvInfo> {
        self.convs.values().map(|c| c.info()).collect()
    }

    pub fn get(&self, id: &Uuid) -> Option<&Conversation> {
        self.convs.get(id)
    }

    pub fn remove(&mut self, id: &Uuid) {
        self.convs.remove(id);
    }
}

pub type SharedManager = Arc<Mutex<ConversationManager>>;

pub fn new_shared_manager() -> SharedManager {
    Arc::new(Mutex::new(ConversationManager::new()))
}
