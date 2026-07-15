//! Server configuration via environment variables (prefix S2GOLD_).

use std::env;
use std::path::PathBuf;

/// Application settings. Defaults are relative to the working directory,
/// matching Makefile-from-repo-root usage; every field has an S2GOLD_* override.
#[derive(Clone, Debug)]
pub struct Settings {
    pub host: String,
    pub port: u16,
    pub assets_dir: PathBuf,
    pub frontend_dist: PathBuf,
    pub db_path: PathBuf,
    /// One-time migration source: pre-database JSON save files.
    pub legacy_saves_dir: PathBuf,
    /// One-time migration source: pre-database JSON session files.
    pub legacy_sessions_dir: PathBuf,
    /// Reject save/snapshot uploads larger than this.
    pub max_save_bytes: usize,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 8000,
            assets_dir: PathBuf::from("packages/app/public/assets"),
            frontend_dist: PathBuf::from("packages/app/dist"),
            db_path: PathBuf::from("s2gold.db"),
            legacy_saves_dir: PathBuf::from("saves"),
            legacy_sessions_dir: PathBuf::from("sessions"),
            max_save_bytes: 32 * 1024 * 1024,
        }
    }
}

impl Settings {
    pub fn from_env() -> Self {
        let mut settings = Self::default();
        if let Ok(v) = env::var("S2GOLD_HOST") {
            settings.host = v;
        }
        if let Ok(v) = env::var("S2GOLD_PORT")
            && let Ok(port) = v.parse()
        {
            settings.port = port;
        }
        if let Ok(v) = env::var("S2GOLD_ASSETS_DIR") {
            settings.assets_dir = PathBuf::from(v);
        }
        if let Ok(v) = env::var("S2GOLD_FRONTEND_DIST") {
            settings.frontend_dist = PathBuf::from(v);
        }
        if let Ok(v) = env::var("S2GOLD_DB_PATH") {
            settings.db_path = PathBuf::from(v);
        }
        if let Ok(v) = env::var("S2GOLD_SAVES_DIR") {
            settings.legacy_saves_dir = PathBuf::from(v);
        }
        if let Ok(v) = env::var("S2GOLD_SESSIONS_DIR") {
            settings.legacy_sessions_dir = PathBuf::from(v);
        }
        if let Ok(v) = env::var("S2GOLD_MAX_SAVE_BYTES")
            && let Ok(max) = v.parse()
        {
            settings.max_save_bytes = max;
        }
        settings
    }
}
