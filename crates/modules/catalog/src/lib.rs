//! F-01. Реестр устройств и характеристик: связки «Производитель + Модель».

mod dimensions;

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post, put},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use skladno_core::{AppError, AppResult, Db, audit, text};
use uuid::Uuid;

pub use dimensions::format_dimensions;

const SELECT: &str = "SELECT id, manufacturer, model, hashrate_ths, power_w, dimensions_mm, weight_kg, archived FROM device_models";

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct DeviceModel {
    pub id: Uuid,
    pub manufacturer: String,
    pub model: String,
    pub hashrate_ths: Option<f64>,
    pub power_w: Option<i32>,
    pub dimensions_mm: Option<String>,
    pub weight_kg: Option<String>,
    pub archived: bool,
}

#[derive(Debug, Deserialize)]
pub struct DeviceModelInput {
    pub manufacturer: String,
    pub model: String,
    pub hashrate_ths: Option<f64>,
    pub power_w: Option<i32>,
    pub dimensions_mm: Option<String>,
    pub weight_kg: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    q: Option<String>,
    #[serde(default)]
    archived: bool,
}

pub fn router() -> Router<Db> {
    Router::new()
        .route("/devices", get(list).post(create))
        .route("/devices/manufacturers", get(manufacturers))
        .route("/devices/{id}", put(update))
        .route("/devices/{id}/archive", post(archive))
        .route("/devices/{id}/restore", post(restore))
}

fn validate(input: DeviceModelInput) -> AppResult<DeviceModelInput> {
    let manufacturer = input.manufacturer.trim().to_string();
    let model = input.model.trim().to_string();
    if manufacturer.is_empty() {
        return Err(AppError::Validation("Укажите производителя".into()));
    }
    if model.is_empty() {
        return Err(AppError::Validation("Укажите модель".into()));
    }
    if input
        .hashrate_ths
        .is_some_and(|v| !v.is_finite() || v < 0.0)
    {
        return Err(AppError::Validation(
            "Хешрейт должен быть неотрицательным числом".into(),
        ));
    }
    if input.power_w.is_some_and(|v| v < 0) {
        return Err(AppError::Validation(
            "Энергопотребление не может быть отрицательным".into(),
        ));
    }
    let dimensions_mm =
        format_dimensions(input.dimensions_mm.as_deref()).map_err(AppError::Validation)?;
    Ok(DeviceModelInput {
        manufacturer,
        model,
        hashrate_ths: input.hashrate_ths,
        power_w: input.power_w,
        dimensions_mm,
        weight_kg: text::clean(input.weight_kg),
    })
}

fn duplicate_message(input: &DeviceModelInput) -> String {
    format!(
        "Модель «{}» производителя «{}» уже есть в реестре",
        input.model, input.manufacturer
    )
}

async fn list(
    State(db): State<Db>,
    Query(query): Query<ListQuery>,
) -> AppResult<Json<Vec<DeviceModel>>> {
    let rows = sqlx::query_as::<_, DeviceModel>(&format!(
        "{SELECT} WHERE archived = $1 AND ($2::text IS NULL OR manufacturer ILIKE $2 OR model ILIKE $2) \
         ORDER BY lower(manufacturer), lower(model)"
    ))
    .bind(query.archived)
    .bind(text::like_pattern(query.q.as_deref()))
    .fetch_all(&db)
    .await?;
    Ok(Json(rows))
}

async fn manufacturers(State(db): State<Db>) -> AppResult<Json<Vec<String>>> {
    let rows = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT ON (lower(manufacturer)) manufacturer FROM device_models ORDER BY lower(manufacturer)",
    )
    .fetch_all(&db)
    .await?;
    Ok(Json(rows))
}

async fn create(
    State(db): State<Db>,
    Json(input): Json<DeviceModelInput>,
) -> AppResult<(StatusCode, Json<DeviceModel>)> {
    let input = validate(input)?;
    let mut tx = db.begin().await?;
    let row = sqlx::query_as::<_, DeviceModel>(
        "INSERT INTO device_models (manufacturer, model, hashrate_ths, power_w, dimensions_mm, weight_kg) \
         VALUES ($1, $2, $3, $4, $5, $6) \
         RETURNING id, manufacturer, model, hashrate_ths, power_w, dimensions_mm, weight_kg, archived",
    )
    .bind(&input.manufacturer)
    .bind(&input.model)
    .bind(input.hashrate_ths)
    .bind(input.power_w)
    .bind(&input.dimensions_mm)
    .bind(&input.weight_kg)
    .fetch_one(&mut *tx)
    .await
    .map_err(AppError::unique_as(duplicate_message(&input)))?;
    audit::record(&mut *tx, "device_model", row.id, "create", json!(row)).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(row)))
}

async fn update(
    State(db): State<Db>,
    Path(id): Path<Uuid>,
    Json(input): Json<DeviceModelInput>,
) -> AppResult<Json<DeviceModel>> {
    let input = validate(input)?;
    let mut tx = db.begin().await?;
    let before = fetch_for_update(&mut tx, id).await?;
    let row = sqlx::query_as::<_, DeviceModel>(
        "UPDATE device_models SET manufacturer = $2, model = $3, hashrate_ths = $4, power_w = $5, \
         dimensions_mm = $6, weight_kg = $7, updated_at = now() WHERE id = $1 \
         RETURNING id, manufacturer, model, hashrate_ths, power_w, dimensions_mm, weight_kg, archived",
    )
    .bind(id)
    .bind(&input.manufacturer)
    .bind(&input.model)
    .bind(input.hashrate_ths)
    .bind(input.power_w)
    .bind(&input.dimensions_mm)
    .bind(&input.weight_kg)
    .fetch_one(&mut *tx)
    .await
    .map_err(AppError::unique_as(duplicate_message(&input)))?;
    audit::record(
        &mut *tx,
        "device_model",
        id,
        "update",
        audit::diff(&before, &row),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

async fn archive(State(db): State<Db>, Path(id): Path<Uuid>) -> AppResult<Json<DeviceModel>> {
    set_archived(db, id, true).await
}

async fn restore(State(db): State<Db>, Path(id): Path<Uuid>) -> AppResult<Json<DeviceModel>> {
    set_archived(db, id, false).await
}

async fn set_archived(db: Db, id: Uuid, archived: bool) -> AppResult<Json<DeviceModel>> {
    let mut tx = db.begin().await?;
    let before = fetch_for_update(&mut tx, id).await?;
    let row = sqlx::query_as::<_, DeviceModel>(
        "UPDATE device_models SET archived = $2, updated_at = now() WHERE id = $1 \
         RETURNING id, manufacturer, model, hashrate_ths, power_w, dimensions_mm, weight_kg, archived",
    )
    .bind(id)
    .bind(archived)
    .fetch_one(&mut *tx)
    .await?;
    let action = if archived { "archive" } else { "restore" };
    audit::record(
        &mut *tx,
        "device_model",
        id,
        action,
        audit::diff(&before, &row),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

async fn fetch_for_update(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    id: Uuid,
) -> AppResult<DeviceModel> {
    sqlx::query_as::<_, DeviceModel>(&format!("{SELECT} WHERE id = $1 FOR UPDATE"))
        .bind(id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| AppError::NotFound("Модель не найдена".into()))
}

/// Импорт одной модели (по тем же правилам, что ручной ввод): true — создана, false — такая уже есть.
pub async fn import_one(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    input: DeviceModelInput,
) -> AppResult<bool> {
    let input = validate(input)?;
    let row = sqlx::query_as::<_, DeviceModel>(
        "INSERT INTO device_models (manufacturer, model, hashrate_ths, power_w, dimensions_mm, weight_kg) \
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING \
         RETURNING id, manufacturer, model, hashrate_ths, power_w, dimensions_mm, weight_kg, archived",
    )
    .bind(&input.manufacturer)
    .bind(&input.model)
    .bind(input.hashrate_ths)
    .bind(input.power_w)
    .bind(&input.dimensions_mm)
    .bind(&input.weight_kg)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(row) = row else { return Ok(false) };
    audit::record(&mut **tx, "device_model", row.id, "import", json!(row)).await?;
    Ok(true)
}
