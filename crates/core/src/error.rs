use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    Conflict(String),
    #[error("Требуется вход")]
    Unauthorized,
    #[error("{0}")]
    Forbidden(String),
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
}

impl AppError {
    /// Превращает нарушение уникальности в понятный конфликт, остальные ошибки БД оставляет как есть.
    pub fn unique_as(message: impl Into<String>) -> impl FnOnce(sqlx::Error) -> AppError {
        let message = message.into();
        move |error| {
            if let sqlx::Error::Database(db) = &error
                && db.is_unique_violation()
            {
                AppError::Conflict(message)
            } else {
                AppError::Db(error)
            }
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message) = match &self {
            AppError::NotFound(m) => (StatusCode::NOT_FOUND, "not_found", m.clone()),
            AppError::Validation(m) => (StatusCode::UNPROCESSABLE_ENTITY, "validation", m.clone()),
            AppError::Conflict(m) => (StatusCode::CONFLICT, "conflict", m.clone()),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized", self.to_string()),
            AppError::Forbidden(m) => (StatusCode::FORBIDDEN, "forbidden", m.clone()),
            AppError::Db(e) => {
                tracing::error!(error = %e, "database error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal",
                    "Внутренняя ошибка сервера".to_string(),
                )
            }
        };
        (status, Json(json!({ "error": code, "message": message }))).into_response()
    }
}
