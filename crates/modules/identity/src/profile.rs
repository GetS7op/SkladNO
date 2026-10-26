//! Форма регистрации (SPEC): Фамилия, Имя, Отчество, Логин, Пароль, Почта, Telegram (необязательно).

use serde::{Deserialize, Serialize};
use skladno_core::{AppError, AppResult};
use uuid::Uuid;

pub const MIN_PASSWORD: usize = 8;

#[derive(Debug, Deserialize)]
pub struct ProfileInput {
    pub login: String,
    pub last_name: String,
    pub first_name: String,
    pub middle_name: String,
    pub email: String,
    pub telegram: Option<String>,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct Profile {
    pub login: String,
    pub last_name: String,
    pub first_name: String,
    pub middle_name: String,
    pub email: String,
    pub telegram: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Me {
    pub id: Uuid,
    pub login: String,
    pub last_name: String,
    pub first_name: String,
    pub middle_name: String,
    pub email: String,
    pub telegram: Option<String>,
    pub role: String,
}

pub const ME_COLUMNS: &str = "id, login, last_name, first_name, middle_name, email, telegram, role";

fn name(value: &str, label: &str) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 60 {
        return Err(AppError::Validation(format!("{label}: от 1 до 60 символов")));
    }
    Ok(value.to_string())
}

pub fn validate_password(password: &str) -> AppResult<()> {
    let length = password.chars().count();
    if !(MIN_PASSWORD..=200).contains(&length) {
        return Err(AppError::Validation(format!(
            "Пароль: не короче {MIN_PASSWORD} символов"
        )));
    }
    Ok(())
}

pub fn validate(input: &ProfileInput) -> AppResult<Profile> {
    let login = input.login.trim();
    if !(3..=40).contains(&login.len())
        || !login.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
    {
        return Err(AppError::Validation(
            "Логин: 3–40 латинских букв, цифр или символов _ . -".into(),
        ));
    }
    let email = input.email.trim();
    if email.len() > 254 || email.contains(char::is_whitespace) || !email.contains('@') || email.starts_with('@') || email.ends_with('@') {
        return Err(AppError::Validation("Укажите почту вида name@example.ru".into()));
    }
    let telegram = match input.telegram.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
        None => None,
        Some(t) => {
            let username = t.trim_start_matches('@');
            if !(5..=32).contains(&username.len()) || !username.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                return Err(AppError::Validation(
                    "Telegram: 5–32 латинских буквы, цифры или _".into(),
                ));
            }
            Some(format!("@{username}"))
        }
    };
    validate_password(&input.password)?;
    Ok(Profile {
        login: login.to_string(),
        last_name: name(&input.last_name, "Фамилия")?,
        first_name: name(&input.first_name, "Имя")?,
        middle_name: name(&input.middle_name, "Отчество")?,
        email: email.to_string(),
        telegram,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> ProfileInput {
        ProfileInput {
            login: " ivanov.p ".into(),
            last_name: "Иванов".into(),
            first_name: "Пётр".into(),
            middle_name: "Сергеевич".into(),
            email: "ivanov@example.ru".into(),
            telegram: Some("ivanov_p".into()),
            password: "длинный-пароль".into(),
        }
    }

    #[test]
    fn valid_profile_is_normalized() {
        let p = validate(&input()).unwrap();
        assert_eq!(p.login, "ivanov.p");
        assert_eq!(p.telegram.as_deref(), Some("@ivanov_p"));
    }

    #[test]
    fn rejects_bad_fields() {
        let cases: [fn(&mut ProfileInput); 5] = [
            |i| i.login = "иванов".into(),
            |i| i.email = "ivanov".into(),
            |i| i.telegram = Some("@abc".into()),
            |i| i.password = "short".into(),
            |i| i.middle_name = " ".into(),
        ];
        for change in cases {
            let mut i = input();
            change(&mut i);
            assert!(validate(&i).is_err());
        }
    }
}
