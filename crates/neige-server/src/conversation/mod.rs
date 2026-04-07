use crate::tmux::PtySession;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Running,
    Detached,
    Dead,
}

/// Persisted session metadata stored in .neige/sessions/<id>.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMeta {
    pub id: Uuid,
    pub title: String,
    pub program: String,
    pub cwd: String,
    pub proxy: Option<String>,
    pub use_worktree: bool,
    pub worktree_branch: Option<String>,
    pub created_at: String,
    pub last_active: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConvInfo {
    pub id: Uuid,
    pub title: String,
    pub status: Status,
    pub program: String,
    pub cwd: String,
    pub created_at: String,
    pub use_worktree: bool,
    pub worktree_branch: Option<String>,
}

/// A single conversation backed by a PTY session.
pub struct Conversation {
    pub id: Uuid,
    pub title: String,
    pub program: String,
    pub cwd: String,
    pub proxy: Option<String>,
    pub use_worktree: bool,
    pub worktree_branch: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub pty: Option<PtySession>,
}

impl Conversation {
    pub fn info(&self) -> ConvInfo {
        let status = match &self.pty {
            Some(pty) if pty.is_alive() => Status::Running,
            Some(_) => Status::Dead,
            None => Status::Detached,
        };
        ConvInfo {
            id: self.id,
            title: self.title.clone(),
            status,
            program: self.program.clone(),
            cwd: self.cwd.clone(),
            created_at: self.created_at.to_rfc3339(),
            use_worktree: self.use_worktree,
            worktree_branch: self.worktree_branch.clone(),
        }
    }

    pub fn meta(&self) -> SessionMeta {
        SessionMeta {
            id: self.id,
            title: self.title.clone(),
            program: self.program.clone(),
            cwd: self.cwd.clone(),
            proxy: self.proxy.clone(),
            use_worktree: self.use_worktree,
            worktree_branch: self.worktree_branch.clone(),
            created_at: self.created_at.to_rfc3339(),
            last_active: chrono::Utc::now().to_rfc3339(),
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
    #[serde(default = "default_true")]
    pub use_worktree: bool,
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

fn default_true() -> bool {
    true
}

/// Check if a directory is inside a git repository (public wrapper).
pub fn is_git_repo_public(path: &str) -> bool {
    is_git_repo(path)
}

/// Check if a directory is inside a git repository.
fn is_git_repo(path: &str) -> bool {
    std::process::Command::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .current_dir(path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Build the shell command for a program, adding claude-specific flags.
fn build_command(program: &str, session_id: &Uuid, use_worktree: bool, is_git: bool) -> String {
    if program == "claude" || program.starts_with("claude ") {
        let mut parts = vec![program.to_string()];
        parts.push(format!("--session-id {}", session_id));
        if use_worktree && is_git {
            parts.push("--worktree".to_string());
        }
        parts.join(" ")
    } else {
        program.to_string()
    }
}

/// Build the resume command for a claude session.
fn build_resume_command(program: &str, session_id: &Uuid) -> String {
    if program == "claude" || program.starts_with("claude ") {
        format!("claude --resume {}", session_id)
    } else {
        program.to_string()
    }
}

/// Get the .neige directory for a project.
pub fn neige_dir(project_cwd: &str) -> PathBuf {
    Path::new(project_cwd).join(".neige")
}

/// Get the .neige sessions directory, relative to a project cwd.
fn sessions_dir(project_cwd: &str) -> PathBuf {
    neige_dir(project_cwd).join("sessions")
}

/// Save session metadata to .neige/sessions/<id>.json
fn save_session(meta: &SessionMeta, project_cwd: &str) {
    let dir = sessions_dir(project_cwd);
    if let Err(e) = std::fs::create_dir_all(&dir) {
        tracing::warn!("failed to create sessions dir: {e}");
        return;
    }
    let path = dir.join(format!("{}.json", meta.id));
    match serde_json::to_string_pretty(meta) {
        Ok(json) => {
            if let Err(e) = std::fs::write(&path, json) {
                tracing::warn!("failed to save session {}: {e}", meta.id);
            }
        }
        Err(e) => tracing::warn!("failed to serialize session {}: {e}", meta.id),
    }
}

/// Remove session metadata file.
fn remove_session_file(id: &Uuid, project_cwd: &str) {
    let path = sessions_dir(project_cwd).join(format!("{}.json", id));
    let _ = std::fs::remove_file(path);
}

/// Load all session metadata from .neige/sessions/
fn load_sessions(project_cwd: &str) -> Vec<SessionMeta> {
    let dir = sessions_dir(project_cwd);
    let mut sessions = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "json") {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    match serde_json::from_str::<SessionMeta>(&content) {
                        Ok(meta) => sessions.push(meta),
                        Err(e) => tracing::warn!("failed to parse {}: {e}", path.display()),
                    }
                }
            }
        }
    }
    sessions
}

/// Manages all conversations.
pub struct ConversationManager {
    convs: HashMap<Uuid, Conversation>,
    /// The base project directory (where .neige/ lives)
    project_cwd: String,
}

impl ConversationManager {
    pub fn new(project_cwd: &str) -> Self {
        let mut mgr = Self {
            convs: HashMap::new(),
            project_cwd: project_cwd.to_string(),
        };
        mgr.load_from_disk();
        mgr
    }

    pub fn project_cwd(&self) -> &str {
        &self.project_cwd
    }

    /// Load persisted sessions from .neige/sessions/ as detached conversations.
    fn load_from_disk(&mut self) {
        let sessions = load_sessions(&self.project_cwd);
        for meta in sessions {
            let created_at = chrono::DateTime::parse_from_rfc3339(&meta.created_at)
                .map(|dt| dt.with_timezone(&chrono::Utc))
                .unwrap_or_else(|_| chrono::Utc::now());
            let conv = Conversation {
                id: meta.id,
                title: meta.title,
                program: meta.program,
                cwd: meta.cwd,
                proxy: meta.proxy,
                use_worktree: meta.use_worktree,
                worktree_branch: meta.worktree_branch,
                created_at,
                pty: None, // detached
            };
            self.convs.insert(conv.id, conv);
        }
        if !self.convs.is_empty() {
            tracing::info!("loaded {} sessions from disk", self.convs.len());
        }
    }

    pub fn create(&mut self, req: CreateConvRequest) -> Result<ConvInfo, String> {
        let id = Uuid::new_v4();
        let cwd = if req.cwd.is_empty() {
            self.project_cwd.clone()
        } else {
            req.cwd.clone()
        };
        let is_git = is_git_repo(&cwd);
        let use_worktree = req.use_worktree && is_git;

        let command = build_command(&req.program, &id, use_worktree, is_git);
        let worktree_branch = if use_worktree && (req.program == "claude" || req.program.starts_with("claude ")) {
            Some(format!("neige/{}", id))
        } else {
            None
        };

        let env = req.proxy.as_deref().map(|p| {
            vec![
                ("HTTP_PROXY".to_string(), p.to_string()),
                ("HTTPS_PROXY".to_string(), p.to_string()),
                ("http_proxy".to_string(), p.to_string()),
                ("https_proxy".to_string(), p.to_string()),
            ]
        }).unwrap_or_default();

        tracing::info!(
            "spawning session {id}: command={command:?}, cwd={cwd:?}, is_git={is_git}, use_worktree={use_worktree}"
        );
        let pty = PtySession::spawn(&command, &cwd, 200, 50, &env)?;

        let conv = Conversation {
            id,
            title: req.title,
            program: req.program,
            cwd,
            proxy: req.proxy,
            use_worktree,
            worktree_branch,
            created_at: chrono::Utc::now(),
            pty: Some(pty),
        };

        let info = conv.info();
        save_session(&conv.meta(), &self.project_cwd);
        self.convs.insert(id, conv);
        Ok(info)
    }

    /// Resume a detached session by spawning a new PTY with `claude --resume`.
    pub fn resume(&mut self, id: &Uuid) -> Result<ConvInfo, String> {
        let conv = self.convs.get_mut(id)
            .ok_or_else(|| "session not found".to_string())?;

        if conv.pty.as_ref().is_some_and(|p| p.is_alive()) {
            return Ok(conv.info());
        }

        let command = build_resume_command(&conv.program, &conv.id);
        let env = conv.proxy.as_deref().map(|p| {
            vec![
                ("HTTP_PROXY".to_string(), p.to_string()),
                ("HTTPS_PROXY".to_string(), p.to_string()),
                ("http_proxy".to_string(), p.to_string()),
                ("https_proxy".to_string(), p.to_string()),
            ]
        }).unwrap_or_default();

        let pty = PtySession::spawn(&command, &conv.cwd, 200, 50, &env)?;
        conv.pty = Some(pty);

        save_session(&conv.meta(), &self.project_cwd);
        Ok(conv.info())
    }

    pub fn list(&self) -> Vec<ConvInfo> {
        let mut list: Vec<_> = self.convs.values().map(|c| c.info()).collect();
        list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        list
    }

    pub fn get(&self, id: &Uuid) -> Option<&Conversation> {
        self.convs.get(id)
    }

    /// Update conversation metadata (e.g. title).
    pub fn update(&mut self, id: &Uuid, title: Option<&str>) -> Option<ConvInfo> {
        let conv = self.convs.get_mut(id)?;
        if let Some(t) = title {
            conv.title = t.to_string();
        }
        save_session(&conv.meta(), &self.project_cwd);
        Some(conv.info())
    }

    /// Remove a conversation and clean up its session file.
    pub fn remove(&mut self, id: &Uuid) {
        remove_session_file(id, &self.project_cwd);
        self.convs.remove(id);
    }
}

pub type SharedManager = Arc<Mutex<ConversationManager>>;

pub fn new_shared_manager(project_cwd: &str) -> SharedManager {
    Arc::new(Mutex::new(ConversationManager::new(project_cwd)))
}
