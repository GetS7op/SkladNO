//! F-05. Вайтлист воркеров: воркер уникален в рамках пула, группа создаётся на месте.
//! Онлайн-метрики («Онлайн», «XP») появятся с подключением к API пулов.

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

use crate::ListQuery;

const SELECT: &str = "SELECT w.id, w.pool_id, p.name AS pool_name, w.name, w.group_name, w.watcher_url, w.archived \
    FROM workers w JOIN pools p ON p.id = w.pool_id";

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Worker {
    id: Uuid,
    pool_id: Uuid,
    pool_name: String,
    name: String,
    group_name: Option<String>,
    watcher_url: Option<String>,
    archived: bool,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct WorkerFields {
    pool_id: Uuid,
    name: String,
    group_name: Option<String>,
    watcher_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct WorkerInput {
    pool_id: Uuid,
    name: String,
    group_name: Option<String>,
    watcher_url: Option<String>,
}

pub fn router() -> Router<Db> {
    Router::new()
        .route("/workers", get(list).post(create))
        .route("/workers/groups", get(groups))
        .route("/workers/{id}", put(update))
        .route("/workers/{id}/archive", post(archive))
        .route("/workers/{id}/restore", post(restore))
}

fn validate(input: WorkerInput) -> AppResult<WorkerFields> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Укажите воркера".into()));
    }
    let watcher_url = text::clean(input.watcher_url);
    if let Some(url) = &watcher_url
        && !(url.starts_with("http://") || url.starts_with("https://"))
    {
        return Err(AppError::Validation(
            "Вотчерлинк должен начинаться с http:// или https://".into(),
        ));
    }
    Ok(WorkerFields {
        pool_id: input.pool_id,
        name,
        group_name: text::clean(input.group_name),
        watcher_url,
    })
}

fn duplicate(name: &str) -> String {
    format!("Воркер «{name}» уже есть в этом пуле")
}

async fn ensure_pool(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, pool_id: Uuid) -> AppResult<()> {
    let active = sqlx::query_scalar::<_, bool>("SELECT NOT archived FROM pools WHERE id = $1")
        .bind(pool_id)
        .fetch_optional(&mut **tx)
        .await?;
    match active {
        Some(true) => Ok(()),
        Some(false) => Err(AppError::Validation("Пул в архиве — выберите другой".into())),
        None => Err(AppError::Validation("Выберите пул из вайтлиста".into())),
    }
}

async fn list(State(db): State<Db>, Query(query): Query<ListQuery>) -> AppResult<Json<Vec<Worker>>> {
    let rows = sqlx::query_as::<_, Worker>(&format!(
        "{SELECT} WHERE w.archived = $1 AND ($2::text IS NULL OR w.name ILIKE $2 OR w.group_name ILIKE $2 \
         OR p.name ILIKE $2) ORDER BY lower(p.name), lower(w.name)"
    ))
    .bind(query.archived)
    .bind(text::like_pattern(query.q.as_deref()))
    .fetch_all(&db)
    .await?;
    Ok(Json(rows))
}

async fn groups(State(db): State<Db>) -> AppResult<Json<Vec<String>>> {
    let rows = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT group_name FROM workers WHERE group_name IS NOT NULL ORDER BY group_name",
    )
    .fetch_all(&db)
    .await?;
    Ok(Json(rows))
}

async fn fetch(db: &Db, id: Uuid) -> AppResult<Worker> {
    sqlx::query_as::<_, Worker>(&format!("{SELECT} WHERE w.id = $1"))
        .bind(id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Воркер не найден".into()))
}

async fn create(
    State(db): State<Db>,
    Json(input): Json<WorkerInput>,
) -> AppResult<(StatusCode, Json<Worker>)> {
    let fields = validate(input)?;
    let mut tx = db.begin().await?;
    ensure_pool(&mut tx, fields.pool_id).await?;
    let id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO workers (pool_id, name, group_name, watcher_url) VALUES ($1, $2, $3, $4) RETURNING id",
    )
    .bind(fields.pool_id)
    .bind(&fields.name)
    .bind(&fields.group_name)
    .bind(&fields.watcher_url)
    .fetch_one(&mut *tx)
    .await
    .map_err(AppError::unique_as(duplicate(&fields.name)))?;
    audit::record(&mut *tx, "worker", id, "create", json!(fields)).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(fetch(&db, id).await?)))
}

async fn update(
    State(db): State<Db>,
    Path(id): Path<Uuid>,
    Json(input): Json<WorkerInput>,
) -> AppResult<Json<Worker>> {
    let fields = validate(input)?;
    let mut tx = db.begin().await?;
    let before = sqlx::query_as::<_, WorkerFields>(
        "SELECT pool_id, name, group_name, watcher_url FROM workers WHERE id = $1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Воркер не найден".into()))?;
    if before.pool_id != fields.pool_id {
        ensure_pool(&mut tx, fields.pool_id).await?;
    }
    sqlx::query(
        "UPDATE workers SET pool_id = $2, name = $3, group_name = $4, watcher_url = $5, updated_at = now() \
         WHERE id = $1",
    )
    .bind(id)
    .bind(fields.pool_id)
    .bind(&fields.name)
    .bind(&fields.group_name)
    .bind(&fields.watcher_url)
    .execute(&mut *tx)
    .await
    .map_err(AppError::unique_as(duplicate(&fields.name)))?;
    audit::record(&mut *tx, "worker", id, "update", audit::diff(&before, &fields)).await?;
    tx.commit().await?;
    Ok(Json(fetch(&db, id).await?))
}

async fn archive(State(db): State<Db>, Path(id): Path<Uuid>) -> AppResult<Json<Worker>> {
    set_archived(db, id, true).await
}

async fn restore(State(db): State<Db>, Path(id): Path<Uuid>) -> AppResult<Json<Worker>> {
    set_archived(db, id, false).await
}

async fn set_archived(db: Db, id: Uuid, archived: bool) -> AppResult<Json<Worker>> {
    let mut tx = db.begin().await?;
    let before = sqlx::query_scalar::<_, bool>("SELECT archived FROM workers WHERE id = $1 FOR UPDATE")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("Воркер не найден".into()))?;
    sqlx::query("UPDATE workers SET archived = $2, updated_at = now() WHERE id = $1")
        .bind(id)
        .bind(archived)
        .execute(&mut *tx)
        .await?;
    let action = if archived { "archive" } else { "restore" };
    audit::record(
        &mut *tx,
        "worker",
        id,
        action,
        json!({ "archived": { "old": before, "new": archived } }),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(fetch(&db, id).await?))
}
