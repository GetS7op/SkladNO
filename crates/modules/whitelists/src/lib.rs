//! F-04 вайтлист пулов и F-05 вайтлист воркеров.

mod pools;
mod workers;

use axum::Router;
use skladno_core::Db;

pub fn router() -> Router<Db> {
    Router::new().merge(pools::router()).merge(workers::router())
}

#[derive(Debug, serde::Deserialize)]
pub(crate) struct ListQuery {
    q: Option<String>,
    #[serde(default)]
    archived: bool,
}
