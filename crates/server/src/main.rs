use s2gold_server::{Settings, build_router};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() {
    let settings = Settings::from_env();
    let router = build_router(&settings)
        .await
        .unwrap_or_else(|err| panic!("failed to open {}: {err}", settings.db_path.display()));
    let listener = TcpListener::bind((settings.host.as_str(), settings.port))
        .await
        .unwrap_or_else(|err| panic!("failed to bind {}:{}: {err}", settings.host, settings.port));
    println!(
        "s2gold-server listening on http://{}",
        listener.local_addr().expect("listener has a local address")
    );
    axum::serve(listener, router)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .expect("server error");
}
