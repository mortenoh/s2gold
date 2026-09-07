//! Desktop shell: binds the s2gold server to a random localhost port inside
//! the Tauri process and points the webview at it. The frontend is byte-for-byte
//! the same app the browser version serves; there is no IPC surface.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;

use s2gold_server::{Settings, build_router, serve};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Toggle native window fullscreen. Invoked by the frontend's F key; the HTML
/// Fullscreen API is not available in WKWebView here, so the desktop uses the
/// window itself (same effect as the traffic-light zoom button).
#[tauri::command]
fn toggle_fullscreen(window: tauri::WebviewWindow) {
    let fullscreen = window.is_fullscreen().unwrap_or(false);
    let _ = window.set_fullscreen(!fullscreen);
}

/// Quit the app. Invoked by the frontend's Q key.
#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

fn app_data_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("app data directory is available")
}

/// Desktop defaults. The frontend is compiled into the binary (server feature
/// `embed-frontend`) and the converted asset tree rides inside the bundle as a
/// Tauri resource (`Contents/Resources/assets` on macOS, from
/// `packages/app/public/assets` at build time), so the built app is
/// self-contained. This is a personal, local-only build: the assets are
/// converted from the user's own game data first (`make install`) and the
/// bundle is never published. Saves live in the per-user app data directory.
/// Resolution order for the assets: the bundle resource, then the repo's
/// converted tree (dev builds from a checkout), then `<app_data>/assets` for a
/// manually placed copy. S2GOLD_* env vars override any field.
fn desktop_settings(app: &tauri::AppHandle) -> Settings {
    let app_data = app_data_dir(app);
    let has_manifest = |dir: &PathBuf| dir.join("manifest.json").is_file();
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join("assets"));
    }
    candidates.push(PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/app/public/assets"
    )));
    candidates.push(app_data.join("assets"));
    let assets_dir = candidates
        .iter()
        .find(|dir| has_manifest(dir))
        .cloned()
        .unwrap_or_else(|| candidates[0].clone());
    Settings {
        host: "127.0.0.1".to_string(),
        port: 0,
        assets_dir,
        frontend_dist: PathBuf::new(),
        embedded_frontend: true,
        db_path: app_data.join("s2gold.db"),
        legacy_saves_dir: app_data.join("legacy/saves"),
        legacy_sessions_dir: app_data.join("legacy/sessions"),
        max_save_bytes: 32 * 1024 * 1024,
    }
    .with_env_overrides()
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![toggle_fullscreen, quit])
        .setup(|app| {
            let settings = desktop_settings(app.handle());
            let listener = tauri::async_runtime::block_on(tokio::net::TcpListener::bind((
                settings.host.as_str(),
                settings.port,
            )))?;
            let port = listener.local_addr()?.port();
            let router = tauri::async_runtime::block_on(build_router(&settings))?;
            tauri::async_runtime::spawn(async move {
                if let Err(err) = serve(listener, router).await {
                    eprintln!("server error: {err}");
                }
            });
            // Start path override for debugging (e.g. /play/<map> to land
            // straight in the game).
            let start_path = std::env::var("S2GOLD_START_PATH").unwrap_or_else(|_| "/".to_string());
            let url = format!("http://127.0.0.1:{port}{start_path}")
                .parse()
                .expect("localhost URL is valid");
            println!("s2gold-desktop serving on {url}");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("The Settlers II Gold")
                .inner_size(1280.0, 800.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
