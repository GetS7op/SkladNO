//! Публичные маршруты /auth/*: состояние, первый администратор, вход, выход, регистрация по приглашению,
//! а также смена своего пароля.

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use skladno_core::{AppError, AppResult, Db, audit, auth};
use uuid::Uuid;

use crate::{
    create_session,
    profile::{self, ME_COLUMNS, Me, ProfileInput},
    secrets, session_cookie, session_token,
};

/// Пауза после неудачного входа: перебор паролей становится медленным.
const FAILED_LOGIN_DELAY: std::time::Duration = std::time::Duration::from_millis(500);
const SETUP_LOCK: i64 = 7302;

pub fn router() -> Router<Db> {
    Router::new()
        .route("/auth/status", get(status))
        .route("/auth/setup", post(setup))
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .route("/auth/invites/{token}", get(invite_info))
        .route("/auth/register", post(register))
        .route("/auth/password", post(change_password))
}

#[derive(Serialize)]
struct Status {
    needs_setup: bool,
    user: Option<Me>,
}

async fn fetch_me<'e, E: sqlx::PgExecutor<'e>>(executor: E, id: Uuid) -> AppResult<Me> {
    sqlx::query_as::<_, Me>(&format!("SELECT {ME_COLUMNS} FROM users WHERE id = $1"))
        .bind(id)
        .fetch_optional(executor)
        .await?
        .ok_or(AppError::Unauthorized)
}

async fn status(State(db): State<Db>) -> AppResult<Json<Status>> {
    let needs_setup = !sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM users)")
        .fetch_one(&db)
        .await?;
    let user = match auth::current() {
        Some(u) => Some(fetch_me(&db, u.id).await?),
        None => None,
    };
    Ok(Json(Status { needs_setup, user }))
}

async fn insert_user(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    input: &ProfileInput,
    role: &str,
) -> AppResult<Uuid> {
    let p = profile::validate(input)?;
    let hash = secrets::hash_password(&input.password)?;
    let id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO users (login, last_name, first_name, middle_name, email, telegram, password_hash, role, last_login_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now()) RETURNING id",
    )
    .bind(&p.login)
    .bind(&p.last_name)
    .bind(&p.first_name)
    .bind(&p.middle_name)
    .bind(&p.email)
    .bind(&p.telegram)
    .bind(hash)
    .bind(role)
    .fetch_one(&mut **tx)
    .await
    .map_err(AppError::unique_as(format!("Логин «{}» уже занят", p.login)))?;
    audit::record(&mut **tx, "user", id, "create", json!({ "profile": p, "role": role })).await?;
    Ok(id)
}

/// Первый запуск: пока пользователей нет, форма создаёт администратора.
async fn setup(State(db): State<Db>, Json(input): Json<ProfileInput>) -> AppResult<impl IntoResponse> {
    let mut tx = db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock($1)").bind(SETUP_LOCK).execute(&mut *tx).await?;
    let exists = sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM users)")
        .fetch_one(&mut *tx)
        .await?;
    if exists {
        return Err(AppError::Conflict("Администратор уже создан — войдите".into()));
    }
    let id = insert_user(&mut tx, &input, "admin").await?;
    let cookie = create_session(&mut *tx, id).await?;
    let me = fetch_me(&mut *tx, id).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, [(header::SET_COOKIE, cookie)], Json(me)))
}

#[derive(Deserialize)]
struct LoginInput {
    login: String,
    password: String,
}

#[derive(sqlx::FromRow)]
struct Credentials {
    id: Uuid,
    password_hash: String,
    active: bool,
}

async fn login(State(db): State<Db>, Json(input): Json<LoginInput>) -> AppResult<impl IntoResponse> {
    let found = sqlx::query_as::<_, Credentials>(
        "SELECT id, password_hash, active FROM users WHERE lower(login) = lower($1)",
    )
    .bind(input.login.trim())
    .fetch_optional(&db)
    .await?;
    let hash = found.as_ref().map_or_else(secrets::dummy_hash, |c| c.password_hash.clone());
    let password_ok = secrets::verify_password(&input.password, &hash);
    let Some(user) = found.filter(|_| password_ok) else {
        tokio::time::sleep(FAILED_LOGIN_DELAY).await;
        return Err(AppError::Validation("Неверный логин или пароль".into()));
    };
    if !user.active {
        return Err(AppError::Forbidden("Учётная запись отключена администратором".into()));
    }
    let mut tx = db.begin().await?;
    sqlx::query("DELETE FROM sessions WHERE expires_at <= now()").execute(&mut *tx).await?;
    sqlx::query("UPDATE users SET last_login_at = now() WHERE id = $1")
        .bind(user.id)
        .execute(&mut *tx)
        .await?;
    let cookie = create_session(&mut *tx, user.id).await?;
    let me = fetch_me(&mut *tx, user.id).await?;
    tx.commit().await?;
    Ok(([(header::SET_COOKIE, cookie)], Json(me)))
}

async fn logout(State(db): State<Db>, headers: HeaderMap) -> AppResult<impl IntoResponse> {
    if let Some(token) = session_token(&headers) {
        sqlx::query("DELETE FROM sessions WHERE token_hash = $1")
            .bind(secrets::token_hash(token))
            .execute(&db)
            .await?;
    }
    Ok(([(header::SET_COOKIE, session_cookie("", 0))], StatusCode::NO_CONTENT))
}

#[derive(Serialize, sqlx::FromRow)]
struct InviteInfo {
    role: String,
    expires_at: Option<DateTime<Utc>>,
}

const VALID_INVITE: &str = "token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL \
    AND (expires_at IS NULL OR expires_at > now())";

fn invalid_invite() -> AppError {
    AppError::NotFound("Приглашение недействительно: истекло, отозвано или уже использовано".into())
}

async fn invite_info(State(db): State<Db>, Path(token): Path<String>) -> AppResult<Json<InviteInfo>> {
    sqlx::query_as::<_, InviteInfo>(&format!("SELECT role, expires_at FROM invites WHERE {VALID_INVITE}"))
        .bind(secrets::token_hash(&token))
        .fetch_optional(&db)
        .await?
        .map(Json)
        .ok_or_else(invalid_invite)
}

#[derive(Deserialize)]
struct RegisterInput {
    token: String,
    #[serde(flatten)]
    profile: ProfileInput,
}

async fn register(State(db): State<Db>, Json(input): Json<RegisterInput>) -> AppResult<impl IntoResponse> {
    let mut tx = db.begin().await?;
    let (invite_id, role) = sqlx::query_as::<_, (Uuid, String)>(&format!(
        "SELECT id, role FROM invites WHERE {VALID_INVITE} FOR UPDATE"
    ))
    .bind(secrets::token_hash(&input.token))
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(invalid_invite)?;
    let id = insert_user(&mut tx, &input.profile, &role).await?;
    sqlx::query("UPDATE invites SET used_by = $2, used_at = now() WHERE id = $1")
        .bind(invite_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let cookie = create_session(&mut *tx, id).await?;
    let me = fetch_me(&mut *tx, id).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, [(header::SET_COOKIE, cookie)], Json(me)))
}

#[derive(Deserialize)]
struct PasswordInput {
    current: String,
    new: String,
}

/// Смена своего пароля; остальные сессии пользователя закрываются.
async fn change_password(
    State(db): State<Db>,
    headers: HeaderMap,
    Json(input): Json<PasswordInput>,
) -> AppResult<StatusCode> {
    let user = auth::current().ok_or(AppError::Unauthorized)?;
    profile::validate_password(&input.new)?;
    let hash = sqlx::query_scalar::<_, String>("SELECT password_hash FROM users WHERE id = $1")
        .bind(user.id)
        .fetch_one(&db)
        .await?;
    if !secrets::verify_password(&input.current, &hash) {
        tokio::time::sleep(FAILED_LOGIN_DELAY).await;
        return Err(AppError::Validation("Текущий пароль указан неверно".into()));
    }
    let current_session = session_token(&headers).map(secrets::token_hash).unwrap_or_default();
    let mut tx = db.begin().await?;
    sqlx::query("UPDATE users SET password_hash = $2 WHERE id = $1")
        .bind(user.id)
        .bind(secrets::hash_password(&input.new)?)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2")
        .bind(user.id)
        .bind(current_session)
        .execute(&mut *tx)
        .await?;
    audit::record(&mut *tx, "user", user.id, "password", json!({})).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
