//! Persistence and static-file server for s2gold.
//!
//! Serves the built frontend (packages/app/dist) and the converted game assets
//! (/assets) as static files, plus the /api endpoints (saves, sessions). Game
//! logic runs entirely client-side; this crate owns serving and persistence
//! only. Consumed by the standalone bin and by the Tauri desktop shell, which
//! embeds the same router on a random localhost port.

mod error;
mod models;
mod routes;
mod settings;
mod store;

pub use routes::build_router;
pub use settings::Settings;
pub use store::StoreError;

/// Run the server on an already-bound listener. The caller owns the listener
/// so embedders can bind port 0 and read the actual port back.
pub async fn serve(listener: tokio::net::TcpListener, router: axum::Router) -> std::io::Result<()> {
    axum::serve(listener, router).await
}
