//! Router assembly: /health, the /api endpoints, and static serving of the
//! built frontend (clean URLs included) plus the converted game assets.

pub mod health;
pub mod saves;
pub mod sessions;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::routing::get;
use tower_http::services::{ServeDir, ServeFile};

use crate::settings::Settings;
use crate::store::{Db, StoreError};

#[derive(Clone)]
pub struct AppState {
    pub db: Db,
}

/// Build the application router. Opens (creating if needed) the database and,
/// on first creation, imports the legacy JSON saves/sessions.
pub async fn build_router(settings: &Settings) -> Result<Router, StoreError> {
    let db = Db::open(
        &settings.db_path,
        &settings.legacy_saves_dir,
        &settings.legacy_sessions_dir,
    )
    .await?;
    let state = AppState { db };

    let mut router = Router::new()
        .route("/health", get(health::health_check))
        .route("/api/saves", get(saves::list_saves))
        .route(
            "/api/saves/{save_id}",
            get(saves::get_save)
                .put(saves::put_save)
                .delete(saves::delete_save),
        )
        .route(
            "/api/sessions",
            get(sessions::list_sessions).post(sessions::create_session),
        )
        .route(
            "/api/sessions/{session_id}",
            get(sessions::get_session)
                .put(sessions::put_session)
                .delete(sessions::delete_session),
        )
        .layer(DefaultBodyLimit::max(settings.max_save_bytes))
        .with_state(state);

    // Converted game assets live outside dist so a frontend rebuild never has to
    // copy 75 MB; mount them explicitly, then the built app as the catch-all.
    if settings.assets_dir.is_dir() {
        router = router.nest_service("/assets", ServeDir::new(&settings.assets_dir));
    }
    if settings.frontend_dist.is_dir() {
        let dist = &settings.frontend_dist;
        let game = ServeFile::new(dist.join("game.html"));
        let index = ServeFile::new(dist.join("index.html"));

        // Clean URLs (mirrored by the Vite dev middleware): /play[/<map>] and the
        // refreshable /game/<map>/<session-id> serve the game shell; every
        // segment is resolved client-side.
        for path in [
            "/play",
            "/play/{map_name}",
            "/game",
            "/game/{map_name}",
            "/game/{map_name}/{session_id}",
        ] {
            router = router.route_service(path, game.clone());
        }
        router = router.route_service("/inspector", ServeFile::new(dist.join("inspector.html")));
        // The menu is a single Vite entry that routes on pathname.
        for path in [
            "/setup",
            "/options",
            "/credits",
            "/campaign",
            "/campaign/{chapter}",
        ] {
            router = router.route_service(path, index.clone());
        }
        router =
            router.fallback_service(ServeDir::new(dist).append_index_html_on_directories(true));
    }
    Ok(router)
}
