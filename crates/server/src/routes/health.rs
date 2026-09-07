//! Liveness probe and the converted-assets status used by the first-run screen.

use axum::Json;
use axum::extract::State;
use serde_json::{Value, json};

use super::AppState;

pub async fn health_check() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}

/// Whether the converted asset tree is installed (its manifest exists) and
/// where the server expects it. The frontend degrades to a setup screen on
/// `installed: false`; the desktop shell fills the directory from the user's
/// own GOG installer.
pub async fn assets_status(State(state): State<AppState>) -> Json<Value> {
    let installed = state.assets_dir.join("manifest.json").is_file();
    Json(json!({
        "installed": installed,
        "assets_dir": state.assets_dir.to_string_lossy(),
    }))
}
