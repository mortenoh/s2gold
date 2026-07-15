//! Integration tests for the server: health, save/session CRUD, and the
//! one-time migration of legacy JSON records. Port of the previous FastAPI
//! test suite (tests/test_server.py), with the on-disk-format assertions
//! recast as migration tests.

use std::fs;
use std::path::PathBuf;

use axum_test::TestServer;
use s2gold_server::{Settings, build_router};
use serde_json::{Value, json};
use tempfile::TempDir;

struct Ctx {
    server: TestServer,
    dir: TempDir,
}

impl Ctx {
    fn settings(&self, max_save_bytes: usize) -> Settings {
        settings_for(self.dir.path().into(), max_save_bytes)
    }
}

fn settings_for(root: PathBuf, max_save_bytes: usize) -> Settings {
    Settings {
        host: "127.0.0.1".to_string(),
        port: 0,
        assets_dir: root.join("missing-assets"),
        frontend_dist: root.join("missing-dist"),
        db_path: root.join("s2gold.db"),
        legacy_saves_dir: root.join("saves"),
        legacy_sessions_dir: root.join("sessions"),
        max_save_bytes,
    }
}

/// Fresh server over a fresh tempdir. `prepare` may seed legacy JSON files
/// (under `saves/` / `sessions/` in the tempdir) before the database is created.
async fn ctx_with(max_save_bytes: usize, prepare: impl FnOnce(&std::path::Path)) -> Ctx {
    let dir = TempDir::new().expect("create tempdir");
    prepare(dir.path());
    let settings = settings_for(dir.path().into(), max_save_bytes);
    let router = build_router(&settings).await.expect("build router");
    let server = TestServer::new(router);
    Ctx { server, dir }
}

async fn ctx() -> Ctx {
    ctx_with(32 * 1024 * 1024, |_| {}).await
}

fn write_legacy(root: &std::path::Path, kind: &str, name: &str, content: &str) {
    let dir = root.join(kind);
    fs::create_dir_all(&dir).expect("create legacy dir");
    fs::write(dir.join(name), content).expect("write legacy file");
}

#[tokio::test]
async fn health_check() {
    let ctx = ctx().await;
    let res = ctx.server.get("/health").await;
    assert_eq!(res.status_code(), 200);
    assert_eq!(res.json::<Value>(), json!({"status": "ok"}));
}

#[tokio::test]
async fn saves_crud_roundtrip() {
    let ctx = ctx().await;
    assert_eq!(
        ctx.server.get("/api/saves").await.json::<Value>(),
        json!([])
    );

    let payload = json!({
        "name": "First game", "map": "maps_miss200", "tick": 1234,
        "data": {"world": [1, 2, 3]}
    });
    let created = ctx.server.put("/api/saves/first-game").json(&payload).await;
    assert_eq!(created.status_code(), 200);
    let body: Value = created.json();
    assert_eq!(body["id"], "first-game");
    assert_eq!(body["tick"], 1234);
    assert_eq!(body["created_at"], body["updated_at"]);

    let listed: Value = ctx.server.get("/api/saves").await.json();
    let listed = listed.as_array().expect("list is an array");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0]["id"], "first-game");
    assert!(
        listed[0].get("data").is_none(),
        "list responses must omit the data key entirely"
    );

    let fetched: Value = ctx.server.get("/api/saves/first-game").await.json();
    assert_eq!(fetched["data"], json!({"world": [1, 2, 3]}));

    // Timestamps have microsecond precision; make the overwrite distinguishable.
    std::thread::sleep(std::time::Duration::from_millis(2));
    let mut updated_payload = payload.clone();
    updated_payload["tick"] = json!(9999);
    let updated: Value = ctx
        .server
        .put("/api/saves/first-game")
        .json(&updated_payload)
        .await
        .json();
    assert_eq!(updated["tick"], 9999);
    assert_eq!(updated["created_at"], body["created_at"]);
    assert_ne!(updated["updated_at"], body["updated_at"]);

    assert_eq!(
        ctx.server
            .delete("/api/saves/first-game")
            .await
            .status_code(),
        204
    );
    assert_eq!(
        ctx.server.get("/api/saves/first-game").await.status_code(),
        404
    );
    assert_eq!(
        ctx.server
            .delete("/api/saves/first-game")
            .await
            .status_code(),
        404
    );
}

#[tokio::test]
async fn save_id_validation() {
    let ctx = ctx().await;
    let payload = json!({"name": "x", "map": "m", "data": {}});
    // The encoded forms arrive raw and are decoded to ".."/"../etc/passwd" by
    // routing, genuinely exercising the id pattern check (guards traversal).
    for bad in ["%2e%2e", "%2e%2e%2fetc%2fpasswd", "UPPER", "a%20b"] {
        let status = ctx
            .server
            .put(&format!("/api/saves/{bad}"))
            .json(&payload)
            .await
            .status_code()
            .as_u16();
        assert!(matches!(status, 404 | 422), "{bad}: got {status}");
    }
}

#[tokio::test]
async fn oversized_save_rejected() {
    let ctx = ctx_with(1024, |_| {}).await;
    let big = json!({"name": "big", "map": "m", "data": {"blob": "x".repeat(4096)}});
    let res = ctx.server.put("/api/saves/big-save").json(&big).await;
    assert_eq!(res.status_code(), 413);
    // Within the limit still works.
    let small = json!({"name": "s", "map": "m", "data": {}});
    let res = ctx.server.put("/api/saves/small-save").json(&small).await;
    assert_eq!(res.status_code(), 200);
}

#[tokio::test]
async fn blank_name_rejected() {
    let ctx = ctx().await;
    let res = ctx
        .server
        .put("/api/saves/ok-id")
        .json(&json!({"name": "   ", "map": "m", "data": {}}))
        .await;
    assert_eq!(res.status_code(), 422);
}

#[tokio::test]
async fn sessions_crud_roundtrip() {
    let ctx = ctx().await;
    assert_eq!(
        ctx.server.get("/api/sessions").await.json::<Value>(),
        json!([])
    );

    let created = ctx
        .server
        .post("/api/sessions")
        .json(&json!({
            "map": "maps_miss200", "ai": [2, 3],
            "nations": ["rom", "rom", "vik"], "campaign": 5
        }))
        .await;
    assert_eq!(created.status_code(), 200);
    let body: Value = created.json();
    let session_id = body["id"].as_str().expect("id is a string").to_string();
    assert!(!session_id.is_empty());
    assert_eq!(body["map"], "maps_miss200");
    assert_eq!(body["ai"], json!([2, 3]));
    assert_eq!(body["nations"], json!(["rom", "rom", "vik"]));
    assert_eq!(body["campaign"], 5);
    assert_eq!(body["tick"], 0);
    assert_eq!(body["data"], Value::Null);
    assert_eq!(body["created_at"], body["updated_at"]);

    let fetched: Value = ctx
        .server
        .get(&format!("/api/sessions/{session_id}"))
        .await
        .json();
    assert_eq!(fetched["id"], session_id.as_str());
    assert_eq!(fetched["data"], Value::Null);

    std::thread::sleep(std::time::Duration::from_millis(2));
    let snap = ctx
        .server
        .put(&format!("/api/sessions/{session_id}"))
        .json(&json!({"tick": 42, "data": {"world": [1, 2, 3]}}))
        .await;
    assert_eq!(snap.status_code(), 200);
    let snap: Value = snap.json();
    assert_eq!(snap["tick"], 42);
    assert_eq!(snap["created_at"], body["created_at"]);
    assert_ne!(snap["updated_at"], body["updated_at"]);

    let after: Value = ctx
        .server
        .get(&format!("/api/sessions/{session_id}"))
        .await
        .json();
    assert_eq!(after["tick"], 42);
    assert_eq!(after["data"], json!({"world": [1, 2, 3]}));
    // Snapshot preserves the original session metadata.
    assert_eq!(after["map"], "maps_miss200");
    assert_eq!(after["ai"], json!([2, 3]));
    assert_eq!(after["nations"], json!(["rom", "rom", "vik"]));
    assert_eq!(after["campaign"], 5);

    let listed: Value = ctx.server.get("/api/sessions").await.json();
    let listed = listed.as_array().expect("list is an array");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0]["id"], session_id.as_str());
    assert!(
        listed[0].get("data").is_none(),
        "list responses must omit the data key entirely"
    );

    let path = format!("/api/sessions/{session_id}");
    assert_eq!(ctx.server.delete(&path).await.status_code(), 204);
    assert_eq!(ctx.server.get(&path).await.status_code(), 404);
    assert_eq!(ctx.server.delete(&path).await.status_code(), 404);
}

#[tokio::test]
async fn session_defaults() {
    let ctx = ctx().await;
    let created = ctx
        .server
        .post("/api/sessions")
        .json(&json!({"map": "m"}))
        .await;
    assert_eq!(created.status_code(), 200);
    let body: Value = created.json();
    assert_eq!(body["ai"], json!([]));
    // Nations is optional and defaults to null (an all-Roman game), keeping
    // backward compatibility with clients that predate the field.
    assert_eq!(body["nations"], Value::Null);
    assert_eq!(body["campaign"], Value::Null);
}

#[tokio::test]
async fn session_not_found() {
    let ctx = ctx().await;
    assert_eq!(
        ctx.server.get("/api/sessions/deadbeef").await.status_code(),
        404
    );
    let snap = ctx
        .server
        .put("/api/sessions/deadbeef")
        .json(&json!({"tick": 1, "data": {}}))
        .await;
    assert_eq!(snap.status_code(), 404);
}

#[tokio::test]
async fn oversized_snapshot_rejected() {
    let ctx = ctx_with(1024, |_| {}).await;
    let created: Value = ctx
        .server
        .post("/api/sessions")
        .json(&json!({"map": "m"}))
        .await
        .json();
    let session_id = created["id"].as_str().expect("id is a string");
    let big = json!({"tick": 1, "data": {"blob": "x".repeat(4096)}});
    let res = ctx
        .server
        .put(&format!("/api/sessions/{session_id}"))
        .json(&big)
        .await;
    assert_eq!(res.status_code(), 413);
    // Within the limit still works.
    let small = json!({"tick": 2, "data": {}});
    let res = ctx
        .server
        .put(&format!("/api/sessions/{session_id}"))
        .json(&small)
        .await;
    assert_eq!(res.status_code(), 200);
}

#[tokio::test]
async fn session_id_validation() {
    let ctx = ctx().await;
    for bad in ["%2e%2e", "%2e%2e%2fetc%2fpasswd", "UPPER", "a%20b"] {
        let status = ctx
            .server
            .get(&format!("/api/sessions/{bad}"))
            .await
            .status_code()
            .as_u16();
        assert!(matches!(status, 404 | 422), "{bad}: got {status}");
    }
}

// A pre-nations record: no "nations" key at all.
const LEGACY_SESSION: &str = r#"{"id": "legacy1", "map": "m", "ai": [1], "campaign": null, "tick": 3, "data": null, "created_at": "2020-01-01T00:00:00Z", "updated_at": "2020-01-01T00:00:00Z"}"#;

#[tokio::test]
async fn legacy_session_without_nations_migrates() {
    let ctx = ctx_with(32 * 1024 * 1024, |root| {
        write_legacy(root, "sessions", "legacy1.json", LEGACY_SESSION);
    })
    .await;
    let fetched = ctx.server.get("/api/sessions/legacy1").await;
    assert_eq!(fetched.status_code(), 200);
    let body: Value = fetched.json();
    assert_eq!(body["ai"], json!([1]));
    assert_eq!(body["nations"], Value::Null);
    assert_eq!(body["created_at"], "2020-01-01T00:00:00Z");
}

#[tokio::test]
async fn migration_preserves_pydantic_timestamps_verbatim() {
    // Both shapes pydantic v2 wrote: microsecond fraction with Z, and an
    // explicit +00:00 offset. They must come back byte-exact from the API.
    let with_micros = r#"{"id": "stamp-micros", "name": "a", "map": "m", "tick": 1, "data": {}, "created_at": "2026-07-09T20:00:06.541382Z", "updated_at": "2026-07-09T20:00:06.541382Z"}"#;
    let with_offset = r#"{"id": "stamp-offset", "name": "b", "map": "m", "tick": 2, "data": {}, "created_at": "2026-07-09T20:00:06+00:00", "updated_at": "2026-07-09T20:00:06+00:00"}"#;
    let ctx = ctx_with(32 * 1024 * 1024, |root| {
        write_legacy(root, "saves", "stamp-micros.json", with_micros);
        write_legacy(root, "saves", "stamp-offset.json", with_offset);
    })
    .await;
    let micros: Value = ctx.server.get("/api/saves/stamp-micros").await.json();
    assert_eq!(micros["created_at"], "2026-07-09T20:00:06.541382Z");
    let offset: Value = ctx.server.get("/api/saves/stamp-offset").await.json();
    assert_eq!(offset["created_at"], "2026-07-09T20:00:06+00:00");
}

#[tokio::test]
async fn corrupt_legacy_file_skipped() {
    let ctx = ctx_with(32 * 1024 * 1024, |root| {
        write_legacy(root, "sessions", "good.json", LEGACY_SESSION);
        write_legacy(root, "sessions", "corrupt.json", "{not json");
        write_legacy(root, "saves", "bad-stamp.json", r#"{"id": "bad-stamp", "name": "a", "map": "m", "data": {}, "created_at": "yesterday", "updated_at": "yesterday"}"#);
    })
    .await;
    let sessions: Value = ctx.server.get("/api/sessions").await.json();
    let sessions = sessions.as_array().expect("list is an array");
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0]["id"], "legacy1");
    assert_eq!(
        ctx.server.get("/api/saves").await.json::<Value>(),
        json!([])
    );
}

#[tokio::test]
async fn migration_runs_once_and_leaves_originals_untouched() {
    let ctx = ctx_with(32 * 1024 * 1024, |root| {
        write_legacy(root, "sessions", "legacy1.json", LEGACY_SESSION);
    })
    .await;
    assert_eq!(
        ctx.server
            .delete("/api/sessions/legacy1")
            .await
            .status_code(),
        204
    );

    // The original file is still on disk, byte for byte.
    let original = ctx.dir.path().join("sessions").join("legacy1.json");
    assert_eq!(
        fs::read_to_string(&original).expect("read original"),
        LEGACY_SESSION
    );

    // A second startup on the existing database must not re-import it.
    let settings = ctx.settings(32 * 1024 * 1024);
    let router = build_router(&settings).await.expect("reopen router");
    let server = TestServer::new(router);
    assert_eq!(server.get("/api/sessions").await.json::<Value>(), json!([]));
    assert_eq!(server.get("/api/sessions/legacy1").await.status_code(), 404);
}
