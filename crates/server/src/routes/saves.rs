//! Save-game CRUD endpoints backed by the database.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;

use crate::error::ApiError;
use crate::models::{SaveGame, SaveMeta, SavePayload, valid_id};
use crate::routes::AppState;

pub(crate) fn check_id(id: &str) -> Result<(), ApiError> {
    if valid_id(id) {
        Ok(())
    } else {
        Err(ApiError::unprocessable(format!("invalid id '{id}'")))
    }
}

/// List all saves, newest first.
pub async fn list_saves(State(state): State<AppState>) -> Result<Json<Vec<SaveMeta>>, ApiError> {
    Ok(Json(state.db.saves_list().await?))
}

/// Fetch one save including its engine state.
pub async fn get_save(
    State(state): State<AppState>,
    Path(save_id): Path<String>,
) -> Result<Json<SaveGame>, ApiError> {
    check_id(&save_id)?;
    match state.db.saves_get(&save_id).await? {
        Some(save) => Ok(Json(save)),
        None => Err(ApiError::not_found("save", &save_id)),
    }
}

/// Create or overwrite a save.
pub async fn put_save(
    State(state): State<AppState>,
    Path(save_id): Path<String>,
    Json(payload): Json<SavePayload>,
) -> Result<Json<SaveGame>, ApiError> {
    check_id(&save_id)?;
    if payload.name.trim().is_empty() {
        return Err(ApiError::unprocessable("name must not be blank"));
    }
    Ok(Json(state.db.saves_put(&save_id, payload).await?))
}

/// Delete a save.
pub async fn delete_save(
    State(state): State<AppState>,
    Path(save_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    check_id(&save_id)?;
    if state.db.saves_delete(&save_id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::not_found("save", &save_id))
    }
}
