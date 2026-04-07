mod api;
mod conversation;
mod tmux;

use tower_http::services::ServeDir;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let manager = conversation::new_shared_manager();

    let manifest_dir = std::env!("CARGO_MANIFEST_DIR");
    let static_dir = format!("{manifest_dir}/web/dist");
    let app = api::router(manager).fallback_service(ServeDir::new(&static_dir));

    let addr = "0.0.0.0:3030";
    println!("neige listening on http://localhost:3030");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
