//! Пользователи и роли: первый администратор, вход, регистрация по приглашению, сессии в cookie.

mod admin;
mod profile;
mod routes;
mod secrets;
mod throttle;

use axum::{
    Router,
    http::{HeaderMap, HeaderValue, header},
};
use chrono::{Duration, Utc};
use skladno_core::{
    AppResult, Db,
    auth::{CurrentUser, Role},
};
use uuid::Uuid;

const SESSION_COOKIE: &str = "skladno_session";
/// Сессия продлевается при каждом обращении: без активности 14 дней — нужен новый вход.
const SESSION_DAYS: i64 = 14;

pub fn router() -> Router<Db> {
    Router::new().merge(routes::router()).merge(admin::router())
}

fn session_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|part| {
            let (name, value) = part.trim().split_once('=')?;
            (name == SESSION_COOKIE && !value.is_empty()).then_some(value)
        })
}

/// Запрос пришёл по HTTPS через Caddy. Тогда cookie помечается Secure и не уйдёт по HTTP.
fn is_https(headers: &HeaderMap) -> bool {
    headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|proto| proto.eq_ignore_ascii_case("https"))
}

fn session_cookie(token: &str, max_age_seconds: i64, secure: bool) -> HeaderValue {
    let secure = if secure { "; Secure" } else { "" };
    HeaderValue::from_str(&format!(
        "{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age_seconds}{secure}"
    ))
    .expect("токен состоит из hex-символов")
}

async fn create_session<'e, E: sqlx::PgExecutor<'e>>(
    executor: E,
    user_id: Uuid,
    headers: &HeaderMap,
) -> AppResult<HeaderValue> {
    let token = secrets::new_token();
    sqlx::query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)")
        .bind(secrets::token_hash(&token))
        .bind(user_id)
        .bind(Utc::now() + Duration::days(SESSION_DAYS))
        .execute(executor)
        .await?;
    Ok(session_cookie(
        &token,
        SESSION_DAYS * 24 * 60 * 60,
        is_https(headers),
    ))
}

#[derive(sqlx::FromRow)]
struct SessionRow {
    id: Uuid,
    login: String,
    role: String,
    expires_at: chrono::DateTime<Utc>,
}

/// Пользователь по cookie сессии; None — нет сессии, она истекла или пользователь отключён.
/// Роль читается из БД на каждый запрос, поэтому смена роли действует сразу.
pub async fn authenticate(db: &Db, headers: &HeaderMap) -> AppResult<Option<CurrentUser>> {
    let Some(token) = session_token(headers) else {
        return Ok(None);
    };
    let hash = secrets::token_hash(token);
    let row = sqlx::query_as::<_, SessionRow>(
        "SELECT u.id, u.login, u.role, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id \
         WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active",
    )
    .bind(&hash)
    .fetch_optional(db)
    .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    // Продлеваем не чаще раза в сутки, чтобы не писать в БД на каждый запрос.
    if row.expires_at - Utc::now() < Duration::days(SESSION_DAYS - 1) {
        sqlx::query("UPDATE sessions SET expires_at = $2 WHERE token_hash = $1")
            .bind(&hash)
            .bind(Utc::now() + Duration::days(SESSION_DAYS))
            .execute(db)
            .await?;
    }
    Ok(Role::parse(&row.role).map(|role| CurrentUser {
        id: row.id,
        login: row.login,
        role,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cookie_is_secure_only_behind_https() {
        let mut headers = HeaderMap::new();
        assert!(!is_https(&headers));
        assert!(
            !session_cookie("abc", 60, false)
                .to_str()
                .unwrap()
                .contains("Secure")
        );
        headers.insert("x-forwarded-proto", HeaderValue::from_static("https"));
        assert!(is_https(&headers));
        let cookie = session_cookie("abc", 60, true);
        assert!(cookie.to_str().unwrap().ends_with("; Secure"));
    }

    #[test]
    fn reads_session_token_from_cookie_header() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            HeaderValue::from_static("a=1; skladno_session=tok; b=2"),
        );
        assert_eq!(session_token(&headers), Some("tok"));
    }
}
