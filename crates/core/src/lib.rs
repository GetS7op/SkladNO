//! Общие части модульного монолита: ошибки API, текущий пользователь, журнал действий, текстовые помощники.

pub mod audit;
pub mod auth;
pub mod error;
pub mod settings;
pub mod text;

pub use error::{AppError, AppResult};

pub type Db = sqlx::PgPool;
