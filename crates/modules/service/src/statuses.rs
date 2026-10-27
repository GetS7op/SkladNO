//! Статусы устройств: категории, статусы, матрица разрешённых переходов и смена статуса устройства.
//! СА переводит устройство только по матрице; Старший СА может поставить любой статус — это видно в
//! журнале («вне матрицы»).

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post, put},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use skladno_core::{
    AppError, AppResult, Db, audit,
    auth::{self, Role},
    text,
};
use uuid::Uuid;

pub fn router() -> Router<Db> {
    Router::new()
        .route("/statuses", get(overview).post(create_status))
        .route("/statuses/{id}", put(update_status))
        .route("/status-categories", post(create_category))
        .route("/status-categories/{id}", put(update_category))
        .route("/status-transitions", put(save_transitions))
        .route("/inventory/{id}/status", put(set_device_status))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct Category {
    id: Uuid,
    name: String,
    note: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct Status {
    id: Uuid,
    name: String,
    category_id: Option<Uuid>,
    category_name: Option<String>,
    note: Option<String>,
    devices: i64,
}

#[derive(Debug, Serialize)]
pub struct Overview {
    categories: Vec<Category>,
    statuses: Vec<Status>,
    /// Пары «из → в».
    transitions: Vec<(Uuid, Uuid)>,
}

async fn overview(State(db): State<Db>) -> AppResult<Json<Overview>> {
    let categories = sqlx::query_as::<_, Category>(
        "SELECT id, name, note FROM status_categories ORDER BY created_at, name",
    )
    .fetch_all(&db)
    .await?;
    let statuses = sqlx::query_as::<_, Status>(
        "SELECT s.id, s.name, s.category_id, c.name AS category_name, s.note, \
         (SELECT count(*) FROM devices v WHERE v.status_id = s.id) AS devices \
         FROM device_statuses s LEFT JOIN status_categories c ON c.id = s.category_id \
         ORDER BY c.created_at NULLS LAST, s.created_at, s.name",
    )
    .fetch_all(&db)
    .await?;
    let transitions =
        sqlx::query_as::<_, (Uuid, Uuid)>("SELECT from_id, to_id FROM status_transitions")
            .fetch_all(&db)
            .await?;
    Ok(Json(Overview {
        categories,
        statuses,
        transitions,
    }))
}

#[derive(Debug, Deserialize)]
pub struct StatusInput {
    name: String,
    category_id: Option<Uuid>,
    note: Option<String>,
}

fn clean_name(name: String, what: &str) -> AppResult<String> {
    text::clean(Some(name)).ok_or_else(|| AppError::Validation(format!("Укажите название {what}")))
}

async fn create_status(
    State(db): State<Db>,
    Json(input): Json<StatusInput>,
) -> AppResult<(StatusCode, Json<Overview>)> {
    let name = clean_name(input.name, "статуса")?;
    let note = text::clean(input.note);
    let mut tx = db.begin().await?;
    let id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO device_statuses (name, category_id, note) VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(&name)
    .bind(input.category_id)
    .bind(&note)
    .fetch_one(&mut *tx)
    .await
    .map_err(AppError::unique_as(format!("Статус «{name}» уже есть")))?;
    audit::record(
        &mut *tx,
        "status",
        id,
        "create",
        json!({ "name": name, "note": note }),
    )
    .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, overview(State(db)).await?))
}

async fn update_status(
    State(db): State<Db>,
    Path(id): Path<Uuid>,
    Json(input): Json<StatusInput>,
) -> AppResult<Json<Overview>> {
    let name = clean_name(input.name, "статуса")?;
    let note = text::clean(input.note);
    let mut tx = db.begin().await?;
    let before = sqlx::query_as::<_, (String, Option<String>)>(
        "SELECT name, note FROM device_statuses WHERE id = $1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Статус не найден".into()))?;
    sqlx::query("UPDATE device_statuses SET name = $2, category_id = $3, note = $4, updated_at = now() WHERE id = $1")
        .bind(id)
        .bind(&name)
        .bind(input.category_id)
        .bind(&note)
        .execute(&mut *tx)
        .await
        .map_err(AppError::unique_as(format!("Статус «{name}» уже есть")))?;
    audit::record(
        &mut *tx,
        "status",
        id,
        "update",
        audit::diff(
            &json!({ "name": before.0, "note": before.1 }),
            &json!({ "name": name, "note": note }),
        ),
    )
    .await?;
    tx.commit().await?;
    overview(State(db)).await
}

#[derive(Debug, Deserialize)]
pub struct CategoryInput {
    name: String,
    note: Option<String>,
}

async fn create_category(
    State(db): State<Db>,
    Json(input): Json<CategoryInput>,
) -> AppResult<(StatusCode, Json<Overview>)> {
    let name = clean_name(input.name, "категории")?;
    let note = text::clean(input.note);
    let mut tx = db.begin().await?;
    let id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO status_categories (name, note) VALUES ($1, $2) RETURNING id",
    )
    .bind(&name)
    .bind(&note)
    .fetch_one(&mut *tx)
    .await
    .map_err(AppError::unique_as(format!("Категория «{name}» уже есть")))?;
    audit::record(
        &mut *tx,
        "status_category",
        id,
        "create",
        json!({ "name": name }),
    )
    .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, overview(State(db)).await?))
}

async fn update_category(
    State(db): State<Db>,
    Path(id): Path<Uuid>,
    Json(input): Json<CategoryInput>,
) -> AppResult<Json<Overview>> {
    let name = clean_name(input.name, "категории")?;
    let note = text::clean(input.note);
    let mut tx = db.begin().await?;
    let before = sqlx::query_scalar::<_, String>(
        "SELECT name FROM status_categories WHERE id = $1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Категория не найдена".into()))?;
    sqlx::query(
        "UPDATE status_categories SET name = $2, note = $3, updated_at = now() WHERE id = $1",
    )
    .bind(id)
    .bind(&name)
    .bind(&note)
    .execute(&mut *tx)
    .await
    .map_err(AppError::unique_as(format!("Категория «{name}» уже есть")))?;
    audit::record(
        &mut *tx,
        "status_category",
        id,
        "update",
        json!({ "name": { "old": before, "new": name } }),
    )
    .await?;
    tx.commit().await?;
    overview(State(db)).await
}

#[derive(Debug, Deserialize)]
pub struct TransitionsInput {
    pairs: Vec<(Uuid, Uuid)>,
}

/// Матрица сохраняется целиком: что отмечено — разрешено, остальное — нет.
async fn save_transitions(
    State(db): State<Db>,
    Json(input): Json<TransitionsInput>,
) -> AppResult<Json<Overview>> {
    let pairs: Vec<(Uuid, Uuid)> = input.pairs.into_iter().filter(|(a, b)| a != b).collect();
    let from: Vec<Uuid> = pairs.iter().map(|p| p.0).collect();
    let to: Vec<Uuid> = pairs.iter().map(|p| p.1).collect();
    let mut tx = db.begin().await?;
    sqlx::query("DELETE FROM status_transitions")
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO status_transitions (from_id, to_id) \
         SELECT DISTINCT f, t FROM UNNEST($1::uuid[], $2::uuid[]) AS p (f, t)",
    )
    .bind(&from)
    .bind(&to)
    .execute(&mut *tx)
    .await?;
    audit::record(
        &mut *tx,
        "status_transitions",
        Uuid::nil(),
        "update",
        json!({ "transitions": pairs.len() }),
    )
    .await?;
    tx.commit().await?;
    overview(State(db)).await
}

#[derive(Debug, Deserialize)]
pub struct DeviceStatusInput {
    /// None — снять статус.
    status_id: Option<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct DeviceStatus {
    status_id: Option<Uuid>,
    status_name: Option<String>,
    /// Статус поставлен Старшим СА в обход матрицы.
    outside_matrix: bool,
}

async fn status_name<'e, E: sqlx::PgExecutor<'e>>(
    executor: E,
    id: Option<Uuid>,
) -> AppResult<Option<String>> {
    let Some(id) = id else { return Ok(None) };
    Ok(Some(
        sqlx::query_scalar::<_, String>("SELECT name FROM device_statuses WHERE id = $1")
            .bind(id)
            .fetch_optional(executor)
            .await?
            .ok_or_else(|| AppError::Validation("Статус не найден".into()))?,
    ))
}

async fn set_device_status(
    State(db): State<Db>,
    Path(device_id): Path<Uuid>,
    Json(input): Json<DeviceStatusInput>,
) -> AppResult<Json<DeviceStatus>> {
    let user = auth::require(Role::Operator, "Смена статуса устройства")?;
    let mut tx = db.begin().await?;
    let (index, current) = sqlx::query_as::<_, (String, Option<Uuid>)>(
        "SELECT device_index, status_id FROM devices WHERE id = $1 FOR UPDATE",
    )
    .bind(device_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Устройство не найдено".into()))?;
    if current == input.status_id {
        tx.commit().await?;
        return Ok(Json(DeviceStatus {
            status_id: current,
            status_name: status_name(&db, current).await?,
            outside_matrix: false,
        }));
    }
    let old_name = status_name(&mut *tx, current).await?;
    let new_name = status_name(&mut *tx, input.status_id).await?;

    // Без текущего статуса можно поставить любой; дальше — по матрице.
    let allowed = match (current, input.status_id) {
        (None, _) => true,
        (Some(from), Some(to)) => sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM status_transitions WHERE from_id = $1 AND to_id = $2)",
        )
        .bind(from)
        .bind(to)
        .fetch_one(&mut *tx)
        .await?,
        (Some(_), None) => false,
    };
    if !allowed && user.role < Role::Senior {
        return Err(AppError::Conflict(format!(
            "Из статуса «{}» в «{}» по матрице перевести нельзя. Выберите разрешённый статус или обратитесь к Старшему СА",
            old_name.as_deref().unwrap_or("—"),
            new_name.as_deref().unwrap_or("без статуса")
        )));
    }
    sqlx::query("UPDATE devices SET status_id = $2 WHERE id = $1")
        .bind(device_id)
        .bind(input.status_id)
        .execute(&mut *tx)
        .await?;
    let mut changes =
        json!({ "device_index": index, "status": { "old": old_name, "new": new_name } });
    if !allowed {
        changes["outside_matrix"] = json!(true);
    }
    audit::record(&mut *tx, "device", device_id, "status", changes).await?;
    tx.commit().await?;
    Ok(Json(DeviceStatus {
        status_id: input.status_id,
        status_name: new_name,
        outside_matrix: !allowed,
    }))
}
