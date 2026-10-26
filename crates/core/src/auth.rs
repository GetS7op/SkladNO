//! Текущий пользователь запроса и роли. Middleware приложения кладёт пользователя в task-local,
//! чтобы журнал действий и проверки прав в модулях знали, кто выполняет запрос.

use std::future::Future;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{AppError, AppResult};

/// Роли по возрастанию прав: каждая следующая может всё, что предыдущая.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    /// СА: просмотр, создание поставок, приём сканированием.
    Operator,
    /// Старший СА: справочники, подтверждение и закрытие поставок.
    Senior,
    /// Администратор: всё, включая пользователей и приглашения.
    Admin,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Operator => "operator",
            Role::Senior => "senior",
            Role::Admin => "admin",
        }
    }

    pub fn parse(value: &str) -> Option<Role> {
        match value {
            "operator" => Some(Role::Operator),
            "senior" => Some(Role::Senior),
            "admin" => Some(Role::Admin),
            _ => None,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Role::Operator => "СА",
            Role::Senior => "Старший СА",
            Role::Admin => "Администратор",
        }
    }
}

#[derive(Debug, Clone)]
pub struct CurrentUser {
    pub id: Uuid,
    pub login: String,
    pub role: Role,
}

tokio::task_local! {
    static CURRENT: Option<CurrentUser>;
}

/// Выполняет обработчик запроса от имени пользователя (или анонимно).
pub async fn scope<F: Future>(user: Option<CurrentUser>, future: F) -> F::Output {
    CURRENT.scope(user, future).await
}

pub fn current() -> Option<CurrentUser> {
    CURRENT.try_with(Clone::clone).ok().flatten()
}

/// Пользователь с ролью не ниже `min`, иначе 401/403.
pub fn require(min: Role, action: &str) -> AppResult<CurrentUser> {
    let user = current().ok_or(AppError::Unauthorized)?;
    if user.role < min {
        return Err(AppError::Forbidden(format!(
            "{action}: нужна роль «{}» или выше",
            min.label()
        )));
    }
    Ok(user)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roles_are_ordered() {
        assert!(Role::Operator < Role::Senior && Role::Senior < Role::Admin);
        for role in [Role::Operator, Role::Senior, Role::Admin] {
            assert_eq!(Role::parse(role.as_str()), Some(role));
        }
    }

    #[tokio::test]
    async fn scope_sets_current_user() {
        assert!(current().is_none());
        let user = CurrentUser { id: Uuid::nil(), login: "ivanov".into(), role: Role::Senior };
        scope(Some(user), async {
            assert_eq!(current().unwrap().login, "ivanov");
            assert!(require(Role::Senior, "Тест").is_ok());
            assert!(matches!(require(Role::Admin, "Тест"), Err(AppError::Forbidden(_))));
        })
        .await;
        assert!(matches!(require(Role::Operator, "Тест"), Err(AppError::Unauthorized)));
    }
}
