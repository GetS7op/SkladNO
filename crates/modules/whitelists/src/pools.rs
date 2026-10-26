//! F-04. Вайтлист пулов: стратум-линки 1–3 (минимум один), формат ссылок не проверяется.

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

const COLUMNS: &str = "p.id, p.name, p.stratum1, p.stratum2, p.stratum3, p.allowed, p.archived, \
    (SELECT count(*) FROM workers w WHERE w.pool_id = p.id AND NOT w.archived) AS workers";

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Pool {
    id: Uuid,
    name: String,
    stratum1: String,
    stratum2: Option<String>,
    stratum3: Option<String>,
    allowed: bool,
    archived: bool,
    workers: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct PoolFields {
    name: String,
    stratum1: String,
    stratum2: Option<String>,
    stratum3: Option<String>,
    allowed: bool,
}

#[derive(Debug, Deserialize)]
pub struct PoolInput {
    name: String,
    #[serde(default)]
    strata: Vec<String>,
    #[serde(default = "default_allowed")]
    allowed: bool,
}

fn default_allowed() -> bool {
    true
}

pub fn router() -> Router<Db> {
    Router::new()
        .route("/pools", get(list).post(create))
        .route("/pools/{id}", put(update))
        .route("/pools/{id}/archive", post(archive))
        .route("/pools/{id}/restore", post(restore))
}

fn validate(input: PoolInput) -> AppResult<PoolFields> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Укажите наименование пула".into()));
    }
    let strata: Vec<String> = input
        .strata
        .into_iter()
        .filter_map(|s| text::clean(Some(s)))
        .collect();
    if strata.is_empty() {
        return Err(AppError::Validation("Нужен хотя бы один стратум-линк".into()));
    }
    if strata.len() > 3 {
        return Err(AppError::Validation("Не больше трёх стратум-линков".into()));
    }
    let mut strata = strata.into_iter();
    Ok(PoolFields {
        name,
        stratum1: strata.next().unwrap_or_default(),
        stratum2: strata.next(),
        stratum3: strata.next(),
        allowed: input.allowed,
    })
}

fn duplicate(name: &str) -> String {
    format!("Пул «{name}» уже есть в вайтлисте")
}

async fn list(State(db): State<Db>, Query(query): Query<ListQuery>) -> AppResult<Json<Vec<Pool>>> {
    let rows = sqlx::query_as::<_, Pool>(&format!(
        "SELECT {COLUMNS} FROM pools p WHERE p.archived = $1 AND ($2::text IS NULL OR p.name ILIKE $2 \
         OR p.stratum1 ILIKE $2 OR p.stratum2 ILIKE $2 OR p.stratum3 ILIKE $2) ORDER BY lower(p.name)"
    ))
    .bind(query.archived)
    .bind(text::like_pattern(query.q.as_deref()))
    .fetch_all(&db)
    .await?;
    Ok(Json(rows))
}

async fn fetch(db: &Db, id: Uuid) -> AppResult<Pool> {
    sqlx::query_as::<_, Pool>(&format!("SELECT {COLUMNS} FROM pools p WHERE p.id = $1"))
        .bind(id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Пул не найден".into()))
}

async fn create(State(db): State<Db>, Json(input): Json<PoolInput>) -> AppResult<(StatusCode, Json<Pool>)> {
    let fields = validate(input)?;
    let mut tx = db.begin().await?;
    let id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO pools (name, stratum1, stratum2, stratum3, allowed) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    )
    .bind(&fields.name)
    .bind(&fields.stratum1)
    .bind(&fields.stratum2)
    .bind(&fields.stratum3)
    .bind(fields.allowed)
    .fetch_one(&mut *tx)
    .await
    .map_err(AppError::unique_as(duplicate(&fields.name)))?;
    audit::record(&mut *tx, "pool", id, "create", json!(fields)).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(fetch(&db, id).await?)))
}

async fn update(
    State(db): State<Db>,
    Path(id): Path<Uuid>,
    Json(input): Json<PoolInput>,
) -> AppResult<Json<Pool>> {
    let fields = validate(input)?;
    let mut tx = db.begin().await?;
    let before = sqlx::query_as::<_, PoolFields>(
        "SELECT name, stratum1, stratum2, stratum3, allowed FROM pools WHERE id = $1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Пул не найден".into()))?;
    sqlx::query(
        "UPDATE pools SET name = $2, stratum1 = $3, stratum2 = $4, stratum3 = $5, allowed = $6, \
         updated_at = now() WHERE id = $1",
    )
    .bind(id)
    .bind(&fields.name)
    .bind(&fields.stratum1)
    .bind(&fields.stratum2)
    .bind(&fields.stratum3)
    .bind(fields.allowed)
    .execute(&mut *tx)
    .await
    .map_err(AppError::unique_as(duplicate(&fields.name)))?;
    audit::record(&mut *tx, "pool", id, "update", audit::diff(&before, &fields)).await?;
    tx.commit().await?;
    Ok(Json(fetch(&db, id).await?))
}

async fn archive(State(db): State<Db>, Path(id): Path<Uuid>) -> AppResult<Json<Pool>> {
    set_archived(db, id, true).await
}

async fn restore(State(db): State<Db>, Path(id): Path<Uuid>) -> AppResult<Json<Pool>> {
    set_archived(db, id, false).await
}

async fn set_archived(db: Db, id: Uuid, archived: bool) -> AppResult<Json<Pool>> {
    let mut tx = db.begin().await?;
    let before = sqlx::query_scalar::<_, bool>("SELECT archived FROM pools WHERE id = $1 FOR UPDATE")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("Пул не найден".into()))?;
    sqlx::query("UPDATE pools SET archived = $2, updated_at = now() WHERE id = $1")
        .bind(id)
        .bind(archived)
        .execute(&mut *tx)
        .await?;
    let action = if archived { "archive" } else { "restore" };
    audit::record(
        &mut *tx,
        "pool",
        id,
        action,
        json!({ "archived": { "old": before, "new": archived } }),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(fetch(&db, id).await?))
}
