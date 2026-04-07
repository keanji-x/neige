mod api;
mod conversation;
mod tmux;
mod tunnel;

use tower_http::services::ServeDir;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let project_cwd = std::env::current_dir()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let state = api::AppState {
        manager: conversation::new_shared_manager(&project_cwd),
        tunnel: tunnel::new_shared_tunnel(),
    };

    let manifest_dir = std::env!("CARGO_MANIFEST_DIR");
    let workspace_dir = std::path::Path::new(manifest_dir)
        .parent().unwrap()
        .parent().unwrap();
    let static_dir = workspace_dir.join("web/dist");
    let app = api::router(state).fallback_service(ServeDir::new(&static_dir));

    let addr = "0.0.0.0:3030";
    println!("neige listening on http://localhost:3030");
    println!("project dir: {project_cwd}");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
