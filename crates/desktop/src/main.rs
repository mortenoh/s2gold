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

/// Desktop defaults: the database lives in the per-user app data directory;
/// the frontend dist, converted assets, and one-time legacy migration sources
/// come from the repo this binary was built in (personal-use app — the 75 MB
/// git-ignored asset tree is not bundled). S2GOLD_* env vars override any field.
fn desktop_settings(app: &tauri::AppHandle) -> Settings {
    let repo_root = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
    let app_data = app
        .path()
        .app_data_dir()
        .expect("app data directory is available");
    Settings {
        host: "127.0.0.1".to_string(),
        port: 0,
        assets_dir: repo_root.join("packages/app/public/assets"),
        frontend_dist: repo_root.join("packages/app/dist"),
        db_path: app_data.join("s2gold.db"),
        legacy_saves_dir: repo_root.join("saves"),
        legacy_sessions_dir: repo_root.join("sessions"),
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
