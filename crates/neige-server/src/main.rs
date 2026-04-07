mod api;
mod conversation;
mod pty;

use clap::Parser;
use tower_http::services::ServeDir;

#[derive(Parser)]
#[command(name = "neige-server", about = "Web-based terminal session manager")]
struct Cli {
    /// Port to listen on
    #[arg(short, long, default_value = "3030")]
    port: u16,

    /// Path to web/dist directory (auto-detected if not set)
    #[arg(long)]
    static_dir: Option<String>,
}

/// Resolve the web/dist directory.
/// Priority: --static-dir flag > relative to binary > CARGO_MANIFEST_DIR (dev).
fn resolve_static_dir(cli_path: Option<&str>) -> std::path::PathBuf {
    if let Some(p) = cli_path {
        return std::path::PathBuf::from(p);
    }

    // Relative to binary: binary is at .../target/release/neige-server
    // web/dist is at .../web/dist (3 levels up from binary)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(bin_dir) = exe.parent() {
            // target/release/ -> target/ -> project root
            let workspace = bin_dir.parent().and_then(|p| p.parent());
            if let Some(ws) = workspace {
                let candidate = ws.join("web/dist");
                if candidate.exists() {
                    return candidate;
                }
            }
        }
    }

    // Fallback: compile-time path (works in cargo run during dev)
    let manifest_dir = std::env!("CARGO_MANIFEST_DIR");
    let workspace_dir = std::path::Path::new(manifest_dir)
        .parent().unwrap()
        .parent().unwrap();
    workspace_dir.join("web/dist")
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let cli = Cli::parse();

    let project_cwd = std::env::current_dir()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let state = api::AppState {
        manager: conversation::new_shared_manager(&project_cwd),
    };

    let static_dir = resolve_static_dir(cli.static_dir.as_deref());
    let app = api::router(state).fallback_service(ServeDir::new(&static_dir));

    let addr = format!("0.0.0.0:{}", cli.port);
    println!("neige listening on http://localhost:{}", cli.port);
    println!("project dir: {project_cwd}");
    println!("static dir: {}", static_dir.display());

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
