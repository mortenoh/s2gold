//! Frontend compiled into the binary (feature `embed-frontend`).
//!
//! Mirrors the on-disk mount in `routes`: the clean menu/game URLs resolve to
//! their Vite entry pages and every other path is looked up in the embedded
//! `packages/app/dist` tree. Release builds carry the files in the binary;
//! debug builds read them from disk on each request (rust-embed default), so
//! `cargo run` keeps picking up a fresh `pnpm build` without recompiling.

use axum::Router;
use axum::body::Body;
use axum::http::{StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "../../packages/app/dist"]
struct Frontend;

/// Mount the embedded frontend: clean URLs plus the file tree as the fallback.
pub fn mount_frontend(mut router: Router) -> Router {
    for path in [
        "/play",
        "/play/{map_name}",
        "/game",
        "/game/{map_name}",
        "/game/{map_name}/{session_id}",
    ] {
        router = router.route(path, get(|| async { file("game.html") }));
    }
    router = router.route("/inspector", get(|| async { file("inspector.html") }));
    for path in [
        "/setup",
        "/options",
        "/credits",
        "/campaign",
        "/campaign/{chapter}",
    ] {
        router = router.route(path, get(|| async { file("index.html") }));
    }
    router.fallback(get(fallback))
}

async fn fallback(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    if path.is_empty() {
        return file("index.html");
    }
    // Directory-style URLs get their index.html, like ServeDir with
    // append_index_html_on_directories.
    if Frontend::get(path).is_none() && !path.contains('.') {
        let index = format!("{}/index.html", path.trim_end_matches('/'));
        if Frontend::get(&index).is_some() {
            return file(&index);
        }
    }
    file(path)
}

fn file(path: &str) -> Response {
    match Frontend::get(path) {
        Some(content) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            (
                [(header::CONTENT_TYPE, mime.as_ref().to_string())],
                Body::from(content.data.into_owned()),
            )
                .into_response()
        }
        None => (StatusCode::NOT_FOUND, "not found").into_response(),
    }
}
