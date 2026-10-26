//! Точка входа SkladNO: конфигурация, миграции, сборка модулей в один API.

use std::net::SocketAddr;

use axum::{
    Json, Router,
    extract::{Query, State},
    routing::get,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use skladno_core::{AppResult, Db};
use sqlx::postgres::PgPoolOptions;
use tower_http::{
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,sqlx=warn".into()),
        )
        .init();

    let database_url = std::env::var("DATABASE_URL").map_err(|_| "DATABASE_URL не задан")?;
    let bind: SocketAddr = std::env::var("BIND")
        .unwrap_or_else(|_| "127.0.0.1:8090".into())
        .parse()?;

    let db = PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await?;
    sqlx::migrate!("../../migrations").run(&db).await?;

    let api = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/audit", get(audit_list))
        .merge(skladno_catalog::router())
        .merge(skladno_clients::router())
        .merge(skladno_deliveries::router());

    let mut app = Router::new()
        .nest("/api/v1", api)
        .with_state(db)
        .layer(TraceLayer::new_for_http());

    // В продакшене backend отдаёт собранный frontend; в разработке его обслуживает Vite.
    if let Ok(dir) = std::env::var("STATIC_DIR") {
        let index = format!("{dir}/index.html");
        app = app.fallback_service(ServeDir::new(dir).fallback(ServeFile::new(index)));
    }

    let listener = tokio::net::TcpListener::bind(bind).await?;
    tracing::info!(%bind, "SkladNO запущен");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}

#[derive(Deserialize)]
struct AuditQuery {
    entity: Option<String>,
    entity_id: Option<Uuid>,
}

#[derive(Serialize, sqlx::FromRow)]
struct AuditEntry {
    id: i64,
    at: DateTime<Utc>,
    actor: String,
    entity: String,
    entity_id: Option<Uuid>,
    action: String,
    changes: serde_json::Value,
}

async fn audit_list(
    State(db): State<Db>,
    Query(query): Query<AuditQuery>,
) -> AppResult<Json<Vec<AuditEntry>>> {
    let rows = sqlx::query_as::<_, AuditEntry>(
        "SELECT id, at, actor, entity, entity_id, action, changes FROM audit_log \
         WHERE ($1::text IS NULL OR entity = $1) AND ($2::uuid IS NULL OR entity_id = $2) \
         ORDER BY at DESC, id DESC LIMIT 300",
    )
    .bind(query.entity)
    .bind(query.entity_id)
    .fetch_all(&db)
    .await?;
    Ok(Json(rows))
}
