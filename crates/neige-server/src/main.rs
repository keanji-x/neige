mod api;
mod auth;
mod conversation;
mod pty;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::Router;
use axum::routing::{get, post};
use clap::{Parser, Subcommand};
use tower_http::services::ServeDir;

#[derive(Parser)]
#[command(name = "neige-server", about = "Web-based terminal session manager")]
struct Cli {
    /// Port to listen on
    #[arg(short, long, default_value = "3030")]
    port: u16,

    /// Listen address. Defaults to 127.0.0.1 to avoid LAN exposure.
    #[arg(long, default_value = "127.0.0.1")]
    listen: String,

    /// Path to web/dist directory (auto-detected if not set)
    #[arg(long)]
    static_dir: Option<String>,

    /// Additional allowed Origin (e.g. https://neige.example.com). Can be repeated.
    #[arg(long = "allowed-origin")]
    allowed_origins: Vec<String>,

    /// Disable authentication entirely (DEV ONLY — forces --listen 127.0.0.1)
    #[arg(long)]
    no_auth: bool,

    /// Path to auth file override
    #[arg(long)]
    auth_file: Option<String>,

    #[command(subcommand)]
    cmd: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Auth management
    Auth {
        #[command(subcommand)]
        cmd: AuthCmd,
    },
}

#[derive(Subcommand)]
enum AuthCmd {
    /// Rotate the token (generates a new one, invalidates all existing sessions)
    Rotate,
    /// Print the current login URL. Requires a new token to be generated if
    /// the auth file already exists (plaintext token is never stored).
    PrintUrl {
        /// Base URL to print (e.g. http://127.0.0.1:3030)
        #[arg(long, default_value = "http://127.0.0.1:3030")]
        bind: String,
    },
}

fn resolve_static_dir(cli_path: Option<&str>) -> std::path::PathBuf {
    if let Some(p) = cli_path {
        return std::path::PathBuf::from(p);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(bin_dir) = exe.parent() {
            let workspace = bin_dir.parent().and_then(|p| p.parent());
            if let Some(ws) = workspace {
                let candidate = ws.join("web/dist");
                if candidate.exists() {
                    return candidate;
                }
            }
        }
    }
    let manifest_dir = std::env!("CARGO_MANIFEST_DIR");
    let workspace_dir = std::path::Path::new(manifest_dir)
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    workspace_dir.join("web/dist")
}

fn auth_file_path_from(cli_override: Option<&str>) -> std::path::PathBuf {
    cli_override
        .map(std::path::PathBuf::from)
        .unwrap_or_else(auth::auth_file_path)
}

/// Either load an existing auth file or generate a fresh token and persist its hash.
/// Returns (hash, freshly_generated_token_if_any).
fn ensure_token(path: &std::path::Path) -> std::io::Result<(String, Option<String>)> {
    if let Some(existing) = auth::load_auth_file(path)? {
        return Ok((existing.token_hash, None));
    }
    let token = auth::generate_token();
    let hash = auth::hash_token(&token);
    let file = auth::AuthFile::new(hash.clone());
    auth::save_auth_file(path, &file)?;
    Ok((hash, Some(token)))
}

fn rotate_token(path: &std::path::Path) -> std::io::Result<String> {
    let token = auth::generate_token();
    let hash = auth::hash_token(&token);
    let mut file = auth::AuthFile::new(hash);
    file.rotated_at = Some(chrono::Utc::now());
    auth::save_auth_file(path, &file)?;
    Ok(token)
}

fn print_login_url(bind: &str, token: &str) {
    println!();
    println!("Open this URL in your browser to sign in:");
    println!("  {}/login#token={}", bind.trim_end_matches('/'), token);
    println!();
    println!("(Token will only be shown once. To get a new one, run: neige-server auth rotate)");
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let cli = Cli::parse();

    // Subcommand handling (no server start)
    if let Some(cmd) = &cli.cmd {
        match cmd {
            Command::Auth { cmd } => match cmd {
                AuthCmd::Rotate => {
                    let path = auth_file_path_from(cli.auth_file.as_deref());
                    match rotate_token(&path) {
                        Ok(token) => {
                            println!("Token rotated. New token:");
                            println!();
                            println!("  {token}");
                            println!();
                            println!("All existing sessions are invalidated.");
                        }
                        Err(e) => {
                            eprintln!("Failed to rotate token: {e}");
                            std::process::exit(1);
                        }
                    }
                    return;
                }
                AuthCmd::PrintUrl { bind } => {
                    eprintln!(
                        "Note: plaintext tokens are not stored. To obtain a fresh login URL, run:"
                    );
                    eprintln!("  neige-server auth rotate");
                    eprintln!("then format the URL as: {bind}/login#token=<TOKEN>");
                    std::process::exit(2);
                }
            },
        }
    }

    // Safety: disallow publicly binding with auth off.
    if cli.no_auth && cli.listen != "127.0.0.1" && cli.listen != "::1" && cli.listen != "localhost"
    {
        eprintln!(
            "Refusing to start: --no-auth requires --listen 127.0.0.1 (got: {})",
            cli.listen
        );
        std::process::exit(1);
    }
    if cli.no_auth {
        eprintln!("WARNING: auth is DISABLED (--no-auth). Use only for local development.");
    }

    let project_cwd = std::env::current_dir()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Initialize auth state
    let auth_cfg = if cli.no_auth {
        auth::AuthConfig {
            sessions: Arc::new(auth::SessionStore::new()),
            rate_limiter: Arc::new(auth::LoginRateLimiter::new()),
            token_hash: None,
            allowed_origins: cli.allowed_origins.clone(),
        }
    } else {
        let path = auth_file_path_from(cli.auth_file.as_deref());
        let (hash, fresh_token) = match ensure_token(&path) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("Failed to initialize auth: {e}");
                std::process::exit(1);
            }
        };
        if let Some(tok) = fresh_token {
            let bind = if cli.listen == "0.0.0.0" {
                format!("http://127.0.0.1:{}", cli.port)
            } else {
                format!("http://{}:{}", cli.listen, cli.port)
            };
            print_login_url(&bind, &tok);
        } else {
            println!();
            println!(
                "Auth file loaded from {}. Token already exists (only the hash is stored).",
                path.display()
            );
            println!("If you lost the token, run: neige-server auth rotate");
            println!();
        }
        auth::AuthConfig {
            sessions: Arc::new(auth::SessionStore::new()),
            rate_limiter: Arc::new(auth::LoginRateLimiter::new()),
            token_hash: Some(hash),
            allowed_origins: cli.allowed_origins.clone(),
        }
    };

    let state = api::AppState {
        manager: conversation::new_shared_manager(&project_cwd),
        auth: auth_cfg.clone(),
    };

    let static_dir = resolve_static_dir(cli.static_dir.as_deref());

    // All routes share AppState; AuthConfig is extracted via FromRef<AppState>.
    let public: Router<api::AppState> = Router::new()
        .route("/login", get(auth::routes::login_page))
        .route("/login/submit", post(auth::routes::login_submit))
        .route("/api/auth/logout", post(auth::routes::logout))
        .route("/api/auth/whoami", get(auth::routes::whoami));

    let app = Router::new()
        .merge(public)
        .merge(api::router())
        .fallback_service(ServeDir::new(&static_dir))
        .layer(axum::middleware::from_fn_with_state(
            auth_cfg.clone(),
            auth::auth_middleware,
        ))
        .layer(axum::middleware::from_fn_with_state(
            auth_cfg.clone(),
            auth::origin_check_middleware,
        ))
        .with_state(state);

    let addr = format!("{}:{}", cli.listen, cli.port);
    println!("neige listening on http://{}", addr);
    println!("project dir: {project_cwd}");
    println!("static dir: {}", static_dir.display());
    if cli.listen == "0.0.0.0" {
        eprintln!(
            "WARNING: listening on 0.0.0.0 — anyone who can reach this port can attempt login."
        );
    }

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .unwrap();
}
