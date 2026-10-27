//! Настройки: разделитель адреса места (D-06). Читать может любой вошедший, менять — администратор.

use axum::{Json, Router, extract::State, routing::get};
use serde::{Deserialize, Serialize};
use serde_json::json;
use skladno_core::{
    AppError, AppResult, Db, audit,
    auth::{self, Role},
    settings::{ALLOWED_SEPARATORS, address_separator},
};
use uuid::Uuid;

pub fn router() -> Router<Db> {
    Router::new().route("/settings", get(get_settings).put(update_settings))
}

#[derive(Serialize)]
struct Settings {
    address_separator: String,
    allowed_separators: [&'static str; 5],
}

async fn get_settings(State(db): State<Db>) -> AppResult<Json<Settings>> {
    Ok(Json(Settings {
        address_separator: address_separator(&db).await?,
        allowed_separators: ALLOWED_SEPARATORS,
    }))
}

#[derive(Deserialize)]
struct SettingsInput {
    address_separator: String,
}

async fn update_settings(State(db): State<Db>, Json(input): Json<SettingsInput>) -> AppResult<Json<Settings>> {
    auth::require(Role::Admin, "Изменение настроек")?;
    let separator = input.address_separator.trim().to_string();
    if !ALLOWED_SEPARATORS.contains(&separator.as_str()) {
        return Err(AppError::Validation(format!(
            "Разделитель адреса: один из {}",
            ALLOWED_SEPARATORS.join(" ")
        )));
    }
    let mut tx = db.begin().await?;
    let old = address_separator(&mut *tx).await?;
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ('address_separator', $1) \
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(&separator)
    .execute(&mut *tx)
    .await?;
    if old != separator {
        audit::record(
            &mut *tx,
            "settings",
            Uuid::nil(),
            "update",
            json!({ "address_separator": { "old": old, "new": separator } }),
        )
        .await?;
    }
    tx.commit().await?;
    get_settings(State(db)).await
}
