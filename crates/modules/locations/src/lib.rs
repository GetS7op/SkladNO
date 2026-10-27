//! Места размещения: F-07 контейнеры, F-08 модули, F-09 карта (адреса MXCXSXP и приём сканированием),
//! F-06 сводка по складам.

mod address;
mod containers;
mod map;
mod modules;
mod settings;
mod warehouses;

use axum::Router;
use skladno_core::Db;

pub use address::Address;

pub fn router() -> Router<Db> {
    Router::new()
        .merge(containers::router())
        .merge(modules::router())
        .merge(map::router())
        .merge(settings::router())
        .merge(warehouses::router())
}
