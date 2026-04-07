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

    let manifest_dir = std::env!("CARGO_MANIFEST_DIR");
    let workspace_dir = std::path::Path::new(manifest_dir)
        .parent().unwrap()
        .parent().unwrap();
    let static_dir = workspace_dir.join("web/dist");
    let app = api::router(state).fallback_service(ServeDir::new(&static_dir));

    let addr = format!("0.0.0.0:{}", cli.port);
    println!("neige listening on http://localhost:{}", cli.port);
    println!("project dir: {project_cwd}");

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
