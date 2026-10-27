//! Доступ к API: кто вошёл (cookie сессии) и какая роль нужна для запроса.
//! Все права собраны здесь в одной таблице; тонкие правила (этапы поставки) — в обработчиках.

use axum::{
    extract::{Request, State},
    http::Method,
    middleware::Next,
    response::{IntoResponse, Response},
};
use skladno_core::{AppError, Db, auth::{self, Role}};

/// Минимальная роль для запроса. None — маршрут открыт без входа.
fn required_role(method: &Method, path: &str) -> Option<Role> {
    if path == "/health" || path.starts_with("/auth/") {
        return None;
    }
    if path.starts_with("/users") || path.starts_with("/invites") {
        return Some(Role::Admin);
    }
    if path == "/settings" && method != Method::GET {
        return Some(Role::Admin);
    }
    if method == Method::GET || method == Method::HEAD {
        return Some(Role::Operator);
    }
    let is_delivery_advance = path.starts_with("/deliveries/") && path.ends_with("/advance");
    let is_delivery_file = path.starts_with("/deliveries/")
        && (path.ends_with("/files") || path.ends_with("/devices/import"));
    // Данные устройства (MAC, серийный) правит СА; закрытую поставку — Старший СА (в обработчике).
    if method == Method::PUT && path.starts_with("/inventory/") {
        return Some(Role::Operator);
    }
    match path {
        // Работа СА: создание поставки, файлы документа, данные устройств, приём, смена этапа
        // (дальше этап проверяет обработчик).
        "/deliveries" | "/placements" => Some(Role::Operator),
        _ if is_delivery_advance || is_delivery_file => Some(Role::Operator),
        // Остальные изменения — справочники и места: Старший СА.
        _ => Some(Role::Senior),
    }
}

pub async fn guard(State(db): State<Db>, request: Request, next: Next) -> Response {
    let user = match skladno_identity::authenticate(&db, request.headers()).await {
        Ok(user) => user,
        Err(error) => return error.into_response(),
    };
    if let Some(min) = required_role(request.method(), request.uri().path()) {
        let Some(user) = &user else {
            return AppError::Unauthorized.into_response();
        };
        if user.role < min {
            return AppError::Forbidden(format!(
                "Недостаточно прав: нужна роль «{}» или выше",
                min.label()
            ))
            .into_response();
        }
    }
    auth::scope(user, next.run(request)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn policy_table() {
        let get = Method::GET;
        let post = Method::POST;
        let put = Method::PUT;
        assert_eq!(required_role(&get, "/health"), None);
        assert_eq!(required_role(&post, "/auth/login"), None);
        assert_eq!(required_role(&get, "/devices"), Some(Role::Operator));
        assert_eq!(required_role(&post, "/deliveries"), Some(Role::Operator));
        assert_eq!(required_role(&post, "/placements"), Some(Role::Operator));
        assert_eq!(required_role(&post, "/deliveries/1/advance"), Some(Role::Operator));
        assert_eq!(required_role(&post, "/deliveries/1/files"), Some(Role::Operator));
        assert_eq!(required_role(&post, "/deliveries/1/devices/import"), Some(Role::Operator));
        assert_eq!(required_role(&post, "/devices"), Some(Role::Senior));
        assert_eq!(required_role(&put, "/modules/1"), Some(Role::Senior));
        assert_eq!(required_role(&put, "/inventory/1"), Some(Role::Operator));
        assert_eq!(required_role(&get, "/users"), Some(Role::Admin));
        assert_eq!(required_role(&post, "/invites"), Some(Role::Admin));
        assert_eq!(required_role(&get, "/settings"), Some(Role::Operator));
        assert_eq!(required_role(&put, "/settings"), Some(Role::Admin));
    }
}
