fn main() {
    // Declare the app commands so tauri-build generates allow-* permissions for
    // them: the webview loads a remote (localhost) URL, and remote origins can
    // only invoke commands explicitly allowed by a capability.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["toggle_fullscreen", "quit"])),
    )
    .expect("failed to run tauri-build");
}
