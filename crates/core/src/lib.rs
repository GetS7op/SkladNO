//! Общие части модульного монолита: ошибки API, журнал действий, текстовые помощники.

pub mod audit;
pub mod error;
pub mod text;

pub use error::{AppError, AppResult};

pub type Db = sqlx::PgPool;
