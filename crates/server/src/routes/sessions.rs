//! Game-session CRUD endpoints backed by the database.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;

use crate::error::ApiError;
use crate::models::{SessionCreate, SessionMeta, SessionRecord, SessionSnapshot};
use crate::routes::AppState;
use crate::routes::saves::check_id;

/// Create a new server-side game session.
pub async fn create_session(
    State(state): State<AppState>,
    Json(payload): Json<SessionCreate>,
) -> Result<Json<SessionRecord>, ApiError> {
    Ok(Json(state.db.sessions_create(payload).await?))
}

/// List all sessions, newest first.
pub async fn list_sessions(
    State(state): State<AppState>,
) -> Result<Json<Vec<SessionMeta>>, ApiError> {
    Ok(Json(state.db.sessions_list().await?))
}

/// Fetch one session including its serialized world.
pub async fn get_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<Json<SessionRecord>, ApiError> {
    check_id(&session_id)?;
    match state.db.sessions_get(&session_id).await? {
        Some(session) => Ok(Json(session)),
        None => Err(ApiError::not_found("session", &session_id)),
    }
}

/// Apply a world snapshot to an existing session.
pub async fn put_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(snap): Json<SessionSnapshot>,
) -> Result<Json<SessionRecord>, ApiError> {
    check_id(&session_id)?;
    match state.db.sessions_snapshot(&session_id, snap).await? {
        Some(session) => Ok(Json(session)),
        None => Err(ApiError::not_found("session", &session_id)),
    }
}

/// Delete a session.
pub async fn delete_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    check_id(&session_id)?;
    if state.db.sessions_delete(&session_id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::not_found("session", &session_id))
    }
}
