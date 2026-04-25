use crate::attach::SessionClient;
use crate::attach::chat::ChatSessionClient;
use crate::attach::daemon;
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

/// How a conversation talks to its daemon. Terminal mode is the existing
/// PTY/xterm.js path; Chat mode runs the program headless under stream-json.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SessionMode {
    #[default]
    Terminal,
    Chat,
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
    /// Defaults to Terminal so old session files (which lack this field)
    /// load as the original PTY mode.
    #[serde(default)]
    pub mode: SessionMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConvInfo {
    pub id: Uuid,
    pub title: String,
    pub status: Status,
    pub program: String,
    pub cwd: String,
    /// The actual working directory (worktree path if applicable, otherwise same as cwd)
    pub effective_cwd: String,
    pub created_at: String,
    pub use_worktree: bool,
    pub worktree_branch: Option<String>,
    pub mode: SessionMode,
}

/// A single conversation backed by a session-daemon client. Exactly one of
/// `client` (terminal mode) or `chat_client` (chat mode) is populated when
/// the daemon is live, depending on `mode`.
pub struct Conversation {
    pub id: Uuid,
    pub title: String,
    pub program: String,
    pub cwd: String,
    pub proxy: Option<String>,
    pub use_worktree: bool,
    pub worktree_branch: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub mode: SessionMode,
    pub client: Option<SessionClient>,
    pub chat_client: Option<ChatSessionClient>,
}

impl Conversation {
    pub fn info(&self) -> ConvInfo {
        let status = match self.mode {
            SessionMode::Terminal => match &self.client {
                Some(c) if c.is_alive() => Status::Running,
                Some(_) => Status::Dead,
                None => Status::Detached,
            },
            SessionMode::Chat => match &self.chat_client {
                Some(c) if c.is_alive() => Status::Running,
                Some(_) => Status::Dead,
                None => Status::Detached,
            },
        };
        let effective_cwd = if self.use_worktree {
            find_worktree_cwd(&self.id, &self.cwd).unwrap_or_else(|| self.cwd.clone())
        } else {
            self.cwd.clone()
        };
        ConvInfo {
            id: self.id,
            title: self.title.clone(),
            status,
            program: self.program.clone(),
            cwd: self.cwd.clone(),
            effective_cwd,
            created_at: self.created_at.to_rfc3339(),
            use_worktree: self.use_worktree,
            worktree_branch: self.worktree_branch.clone(),
            mode: self.mode,
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
            mode: self.mode,
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
    #[serde(default)]
    pub worktree_name: Option<String>,
    /// Defaults to Terminal so existing clients that don't send `mode`
    /// continue to get a PTY session.
    #[serde(default)]
    pub mode: SessionMode,
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

/// Check if a directory is inside a git repository.
pub fn is_git_repo(path: &str) -> bool {
    std::process::Command::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .current_dir(path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Validate a user-supplied worktree name.
///
/// Claude CLI passes this through to `git worktree add -b worktree-<name>`, so
/// we require characters that are safe as both a shell arg and a git ref
/// component. Reject empty strings, whitespace, and anything outside
/// `[A-Za-z0-9._-]`.
fn sanitize_worktree_name(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if !trimmed.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) {
        return None;
    }
    Some(trimmed.to_string())
}

/// Build the shell command for a program, adding claude-specific flags.
fn build_command(
    program: &str,
    session_id: &Uuid,
    use_worktree: bool,
    is_git: bool,
    worktree_name: Option<&str>,
) -> String {
    if program == "claude" || program.starts_with("claude ") {
        let mut parts = vec![program.to_string()];
        parts.push(format!("--session-id {}", session_id));
        if use_worktree && is_git {
            match worktree_name.and_then(sanitize_worktree_name) {
                Some(name) => parts.push(format!("--worktree {}", name)),
                None => parts.push("--worktree".to_string()),
            }
        }
        parts.join(" ")
    } else {
        program.to_string()
    }
}

/// Build proxy environment variables from a proxy URL.
fn proxy_env(proxy: Option<&str>) -> Vec<(String, String)> {
    proxy.map(|p| {
        vec![
            ("HTTP_PROXY".to_string(), p.to_string()),
            ("HTTPS_PROXY".to_string(), p.to_string()),
            ("http_proxy".to_string(), p.to_string()),
            ("https_proxy".to_string(), p.to_string()),
        ]
    }).unwrap_or_default()
}

/// Build the resume command for a claude session.
fn build_resume_command(program: &str, session_id: &Uuid) -> String {
    if program == "claude" || program.starts_with("claude ") {
        format!("claude --resume {}", session_id)
    } else {
        program.to_string()
    }
}

/// Find the worktree cwd where Claude CLI stored a session's conversation data.
///
/// When a session is created with `--worktree`, Claude CLI creates a git worktree
/// under `.claude/worktrees/{name}` and stores conversation data in a project
/// directory keyed by that worktree path. On resume, we need to find and use that
/// worktree path as the cwd so `claude --resume` can locate the conversation.
fn find_worktree_cwd(session_id: &Uuid, base_cwd: &str) -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let projects_dir = Path::new(&home).join(".claude").join("projects");
    let session_str = session_id.to_string();
    let base_encoded = base_cwd.replace('/', "-");

    for entry in std::fs::read_dir(&projects_dir).ok()?.flatten() {
        let dir_name = entry.file_name().to_string_lossy().to_string();

        // Only consider project dirs derived from our base repo that involve worktrees
        if !dir_name.starts_with(&base_encoded) || !dir_name.contains("worktrees-") {
            continue;
        }

        // Check if this project dir contains our session (as dir or .jsonl)
        let has_session = entry.path().join(&session_str).exists()
            || entry.path().join(format!("{}.jsonl", session_str)).exists();
        if !has_session {
            continue;
        }

        // Extract worktree name and construct the path
        if let Some(idx) = dir_name.find("worktrees-") {
            let name = &dir_name[idx + "worktrees-".len()..];
            let worktree_path = format!("{}/.claude/worktrees/{}", base_cwd, name);
            if Path::new(&worktree_path).exists() {
                tracing::info!(
                    "found worktree cwd for session {}: {}",
                    session_id, worktree_path
                );
                return Some(worktree_path);
            }
        }
    }
    None
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

/// Ensure a daemon is up for `id` and connect a terminal client to it,
/// rolling back the daemon spawn if the client connect fails. Reused by
/// `create` and `resume` so both paths converge on the same cleanup
/// semantics.
async fn spawn_and_connect(
    id: &Uuid,
    command: &str,
    cwd: &str,
    env: &[(String, String)],
) -> Result<SessionClient, String> {
    // Idempotent: if a live daemon already exists `command`/env args are
    // ignored and `created` comes back false; in that case we don't kill
    // the (pre-existing) daemon on connect failure.
    let created = daemon::create_session(id, command, cwd, env).await?;
    match SessionClient::connect(id, 200, 50).await {
        Ok(client) => Ok(client),
        Err(e) => {
            if created {
                daemon::kill_session(id).await;
            }
            Err(e)
        }
    }
}

/// Same as `spawn_and_connect` but for chat-mode daemons. The argv is passed
/// to the daemon verbatim (no shell wrapping).
async fn spawn_and_connect_chat(
    id: &Uuid,
    argv: &[String],
    cwd: &str,
    env: &[(String, String)],
) -> Result<ChatSessionClient, String> {
    let created = daemon::create_chat_session(id, argv, cwd, env).await?;
    match ChatSessionClient::connect(id).await {
        Ok(client) => Ok(client),
        Err(e) => {
            if created {
                daemon::kill_session(id).await;
            }
            Err(e)
        }
    }
}

/// Build the chat-mode argv for a claude subprocess. The first element is
/// the binary; the rest are claude flags. `resume` toggles `--resume`
/// vs `--session-id`.
fn build_chat_argv(program: &str, session_id: &Uuid, resume: bool) -> Vec<String> {
    // For now we only know how to drive `claude` headless. If the program is
    // something else, fall back to splitting it on whitespace and trust the
    // caller. The MVP only ships the claude path.
    let bin = if program.is_empty() || program == "claude" || program.starts_with("claude") {
        "claude".to_string()
    } else {
        program.split_whitespace().next().unwrap_or("claude").to_string()
    };
    let mut argv = vec![
        bin,
        "--print".to_string(),
        // Claude CLI rejects --print + --output-format=stream-json without
        // --verbose ("Error: When using --print, --output-format=stream-json
        // requires --verbose"). Without this flag the subprocess exits 1
        // immediately, the daemon sees ChildExited, and the socket vanishes
        // — so user-message frames write into the void.
        "--verbose".to_string(),
        "--input-format=stream-json".to_string(),
        "--output-format=stream-json".to_string(),
        "--include-partial-messages".to_string(),
        "--include-hook-events".to_string(),
    ];
    if resume {
        argv.push("--resume".to_string());
        argv.push(session_id.to_string());
    } else {
        argv.push("--session-id".to_string());
        argv.push(session_id.to_string());
    }
    argv
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
                mode: meta.mode,
                client: None, // detached
                chat_client: None,
            };
            self.convs.insert(conv.id, conv);
        }
        if !self.convs.is_empty() {
            tracing::info!("loaded {} sessions from disk", self.convs.len());
        }
    }

    pub async fn create(&mut self, req: CreateConvRequest) -> Result<ConvInfo, String> {
        let id = Uuid::new_v4();
        let cwd = if req.cwd.is_empty() {
            self.project_cwd.clone()
        } else {
            req.cwd.clone()
        };
        let title = if req.title.is_empty() || req.title == "untitled" {
            std::path::Path::new(&cwd)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("untitled")
                .to_string()
        } else {
            req.title.clone()
        };

        let is_git = is_git_repo(&cwd);
        let use_worktree = req.use_worktree && is_git;
        let env = proxy_env(req.proxy.as_deref());

        let (client, chat_client, worktree_branch) = match req.mode {
            SessionMode::Terminal => {
                let command = build_command(
                    &req.program,
                    &id,
                    use_worktree,
                    is_git,
                    req.worktree_name.as_deref(),
                );
                let worktree_branch = if use_worktree
                    && (req.program == "claude" || req.program.starts_with("claude "))
                {
                    Some(format!("neige/{}", id))
                } else {
                    None
                };
                tracing::info!(
                    "spawning terminal session {id}: command={command:?}, cwd={cwd:?}, is_git={is_git}, use_worktree={use_worktree}"
                );
                let client = spawn_and_connect(&id, &command, &cwd, &env).await?;
                (Some(client), None, worktree_branch)
            }
            SessionMode::Chat => {
                // Worktrees are a Claude CLI feature wired through the
                // `--worktree` flag, which only makes sense when claude
                // owns the session. The headless chat path doesn't manage
                // worktrees yet — we just spawn in `cwd` directly.
                let argv = build_chat_argv(&req.program, &id, false);
                tracing::info!(
                    "spawning chat session {id}: argv={argv:?}, cwd={cwd:?}"
                );
                let chat = spawn_and_connect_chat(&id, &argv, &cwd, &env).await?;
                (None, Some(chat), None)
            }
        };

        let conv = Conversation {
            id,
            title,
            program: req.program,
            cwd,
            proxy: req.proxy,
            use_worktree,
            worktree_branch,
            created_at: chrono::Utc::now(),
            mode: req.mode,
            client,
            chat_client,
        };

        let info = conv.info();
        save_session(&conv.meta(), &self.project_cwd);
        self.convs.insert(id, conv);
        Ok(info)
    }

    /// Resume a detached session by reattaching to its live daemon (or
    /// spawning a fresh one with a `--resume` command if the daemon's gone).
    pub async fn resume(&mut self, id: &Uuid) -> Result<ConvInfo, String> {
        let conv = self.convs.get_mut(id)
            .ok_or_else(|| "session not found".to_string())?;

        match conv.mode {
            SessionMode::Terminal => {
                if conv.client.as_ref().is_some_and(|c| c.is_alive()) {
                    return Ok(conv.info());
                }

                let command = build_resume_command(&conv.program, &conv.id);
                let env = proxy_env(conv.proxy.as_deref());

                // For worktree sessions, find the actual worktree path where
                // Claude CLI stored the conversation data; fall back to the
                // saved cwd.
                let cwd = if conv.use_worktree {
                    find_worktree_cwd(&conv.id, &conv.cwd).unwrap_or_else(|| conv.cwd.clone())
                } else {
                    conv.cwd.clone()
                };

                // Idempotent: if the daemon from before the neige-server restart is
                // still alive, create_session short-circuits and `command`/env args
                // are ignored — the user reattaches to the same live claude. If the
                // daemon is gone, a fresh one is spawned with the resume command.
                let client = spawn_and_connect(&conv.id, &command, &cwd, &env).await?;
                conv.client = Some(client);
            }
            SessionMode::Chat => {
                if conv.chat_client.as_ref().is_some_and(|c| c.is_alive()) {
                    return Ok(conv.info());
                }
                let argv = build_chat_argv(&conv.program, &conv.id, true);
                let env = proxy_env(conv.proxy.as_deref());
                let cwd = conv.cwd.clone();
                let chat = spawn_and_connect_chat(&conv.id, &argv, &cwd, &env).await?;
                conv.chat_client = Some(chat);
            }
        }

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
    pub async fn remove(&mut self, id: &Uuid) {
        // Kill the session daemon so the inner program stops; dropping only
        // our socket would leave the daemon (and the claude it's running)
        // orphaned.
        daemon::kill_session(id).await;
        remove_session_file(id, &self.project_cwd);
        self.convs.remove(id);
    }
}

pub type SharedManager = Arc<Mutex<ConversationManager>>;

pub fn new_shared_manager(project_cwd: &str) -> SharedManager {
    Arc::new(Mutex::new(ConversationManager::new(project_cwd)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_mode_serializes_lowercase() {
        assert_eq!(serde_json::to_string(&SessionMode::Terminal).unwrap(), "\"terminal\"");
        assert_eq!(serde_json::to_string(&SessionMode::Chat).unwrap(), "\"chat\"");
    }

    #[test]
    fn session_mode_round_trip() {
        for m in [SessionMode::Terminal, SessionMode::Chat] {
            let s = serde_json::to_string(&m).unwrap();
            let parsed: SessionMode = serde_json::from_str(&s).unwrap();
            assert_eq!(parsed, m);
        }
    }

    #[test]
    fn session_mode_default_is_terminal() {
        assert_eq!(SessionMode::default(), SessionMode::Terminal);
    }

    #[test]
    fn legacy_session_meta_loads_as_terminal() {
        // Old session files written before the `mode` field existed must
        // still deserialize, defaulting to Terminal.
        let legacy = serde_json::json!({
            "id": "00000000-0000-0000-0000-000000000001",
            "title": "old",
            "program": "claude",
            "cwd": "/tmp",
            "proxy": null,
            "use_worktree": false,
            "worktree_branch": null,
            "created_at": "2024-01-01T00:00:00Z",
            "last_active": "2024-01-01T00:00:00Z",
        });
        let meta: SessionMeta = serde_json::from_value(legacy).unwrap();
        assert_eq!(meta.mode, SessionMode::Terminal);
    }

    #[test]
    fn create_conv_request_default_mode_is_terminal() {
        let body = serde_json::json!({
            "title": "x",
            "program": "claude",
            "cwd": "/tmp",
            "proxy": null,
            "use_worktree": false,
        });
        let req: CreateConvRequest = serde_json::from_value(body).unwrap();
        assert_eq!(req.mode, SessionMode::Terminal);
    }

    #[test]
    fn create_conv_request_accepts_chat_mode() {
        let body = serde_json::json!({
            "title": "x",
            "program": "claude",
            "cwd": "/tmp",
            "proxy": null,
            "use_worktree": false,
            "mode": "chat",
        });
        let req: CreateConvRequest = serde_json::from_value(body).unwrap();
        assert_eq!(req.mode, SessionMode::Chat);
    }

    #[test]
    fn build_chat_argv_fresh_uses_session_id() {
        let id = Uuid::nil();
        let argv = build_chat_argv("claude", &id, false);
        assert_eq!(argv[0], "claude");
        assert!(argv.iter().any(|a| a == "--print"));
        assert!(argv.iter().any(|a| a == "--input-format=stream-json"));
        assert!(argv.iter().any(|a| a == "--output-format=stream-json"));
        assert!(argv.iter().any(|a| a == "--session-id"));
        assert!(!argv.iter().any(|a| a == "--resume"));
    }

    #[test]
    fn build_chat_argv_resume_uses_resume_flag() {
        let id = Uuid::nil();
        let argv = build_chat_argv("claude", &id, true);
        assert!(argv.iter().any(|a| a == "--resume"));
        assert!(!argv.iter().any(|a| a == "--session-id"));
    }
}
