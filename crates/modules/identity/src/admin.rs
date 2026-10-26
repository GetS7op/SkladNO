//! Администрирование: пользователи (роль, отключение, сброс пароля) и приглашения.
//! Доступ только администратору — проверяет middleware приложения и, для надёжности, каждый обработчик.

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post, put},
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use skladno_core::{
    AppError, AppResult, Db, audit,
    auth::{self, Role},
    text,
};
use uuid::Uuid;

use crate::secrets;

pub fn router() -> Router<Db> {
    Router::new()
        .route("/users", get(list_users))
        .route("/users/{id}", put(update_user))
        .route("/users/{id}/reset-password", post(reset_password))
        .route("/invites", get(list_invites).post(create_invite))
        .route("/invites/{id}/revoke", post(revoke_invite))
}

fn admin() -> AppResult<auth::CurrentUser> {
    auth::require(Role::Admin, "Управление пользователями")
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct UserRow {
    id: Uuid,
    login: String,
    last_name: String,
    first_name: String,
    middle_name: String,
    email: String,
    telegram: Option<String>,
    role: String,
    active: bool,
    created_at: DateTime<Utc>,
    last_login_at: Option<DateTime<Utc>>,
}

const USER_COLUMNS: &str = "id, login, last_name, first_name, middle_name, email, telegram, role, active, \
    created_at, last_login_at";

async fn list_users(State(db): State<Db>) -> AppResult<Json<Vec<UserRow>>> {
    admin()?;
    let rows = sqlx::query_as::<_, UserRow>(&format!(
        "SELECT {USER_COLUMNS} FROM users ORDER BY active DESC, lower(last_name), lower(first_name)"
    ))
    .fetch_all(&db)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
struct UserUpdate {
    role: String,
    active: bool,
}

async fn update_user(
    State(db): State<Db>,
    Path(id): Path<Uuid>,
    Json(input): Json<UserUpdate>,
) -> AppResult<Json<UserRow>> {
    admin()?;
    let role = Role::parse(&input.role).ok_or_else(|| AppError::Validation("Неизвестная роль".into()))?;
    let mut tx = db.begin().await?;
    // Все изменения администраторов идут по одному — проверка «последнего администратора» без гонок.
    sqlx::query("SELECT pg_advisory_xact_lock(7303)").execute(&mut *tx).await?;
    let (old_role, old_active) = sqlx::query_as::<_, (String, bool)>("SELECT role, active FROM users WHERE id = $1 FOR UPDATE")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("Пользователь не найден".into()))?;

    let loses_admin = old_role == "admin" && old_active && (role != Role::Admin || !input.active);
    if loses_admin {
        let other_admins = sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM users WHERE role = 'admin' AND active AND id <> $1",
        )
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
        if other_admins == 0 {
            return Err(AppError::Conflict(
                "Это последний активный администратор — сначала назначьте другого".into(),
            ));
        }
    }

    sqlx::query("UPDATE users SET role = $2, active = $3 WHERE id = $1")
        .bind(id)
        .bind(role.as_str())
        .bind(input.active)
        .execute(&mut *tx)
        .await?;
    if !input.active {
        sqlx::query("DELETE FROM sessions WHERE user_id = $1").bind(id).execute(&mut *tx).await?;
    }
    audit::record(
        &mut *tx,
        "user",
        id,
        "update",
        audit::diff(
            &json!({ "role": old_role, "active": old_active }),
            &json!({ "role": role.as_str(), "active": input.active }),
        ),
    )
    .await?;
    let row = sqlx::query_as::<_, UserRow>(&format!("SELECT {USER_COLUMNS} FROM users WHERE id = $1"))
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(row))
}

#[derive(Serialize)]
struct TemporaryPassword {
    password: String,
}

/// Сброс пароля: администратор получает временный пароль один раз, все сессии пользователя закрываются.
async fn reset_password(State(db): State<Db>, Path(id): Path<Uuid>) -> AppResult<Json<TemporaryPassword>> {
    admin()?;
    let password = secrets::temporary_password();
    let mut tx = db.begin().await?;
    let updated = sqlx::query("UPDATE users SET password_hash = $2 WHERE id = $1")
        .bind(id)
        .bind(secrets::hash_password(&password)?)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if updated == 0 {
        return Err(AppError::NotFound("Пользователь не найден".into()));
    }
    sqlx::query("DELETE FROM sessions WHERE user_id = $1").bind(id).execute(&mut *tx).await?;
    audit::record(&mut *tx, "user", id, "reset_password", json!({})).await?;
    tx.commit().await?;
    Ok(Json(TemporaryPassword { password }))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct InviteRow {
    id: Uuid,
    role: String,
    note: Option<String>,
    expires_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    created_by_login: String,
    used_at: Option<DateTime<Utc>>,
    used_by_login: Option<String>,
    revoked_at: Option<DateTime<Utc>>,
    /// active | used | expired | revoked
    status: String,
}

const INVITE_SELECT: &str = "SELECT i.id, i.role, i.note, i.expires_at, i.created_at, c.login AS created_by_login, \
    i.used_at, u.login AS used_by_login, i.revoked_at, \
    CASE WHEN i.used_at IS NOT NULL THEN 'used' WHEN i.revoked_at IS NOT NULL THEN 'revoked' \
         WHEN i.expires_at IS NOT NULL AND i.expires_at <= now() THEN 'expired' ELSE 'active' END AS status \
    FROM invites i JOIN users c ON c.id = i.created_by LEFT JOIN users u ON u.id = i.used_by";

async fn list_invites(State(db): State<Db>) -> AppResult<Json<Vec<InviteRow>>> {
    admin()?;
    let rows = sqlx::query_as::<_, InviteRow>(&format!("{INVITE_SELECT} ORDER BY i.created_at DESC LIMIT 200"))
        .fetch_all(&db)
        .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
struct InviteInput {
    role: String,
    /// Срок действия в днях; None — бессрочно.
    days: Option<i64>,
    note: Option<String>,
}

#[derive(Serialize)]
struct CreatedInvite {
    invite: InviteRow,
    /// Ссылка показывается один раз: в БД хранится только хеш токена.
    path: String,
}

async fn create_invite(
    State(db): State<Db>,
    Json(input): Json<InviteInput>,
) -> AppResult<(StatusCode, Json<CreatedInvite>)> {
    let user = admin()?;
    let role = Role::parse(&input.role).ok_or_else(|| AppError::Validation("Неизвестная роль".into()))?;
    if input.days.is_some_and(|d| !(1..=365).contains(&d)) {
        return Err(AppError::Validation("Срок действия: от 1 до 365 дней или бессрочно".into()));
    }
    let token = secrets::new_token();
    let expires_at = input.days.map(|d| Utc::now() + Duration::days(d));
    let mut tx = db.begin().await?;
    let id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO invites (token_hash, role, note, expires_at, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    )
    .bind(secrets::token_hash(&token))
    .bind(role.as_str())
    .bind(text::clean(input.note))
    .bind(expires_at)
    .bind(user.id)
    .fetch_one(&mut *tx)
    .await?;
    audit::record(&mut *tx, "invite", id, "create", json!({ "role": role.as_str(), "expires_at": expires_at })).await?;
    let invite = sqlx::query_as::<_, InviteRow>(&format!("{INVITE_SELECT} WHERE i.id = $1"))
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(CreatedInvite { invite, path: format!("/invite/{token}") })))
}

async fn revoke_invite(State(db): State<Db>, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    admin()?;
    let mut tx = db.begin().await?;
    let revoked = sqlx::query("UPDATE invites SET revoked_at = now() WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL")
        .bind(id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if revoked == 0 {
        return Err(AppError::Conflict("Приглашение уже использовано или отозвано".into()));
    }
    audit::record(&mut *tx, "invite", id, "revoke", json!({})).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
