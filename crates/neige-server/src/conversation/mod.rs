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
/// PTY/xterm.js path; Chat mode runs the program headless under stream-json
/// and carries a server-globally-unique `name` that AI/MCP tools use to
/// address it (replacing the UUID at the AI-facing tool surface).
///
/// Internally tagged on `mode`: serializes as `{"mode":"terminal"}` for
/// terminal sessions and `{"mode":"chat","name":"..."}` for chat sessions.
/// Combined with `#[serde(flatten)]` on the carrying struct, this keeps the
/// JSON shape flat (sibling fields rather than nested), which means old
/// terminal session files written before chat existed still parse — and
/// the type system prevents constructing a chat session without a name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(tag = "mode", rename_all = "lowercase")]
pub enum SessionMode {
    #[default]
    Terminal,
    Chat {
        /// Stable, server-globally-unique handle used by AI/MCP tools to
        /// address this session (instead of UUID). Picked at create time;
        /// can be changed later via the rename API. Empty strings are
        /// rejected at construction.
        name: String,
    },
}

impl SessionMode {
    /// Convenience: returns the chat name if this is a chat session.
    pub fn chat_name(&self) -> Option<&str> {
        match self {
            SessionMode::Terminal => None,
            SessionMode::Chat { name } => Some(name),
        }
    }
}

/// Persisted session metadata stored in .neige/sessions/<id>.json
///
/// Manual `Deserialize` (not derived) because `#[serde(flatten, default)]`
/// cannot fall back to the unit variant when the internally-tagged enum's
/// discriminator field is absent — it errors on the missing tag. Pre-mode
/// session files (and pre-chat REST clients) must still load as Terminal,
/// so we route deserialization through `SessionMetaRaw` which captures the
/// mode-related fields into a generic map and inspects them for a `"mode"`
/// key before deciding whether to delegate to `SessionMode::deserialize`
/// or default to Terminal.
#[derive(Debug, Clone, Serialize)]
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
    #[serde(flatten)]
    pub mode: SessionMode,
}

#[derive(Deserialize)]
struct SessionMetaRaw {
    id: Uuid,
    title: String,
    program: String,
    cwd: String,
    proxy: Option<String>,
    use_worktree: bool,
    worktree_branch: Option<String>,
    created_at: String,
    last_active: String,
    #[serde(flatten)]
    mode_extra: serde_json::Map<String, serde_json::Value>,
}

impl<'de> Deserialize<'de> for SessionMeta {
    fn deserialize<D: serde::Deserializer<'de>>(de: D) -> Result<Self, D::Error> {
        let raw = SessionMetaRaw::deserialize(de)?;
        let mode = mode_from_extras(raw.mode_extra).map_err(serde::de::Error::custom)?;
        Ok(SessionMeta {
            id: raw.id,
            title: raw.title,
            program: raw.program,
            cwd: raw.cwd,
            proxy: raw.proxy,
            use_worktree: raw.use_worktree,
            worktree_branch: raw.worktree_branch,
            created_at: raw.created_at,
            last_active: raw.last_active,
            mode,
        })
    }
}

/// Decide a `SessionMode` from the leftover fields captured by `flatten`.
/// Empty map (or one with no `mode` key) → Terminal, matching pre-mode
/// session-file shape. Otherwise delegate to `SessionMode::deserialize`,
/// which enforces the chat variant's `name` field.
fn mode_from_extras(
    extras: serde_json::Map<String, serde_json::Value>,
) -> Result<SessionMode, String> {
    if !extras.contains_key("mode") {
        return Ok(SessionMode::Terminal);
    }
    SessionMode::deserialize(serde_json::Value::Object(extras))
        .map_err(|e| format!("invalid mode/name fields: {e}"))
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
    #[serde(flatten)]
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
        let status = match &self.mode {
            SessionMode::Terminal => match &self.client {
                Some(c) if c.is_alive() => Status::Running,
                Some(_) => Status::Dead,
                None => Status::Detached,
            },
            SessionMode::Chat { .. } => match &self.chat_client {
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
            mode: self.mode.clone(),
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
            mode: self.mode.clone(),
        }
    }
}

/// Body of `POST /api/conversations`. Same manual-`Deserialize` story as
/// `SessionMeta`: terminal-mode REST clients omit `mode` entirely and
/// expect Terminal; chat-mode clients send `mode: "chat"` with a sibling
/// `name`. Internally-tagged + flatten cannot model "missing tag → unit
/// variant default" through derive alone.
#[derive(Clone, Serialize)]
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
    #[serde(flatten)]
    pub mode: SessionMode,
}

#[derive(Deserialize)]
struct CreateConvRequestRaw {
    title: String,
    #[serde(default = "default_program")]
    program: String,
    #[serde(default = "default_cwd")]
    cwd: String,
    proxy: Option<String>,
    #[serde(default = "default_true")]
    use_worktree: bool,
    #[serde(default)]
    worktree_name: Option<String>,
    #[serde(flatten)]
    mode_extra: serde_json::Map<String, serde_json::Value>,
}

impl<'de> Deserialize<'de> for CreateConvRequest {
    fn deserialize<D: serde::Deserializer<'de>>(de: D) -> Result<Self, D::Error> {
        let raw = CreateConvRequestRaw::deserialize(de)?;
        let mode = mode_from_extras(raw.mode_extra).map_err(serde::de::Error::custom)?;
        Ok(CreateConvRequest {
            title: raw.title,
            program: raw.program,
            cwd: raw.cwd,
            proxy: raw.proxy,
            use_worktree: raw.use_worktree,
            worktree_name: raw.worktree_name,
            mode,
        })
    }
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
    // Also drop the auto-generated MCP config file (best-effort: missing
    // file is not an error). Holds a Bearer token, so we'd rather not
    // leave it lying around after the session it was scoped to is gone.
    let _ = std::fs::remove_file(mcp_config_path(id, project_cwd));
    // And the per-session todo list — same lifecycle as the session.
    let _ = std::fs::remove_file(todos_path(id, project_cwd));
}

// -- per-session todo list ---------------------------------------------------

/// One todo entry. Keeps the shape close to Claude Code's TodoWrite tool so
/// orchestrators that already know that vocabulary feel at home.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, schemars::JsonSchema)]
pub struct Todo {
    /// Stable id within a session — the orchestrator picks it (string,
    /// arbitrary). Lets future updates reference an existing entry.
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub status: TodoStatus,
}

#[derive(
    Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default, schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum TodoStatus {
    #[default]
    Pending,
    InProgress,
    Completed,
}

fn todos_path(id: &Uuid, project_cwd: &str) -> PathBuf {
    sessions_dir(project_cwd).join(format!("{}.todos.json", id))
}

/// Read the todo list for `id`. Empty list when the file is missing —
/// callers shouldn't have to special-case "first time" vs "really empty".
pub fn read_todos(id: &Uuid, project_cwd: &str) -> Vec<Todo> {
    let path = todos_path(id, project_cwd);
    let Ok(content) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    serde_json::from_str(&content).unwrap_or_else(|e| {
        tracing::warn!("failed to parse todos {path:?}: {e}");
        Vec::new()
    })
}

/// Replace the todo list for `id` wholesale. Mirrors Claude Code's
/// TodoWrite semantics — the orchestrator sends the full list, server
/// persists it. Atomic write via tempfile-rename so a crashed write can't
/// truncate to half a list.
pub fn write_todos(id: &Uuid, project_cwd: &str, todos: &[Todo]) -> Result<(), String> {
    let path = todos_path(id, project_cwd);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create todos dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(todos).map_err(|e| format!("serialize todos: {e}"))?;
    let tmp = path.with_extension("todos.json.tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("write todos tmp: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("rename todos: {e}"))?;
    Ok(())
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
/// Settings for auto-injecting an `--mcp-config` file into chat sessions.
///
/// Stored on the manager and consulted at create/resume time. `base_url`
/// is *always* loopback for chat-spawned claudes (even when the server is
/// listening on 0.0.0.0) — the inner claude shares a host with the server.
#[derive(Clone)]
pub struct McpInjectConfig {
    pub base_url: String,
    pub internal_token: std::sync::Arc<String>,
    /// If true, skip injection entirely. Useful as a kill-switch when the
    /// inner claude shouldn't be aware of the orchestrator (e.g. the user
    /// wants completely sandboxed sessions).
    pub disabled: bool,
}

impl McpInjectConfig {
    pub fn loopback(port: u16, internal_token: std::sync::Arc<String>, disabled: bool) -> Self {
        Self {
            base_url: format!("http://127.0.0.1:{port}"),
            internal_token,
            disabled,
        }
    }
}

/// Path of the per-session MCP config file (lives next to session metadata).
fn mcp_config_path(id: &Uuid, project_cwd: &str) -> PathBuf {
    sessions_dir(project_cwd).join(format!("{}.mcp.json", id))
}

/// Write a per-session `mcp-internal.json` referencing the global `/mcp` route
/// so the inner claude can list/create/send to sibling sessions, plus the
/// per-session `/mcp/<id>` route for self-scoped tools (read_log/stop/get_info).
///
/// Returns `Some(path)` on success (caller passes it to `--mcp-config`), or
/// `None` if injection is disabled. Errors are logged + treated as "no inject"
/// — a missing config file is recoverable, a panicked spawn isn't.
fn write_mcp_config_file(
    id: &Uuid,
    project_cwd: &str,
    cfg: &McpInjectConfig,
) -> Option<PathBuf> {
    if cfg.disabled {
        return None;
    }
    let path = mcp_config_path(id, project_cwd);
    if let Some(parent) = path.parent()
        && let Err(e) = std::fs::create_dir_all(parent)
    {
        tracing::warn!("failed to create mcp config dir: {e}");
        return None;
    }

    // Two entries:
    //   - `neige`             → /mcp/<id>      (self + global tools merged)
    //   - `neige_orchestrate` → /mcp           (global tools only — handy if
    //                            the inner claude wants the *strict* shape
    //                            without self-scoped tools cluttering)
    let auth_header = format!("Bearer {}", cfg.internal_token);
    let body = serde_json::json!({
        "mcpServers": {
            "neige": {
                "type": "http",
                "url": format!("{}/mcp/{}", cfg.base_url, id),
                "headers": {"Authorization": auth_header},
            },
        }
    });

    let json = match serde_json::to_string_pretty(&body) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("failed to serialize mcp config: {e}");
            return None;
        }
    };

    if let Err(e) = std::fs::write(&path, json) {
        tracing::warn!("failed to write mcp config {path:?}: {e}");
        return None;
    }
    // Mode 0600 — the file holds a Bearer token. Best-effort; we don't
    // fatally fail if the platform refuses (Windows / unusual filesystems).
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Some(path)
}

fn build_chat_argv(
    program: &str,
    session_id: &Uuid,
    resume: bool,
    mcp_config_path: Option<&Path>,
) -> Vec<String> {
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
        // AskUserQuestion is a built-in tool the Claude Code TUI intercepts
        // via canUseTool to render an interactive picker. In --print mode
        // there is no canUseTool callback so the harness fallback returns a
        // 17-char placeholder ("Answer questions?") immediately, which
        // claude reads as the answer and moves on — the user never sees a
        // popup. Until we ship a real MCP-based replacement (Wave 5), block
        // the tool so the model writes questions as markdown instead.
        "--disallowedTools".to_string(),
        "AskUserQuestion".to_string(),
    ];
    if resume {
        argv.push("--resume".to_string());
        argv.push(session_id.to_string());
    } else {
        argv.push("--session-id".to_string());
        argv.push(session_id.to_string());
    }
    // --mcp-config is appended last so the path is easy to spot in
    // process listings and so the existing flags above stay diff-stable.
    if let Some(path) = mcp_config_path {
        argv.push("--mcp-config".to_string());
        argv.push(path.to_string_lossy().to_string());
    }
    argv
}

/// Manages all conversations.
pub struct ConversationManager {
    convs: HashMap<Uuid, Conversation>,
    /// Secondary index for chat sessions: chat name → uuid. Lets MCP tools
    /// resolve a name handed in by an AI caller to the internal Conversation
    /// in O(1). Only chat sessions are inserted; terminal sessions never
    /// participate in name addressing. Kept in sync by `create`, `remove`,
    /// `rename_chat`, and `load_from_disk`.
    chat_by_name: HashMap<String, Uuid>,
    /// The base project directory (where .neige/ lives)
    project_cwd: String,
    /// MCP injection settings for chat sessions. None means no injection
    /// (e.g. unit tests that don't need it); otherwise written into a
    /// per-session JSON and passed to claude via `--mcp-config`.
    mcp_inject: Option<McpInjectConfig>,
}

impl ConversationManager {
    pub fn new(project_cwd: &str) -> Self {
        Self::with_mcp_inject(project_cwd, None)
    }

    pub fn with_mcp_inject(project_cwd: &str, mcp_inject: Option<McpInjectConfig>) -> Self {
        let mut mgr = Self {
            convs: HashMap::new(),
            chat_by_name: HashMap::new(),
            project_cwd: project_cwd.to_string(),
            mcp_inject,
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
            // Reject duplicate chat names defensively (shouldn't happen given
            // the create-time uniqueness check, but a hand-edited session
            // file could). The first occurrence wins; subsequent ones load
            // their conv but leave the name index pointing at the original.
            if let SessionMode::Chat { name } = &meta.mode {
                match self.chat_by_name.get(name) {
                    Some(existing) if *existing != meta.id => {
                        tracing::warn!(
                            "duplicate chat name '{name}' on disk: keeping {existing}, \
                             leaving {} unindexed (rename it via the API to make it \
                             addressable again)",
                            meta.id
                        );
                    }
                    _ => {
                        self.chat_by_name.insert(name.clone(), meta.id);
                    }
                }
            }
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

        // Validate chat name up front: must be non-empty (uniqueness check
        // happens in commit 2 once the manager carries a name index).
        if let SessionMode::Chat { name } = &req.mode
            && name.trim().is_empty()
        {
            return Err("chat session requires a non-empty name".to_string());
        }
        if let SessionMode::Chat { name } = &req.mode
            && self.chat_by_name.contains_key(name)
        {
            return Err(format!("chat session name '{name}' already in use"));
        }

        let (client, chat_client, worktree_branch) = match &req.mode {
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
            SessionMode::Chat { .. } => {
                // Worktrees are a Claude CLI feature wired through the
                // `--worktree` flag, which only makes sense when claude
                // owns the session. The headless chat path doesn't manage
                // worktrees yet — we just spawn in `cwd` directly.
                let mcp_path = self
                    .mcp_inject
                    .as_ref()
                    .and_then(|cfg| write_mcp_config_file(&id, &self.project_cwd, cfg));
                let argv = build_chat_argv(&req.program, &id, false, mcp_path.as_deref());
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
        if let SessionMode::Chat { name } = &conv.mode {
            self.chat_by_name.insert(name.clone(), id);
        }
        self.convs.insert(id, conv);
        Ok(info)
    }

    /// Resume a detached session by reattaching to its live daemon (or
    /// spawning a fresh one with a `--resume` command if the daemon's gone).
    pub async fn resume(&mut self, id: &Uuid) -> Result<ConvInfo, String> {
        let conv = self.convs.get_mut(id)
            .ok_or_else(|| "session not found".to_string())?;

        match &conv.mode {
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
            SessionMode::Chat { .. } => {
                if conv.chat_client.as_ref().is_some_and(|c| c.is_alive()) {
                    return Ok(conv.info());
                }
                // Rewrite the MCP config in case the internal token rotated
                // since the previous spawn (server restart). Cheap, and
                // keeps the file's lifetime aligned with the daemon's.
                let mcp_path = self
                    .mcp_inject
                    .as_ref()
                    .and_then(|cfg| write_mcp_config_file(&conv.id, &self.project_cwd, cfg));
                let argv = build_chat_argv(&conv.program, &conv.id, true, mcp_path.as_deref());
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

    /// Resolve a chat session name to its uuid. Returns `None` for unknown
    /// names or if the named session isn't currently loaded. Terminal
    /// sessions are never indexed by name and won't appear here.
    pub fn id_by_chat_name(&self, name: &str) -> Option<Uuid> {
        self.chat_by_name.get(name).copied()
    }

    /// Resolve a chat session name straight to its Conversation. Convenience
    /// over `id_by_chat_name` + `get` for callers that need the conv directly.
    pub fn get_by_chat_name(&self, name: &str) -> Option<&Conversation> {
        self.id_by_chat_name(name).and_then(|id| self.convs.get(&id))
    }

    /// Update conversation metadata (e.g. title). Title is a free-form
    /// display label; no uniqueness check. To rename a chat session's
    /// addressing handle, call `rename_chat` instead.
    pub fn update(&mut self, id: &Uuid, title: Option<&str>) -> Option<ConvInfo> {
        let conv = self.convs.get_mut(id)?;
        if let Some(t) = title {
            conv.title = t.to_string();
        }
        save_session(&conv.meta(), &self.project_cwd);
        Some(conv.info())
    }

    /// Rename a chat session's addressing handle. Errors if the target is
    /// not a chat session, the new name is empty, or the new name collides
    /// with another chat session. The `chat_by_name` index is updated
    /// atomically with the in-memory model and the persisted metadata.
    pub fn rename_chat(&mut self, id: &Uuid, new_name: &str) -> Result<ConvInfo, String> {
        let trimmed = new_name.trim();
        if trimmed.is_empty() {
            return Err("chat session name cannot be empty".to_string());
        }
        // Uniqueness check before mutating anything. A no-op rename (same
        // name to same session) is allowed and returns Ok.
        if let Some(existing) = self.chat_by_name.get(trimmed)
            && existing != id
        {
            return Err(format!("chat session name '{trimmed}' already in use"));
        }
        let conv = self
            .convs
            .get_mut(id)
            .ok_or_else(|| "session not found".to_string())?;
        let old_name = match &conv.mode {
            SessionMode::Chat { name } => name.clone(),
            SessionMode::Terminal => {
                return Err(
                    "cannot rename a terminal session (only chat sessions have names)".to_string(),
                );
            }
        };
        conv.mode = SessionMode::Chat {
            name: trimmed.to_string(),
        };
        // Drop the old index entry first so a same-name no-op rename doesn't
        // briefly leave a stale entry between remove and insert.
        if old_name != trimmed {
            self.chat_by_name.remove(&old_name);
            self.chat_by_name.insert(trimmed.to_string(), *id);
        }
        save_session(&conv.meta(), &self.project_cwd);
        Ok(conv.info())
    }

    /// Remove a conversation and clean up its session file.
    pub async fn remove(&mut self, id: &Uuid) {
        // Kill the session daemon so the inner program stops; dropping only
        // our socket would leave the daemon (and the claude it's running)
        // orphaned.
        daemon::kill_session(id).await;
        remove_session_file(id, &self.project_cwd);
        if let Some(conv) = self.convs.remove(id)
            && let SessionMode::Chat { name } = &conv.mode
        {
            // Only drop the index entry if it still points at this id —
            // a rename mid-flight would have already replaced it.
            if self.chat_by_name.get(name).copied() == Some(*id) {
                self.chat_by_name.remove(name);
            }
        }
    }
}

pub type SharedManager = Arc<Mutex<ConversationManager>>;

pub fn new_shared_manager(project_cwd: &str) -> SharedManager {
    Arc::new(Mutex::new(ConversationManager::new(project_cwd)))
}

pub fn new_shared_manager_with_inject(
    project_cwd: &str,
    mcp_inject: Option<McpInjectConfig>,
) -> SharedManager {
    Arc::new(Mutex::new(ConversationManager::with_mcp_inject(
        project_cwd,
        mcp_inject,
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_mode_terminal_round_trips_via_meta() {
        // SessionMode is internally tagged on `mode` and only meaningful when
        // flattened into a carrying struct (the tag field becomes a sibling
        // of the struct's fields). Round-trip through SessionMeta to reflect
        // how it actually serializes on the wire.
        let meta = SessionMeta {
            id: Uuid::nil(),
            title: "t".into(),
            program: "claude".into(),
            cwd: "/tmp".into(),
            proxy: None,
            use_worktree: false,
            worktree_branch: None,
            created_at: "2024-01-01T00:00:00Z".into(),
            last_active: "2024-01-01T00:00:00Z".into(),
            mode: SessionMode::Terminal,
        };
        let s = serde_json::to_string(&meta).unwrap();
        assert!(s.contains(r#""mode":"terminal""#));
        // No `name` field on terminal sessions.
        assert!(!s.contains(r#""name""#));
        let parsed: SessionMeta = serde_json::from_str(&s).unwrap();
        assert_eq!(parsed.mode, SessionMode::Terminal);
    }

    #[test]
    fn session_mode_chat_carries_name_in_flat_json() {
        // Chat variant flattens its `name` field next to `mode` rather than
        // nesting it. Locks the wire shape AI clients see.
        let meta = SessionMeta {
            id: Uuid::nil(),
            title: "t".into(),
            program: "claude".into(),
            cwd: "/tmp".into(),
            proxy: None,
            use_worktree: false,
            worktree_branch: None,
            created_at: "2024-01-01T00:00:00Z".into(),
            last_active: "2024-01-01T00:00:00Z".into(),
            mode: SessionMode::Chat {
                name: "scraper".into(),
            },
        };
        let s = serde_json::to_string(&meta).unwrap();
        assert!(s.contains(r#""mode":"chat""#));
        assert!(s.contains(r#""name":"scraper""#));
        let parsed: SessionMeta = serde_json::from_str(&s).unwrap();
        assert_eq!(
            parsed.mode,
            SessionMode::Chat {
                name: "scraper".into()
            }
        );
    }

    #[test]
    fn session_mode_default_is_terminal() {
        assert_eq!(SessionMode::default(), SessionMode::Terminal);
    }

    #[test]
    fn legacy_session_meta_loads_as_terminal() {
        // Pre-`mode`-field session files must still deserialize, defaulting
        // to Terminal (achieved via `#[serde(flatten, default)]`).
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
    fn explicit_terminal_session_meta_loads() {
        // Sessions written after `mode` was added (but before chat existed)
        // include `mode: "terminal"` explicitly and no `name` field.
        let v = serde_json::json!({
            "id": "00000000-0000-0000-0000-000000000001",
            "title": "old",
            "program": "claude",
            "cwd": "/tmp",
            "proxy": null,
            "use_worktree": false,
            "worktree_branch": null,
            "created_at": "2024-01-01T00:00:00Z",
            "last_active": "2024-01-01T00:00:00Z",
            "mode": "terminal",
        });
        let meta: SessionMeta = serde_json::from_value(v).unwrap();
        assert_eq!(meta.mode, SessionMode::Terminal);
    }

    #[test]
    fn chat_session_meta_without_name_fails() {
        // Pre-launch invariant: chat-mode persistence MUST carry `name`.
        // If a hand-written or pre-name-field chat session file shows up,
        // we want a hard parse error rather than silently constructing a
        // chat session with an empty name.
        let v = serde_json::json!({
            "id": "00000000-0000-0000-0000-000000000001",
            "title": "old chat",
            "program": "claude",
            "cwd": "/tmp",
            "proxy": null,
            "use_worktree": false,
            "worktree_branch": null,
            "created_at": "2024-01-01T00:00:00Z",
            "last_active": "2024-01-01T00:00:00Z",
            "mode": "chat",
        });
        assert!(serde_json::from_value::<SessionMeta>(v).is_err());
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
    fn create_conv_request_accepts_chat_mode_with_name() {
        let body = serde_json::json!({
            "title": "x",
            "program": "claude",
            "cwd": "/tmp",
            "proxy": null,
            "use_worktree": false,
            "mode": "chat",
            "name": "scraper",
        });
        let req: CreateConvRequest = serde_json::from_value(body).unwrap();
        assert_eq!(
            req.mode,
            SessionMode::Chat {
                name: "scraper".into()
            }
        );
    }

    #[test]
    fn create_conv_request_chat_mode_without_name_fails() {
        // Type-system invariant: `mode: "chat"` requires `name`. The wire
        // shape rejects requests that omit it, before any handler runs.
        let body = serde_json::json!({
            "title": "x",
            "program": "claude",
            "cwd": "/tmp",
            "proxy": null,
            "use_worktree": false,
            "mode": "chat",
        });
        assert!(serde_json::from_value::<CreateConvRequest>(body).is_err());
    }

    #[test]
    fn build_chat_argv_fresh_uses_session_id() {
        let id = Uuid::nil();
        let argv = build_chat_argv("claude", &id, false, None);
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
        let argv = build_chat_argv("claude", &id, true, None);
        assert!(argv.iter().any(|a| a == "--resume"));
        assert!(!argv.iter().any(|a| a == "--session-id"));
    }

    #[test]
    fn build_chat_argv_includes_verbose() {
        // Claude CLI rejects `--print --output-format=stream-json` without
        // `--verbose`. Locking this assertion so a future refactor can't
        // strip it again — that bug had the daemon spawn claude, claude
        // exit code 1 instantly, the socket vanish, and the user's chat
        // turns silently dropped.
        for resume in [false, true] {
            let argv = build_chat_argv("claude", &Uuid::nil(), resume, None);
            assert!(
                argv.iter().any(|a| a == "--verbose"),
                "build_chat_argv must include --verbose (resume={resume}): got {argv:?}"
            );
        }
    }

    #[test]
    fn build_chat_argv_includes_partial_messages_and_hook_events() {
        // Mode B's value prop depends on partial-message deltas (live token
        // streaming) and hook events (permission-prompt observability). Lock
        // both flags.
        let argv = build_chat_argv("claude", &Uuid::nil(), false, None);
        assert!(argv.iter().any(|a| a == "--include-partial-messages"));
        assert!(argv.iter().any(|a| a == "--include-hook-events"));
    }

    #[test]
    fn build_chat_argv_disallows_ask_user_question() {
        // Until we ship an MCP-based AskUser tool, block the built-in so the
        // model writes questions as text instead of triggering the --print
        // harness's 17-char placeholder.
        let argv = build_chat_argv("claude", &Uuid::nil(), false, None);
        let mut iter = argv.iter();
        let mut found = false;
        while let Some(a) = iter.next() {
            if a == "--disallowedTools" {
                assert_eq!(iter.next().map(|s| s.as_str()), Some("AskUserQuestion"));
                found = true;
                break;
            }
        }
        assert!(found, "missing --disallowedTools AskUserQuestion: {argv:?}");
    }

    #[test]
    fn build_chat_argv_threads_mcp_config_path() {
        // When a config path is supplied (i.e. mcp_inject was active),
        // `--mcp-config <path>` must be present and adjacent.
        let p = std::path::PathBuf::from("/tmp/neige-fake-mcp.json");
        let argv = build_chat_argv("claude", &Uuid::nil(), false, Some(&p));
        let mut iter = argv.iter();
        let mut found = false;
        while let Some(a) = iter.next() {
            if a == "--mcp-config" {
                assert_eq!(iter.next().map(|s| s.as_str()), Some("/tmp/neige-fake-mcp.json"));
                found = true;
                break;
            }
        }
        assert!(found, "missing --mcp-config: {argv:?}");
    }

    #[test]
    fn build_chat_argv_omits_mcp_config_when_none() {
        // None means injection is off; --mcp-config must not appear.
        let argv = build_chat_argv("claude", &Uuid::nil(), false, None);
        assert!(!argv.iter().any(|a| a == "--mcp-config"));
    }

    #[test]
    fn write_mcp_config_file_respects_disabled_flag() {
        let dir = tempdir_for_test();
        let cfg = McpInjectConfig {
            base_url: "http://127.0.0.1:3030".to_string(),
            internal_token: std::sync::Arc::new("tok".to_string()),
            disabled: true,
        };
        assert!(write_mcp_config_file(&Uuid::nil(), dir.to_str().unwrap(), &cfg).is_none());
    }

    #[test]
    fn write_mcp_config_file_writes_expected_json() {
        // Lock the config schema so a future refactor can't accidentally
        // change the field names — claude-CLI's --mcp-config parser is
        // strict and a renamed field surfaces as a confusing 'no servers'.
        let dir = tempdir_for_test();
        let cfg = McpInjectConfig {
            base_url: "http://127.0.0.1:3030".to_string(),
            internal_token: std::sync::Arc::new("tok-abc".to_string()),
            disabled: false,
        };
        let id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap();
        let path = write_mcp_config_file(&id, dir.to_str().unwrap(), &cfg).unwrap();
        let content = std::fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        let entry = &parsed["mcpServers"]["neige"];
        assert_eq!(entry["type"], "http");
        assert_eq!(
            entry["url"],
            "http://127.0.0.1:3030/mcp/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        );
        assert_eq!(entry["headers"]["Authorization"], "Bearer tok-abc");
    }

    /// Throwaway tempdir for filesystem tests. We don't pull in the
    /// `tempfile` crate just for this — std::env::temp_dir + a uuid name
    /// is sufficient and deterministic enough.
    fn tempdir_for_test() -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("neige-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn read_todos_on_missing_file_returns_empty() {
        // First-time read must be empty, not an error — saves every caller
        // from having to special-case "no file yet".
        let dir = tempdir_for_test();
        let todos = read_todos(&Uuid::new_v4(), dir.to_str().unwrap());
        assert!(todos.is_empty());
    }

    #[test]
    fn write_then_read_todos_round_trips() {
        let dir = tempdir_for_test();
        let id = Uuid::new_v4();
        let list = vec![
            Todo {
                id: "t1".to_string(),
                text: "do thing".to_string(),
                status: TodoStatus::Pending,
            },
            Todo {
                id: "t2".to_string(),
                text: "do other".to_string(),
                status: TodoStatus::Completed,
            },
        ];
        write_todos(&id, dir.to_str().unwrap(), &list).unwrap();
        let read_back = read_todos(&id, dir.to_str().unwrap());
        assert_eq!(read_back, list);
    }

    #[test]
    fn write_todos_replaces_wholesale() {
        // Confirm TodoWrite-style replace semantics — second write doesn't
        // append, it overwrites. This is the contract the tool documents.
        let dir = tempdir_for_test();
        let id = Uuid::new_v4();
        let first = vec![Todo {
            id: "a".into(),
            text: "first".into(),
            status: TodoStatus::Pending,
        }];
        let second = vec![Todo {
            id: "b".into(),
            text: "second".into(),
            status: TodoStatus::InProgress,
        }];
        write_todos(&id, dir.to_str().unwrap(), &first).unwrap();
        write_todos(&id, dir.to_str().unwrap(), &second).unwrap();
        assert_eq!(read_todos(&id, dir.to_str().unwrap()), second);
    }

    #[test]
    fn todo_status_serializes_snake_case() {
        // The orchestrator-facing wire shape uses snake_case status values
        // — keep the serde rename in lock-step with the tool docs.
        assert_eq!(
            serde_json::to_string(&TodoStatus::InProgress).unwrap(),
            "\"in_progress\""
        );
        assert_eq!(
            serde_json::to_string(&TodoStatus::Pending).unwrap(),
            "\"pending\""
        );
        assert_eq!(
            serde_json::to_string(&TodoStatus::Completed).unwrap(),
            "\"completed\""
        );
    }
}
