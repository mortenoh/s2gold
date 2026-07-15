//! API error type. All error responses carry a `{"detail": ...}` body, matching
//! the FastAPI server this replaces.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub detail: String,
}

impl ApiError {
    pub fn not_found(kind: &str, id: &str) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            detail: format!("{kind} '{id}' not found"),
        }
    }

    pub fn unprocessable(detail: impl Into<String>) -> Self {
        Self {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            detail: detail.into(),
        }
    }

    pub(crate) fn internal(detail: String) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            detail,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "detail": self.detail }))).into_response()
    }
}

impl From<turso::Error> for ApiError {
    fn from(err: turso::Error) -> Self {
        Self::internal(format!("database error: {err}"))
    }
}

impl From<serde_json::Error> for ApiError {
    fn from(err: serde_json::Error) -> Self {
        Self::internal(format!("stored record is not valid JSON: {err}"))
    }
}
