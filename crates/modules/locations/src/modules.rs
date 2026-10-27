//! F-08. Модули: номер, расположение (склад из справочника складов) и набор экземпляров контейнеров.
//! Занятые экземпляры нельзя убрать или сменить им тип; номер и склад занятого модуля не меняются,
//! иначе адреса на уже наклеенных штрихкодах полок станут неверными.

use std::collections::{HashMap, HashSet};

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, put},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use skladno_core::{AppError, AppResult, Db, audit, text};
use uuid::Uuid;

#[derive(Debug, Serialize, sqlx::FromRow)]
struct ModuleRow {
    id: Uuid,
    number: i32,
    /// Расположение модуля — код склада; имя склада — для показа.
    warehouse: String,
    warehouse_name: String,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
struct InstanceRow {
    id: Uuid,
    module_id: Uuid,
    number: i32,
    container_id: Uuid,
    container_name: String,
    short_name: String,
    capacity: i64,
    placed: i64,
}

#[derive(Debug, Serialize)]
pub struct Module {
    #[serde(flatten)]
    module: ModuleRow,
    containers: Vec<InstanceRow>,
    capacity: i64,
    placed: i64,
}

#[derive(Debug, Deserialize)]
pub struct InstanceInput {
    number: i32,
    container_id: Uuid,
}

#[derive(Debug, Deserialize)]
pub struct ModuleInput {
    number: i32,
    warehouse: String,
    containers: Vec<InstanceInput>,
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    q: Option<String>,
    warehouse: Option<String>,
}

pub fn router() -> Router<Db> {
    Router::new()
        .route("/modules", get(list).post(create))
        .route("/modules/{id}", put(update))
}

const INSTANCES: &str = "SELECT mc.id, mc.module_id, mc.number, mc.container_id, c.name AS container_name, \
    c.short_name, (c.racks * c.shelves_per_rack * c.devices_per_shelf)::bigint AS capacity, \
    (SELECT count(*) FROM device_placements p WHERE p.module_container_id = mc.id) AS placed \
    FROM module_containers mc JOIN containers c ON c.id = mc.container_id";

fn validate(input: &ModuleInput) -> AppResult<()> {
    if input.number <= 0 {
        return Err(AppError::Validation(
            "Порядковый номер модуля — целое число больше нуля".into(),
        ));
    }
    if input.warehouse.trim().is_empty() {
        return Err(AppError::Validation(
            "Выберите расположение — склад модуля".into(),
        ));
    }
    if input.containers.is_empty() {
        return Err(AppError::Validation(
            "Добавьте в модуль хотя бы один контейнер".into(),
        ));
    }
    let mut seen = HashSet::new();
    for c in &input.containers {
        if c.number <= 0 {
            return Err(AppError::Validation(
                "Номер контейнера — целое число больше нуля".into(),
            ));
        }
        if !seen.insert(c.number) {
            return Err(AppError::Validation(format!(
                "Номер контейнера {} повторяется в модуле",
                c.number
            )));
        }
    }
    Ok(())
}

async fn assemble(db: &Db, modules: Vec<ModuleRow>) -> AppResult<Vec<Module>> {
    let ids: Vec<Uuid> = modules.iter().map(|m| m.id).collect();
    let instances = sqlx::query_as::<_, InstanceRow>(&format!(
        "{INSTANCES} WHERE mc.module_id = ANY($1) ORDER BY mc.number"
    ))
    .bind(&ids)
    .fetch_all(db)
    .await?;
    let mut by_module: HashMap<Uuid, Vec<InstanceRow>> = HashMap::new();
    for i in instances {
        by_module.entry(i.module_id).or_default().push(i);
    }
    Ok(modules
        .into_iter()
        .map(|module| {
            let containers = by_module.remove(&module.id).unwrap_or_default();
            Module {
                capacity: containers.iter().map(|c| c.capacity).sum(),
                placed: containers.iter().map(|c| c.placed).sum(),
                module,
                containers,
            }
        })
        .collect())
}

async fn list(
    State(db): State<Db>,
    Query(query): Query<ListQuery>,
) -> AppResult<Json<Vec<Module>>> {
    let modules = sqlx::query_as::<_, ModuleRow>(
        "SELECT m.id, m.number, m.warehouse, w.name AS warehouse_name FROM modules m \
         JOIN warehouses w ON w.code = m.warehouse \
         WHERE ($1::text IS NULL OR w.name ILIKE $1 OR m.number::text = $2) \
         AND ($3::text IS NULL OR m.warehouse = $3) ORDER BY m.number",
    )
    .bind(text::like_pattern(query.q.as_deref()))
    .bind(query.q.as_deref().map(str::trim).unwrap_or_default())
    .bind(text::clean(query.warehouse))
    .fetch_all(&db)
    .await?;
    Ok(Json(assemble(&db, modules).await?))
}

async fn fetch(db: &Db, id: Uuid) -> AppResult<Module> {
    let module = sqlx::query_as::<_, ModuleRow>(
        "SELECT m.id, m.number, m.warehouse, w.name AS warehouse_name FROM modules m \
         JOIN warehouses w ON w.code = m.warehouse WHERE m.id = $1",
    )
    .bind(id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::NotFound("Модуль не найден".into()))?;
    Ok(assemble(db, vec![module]).await?.remove(0))
}

async fn ensure_containers(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    input: &ModuleInput,
) -> AppResult<()> {
    let ids: Vec<Uuid> = input
        .containers
        .iter()
        .map(|c| c.container_id)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let found = sqlx::query_scalar::<_, i64>("SELECT count(*) FROM containers WHERE id = ANY($1)")
        .bind(&ids)
        .fetch_one(&mut **tx)
        .await?;
    if found != ids.len() as i64 {
        return Err(AppError::Validation(
            "Выберите тип контейнера из реестра контейнеров".into(),
        ));
    }
    Ok(())
}

/// Расположение модуля должно быть складом из справочника.
async fn ensure_warehouse(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    code: &str,
) -> AppResult<()> {
    let exists =
        sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM warehouses WHERE code = $1)")
            .bind(code)
            .fetch_one(&mut **tx)
            .await?;
    if !exists {
        return Err(AppError::Validation(
            "Выберите расположение — склад из справочника складов".into(),
        ));
    }
    Ok(())
}

fn duplicate(number: i32) -> String {
    format!("Модуль №{number} уже есть")
}

async fn create(
    State(db): State<Db>,
    Json(input): Json<ModuleInput>,
) -> AppResult<(StatusCode, Json<Module>)> {
    validate(&input)?;
    let mut tx = db.begin().await?;
    ensure_warehouse(&mut tx, &input.warehouse).await?;
    ensure_containers(&mut tx, &input).await?;
    let id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO modules (number, warehouse) VALUES ($1, $2) RETURNING id",
    )
    .bind(input.number)
    .bind(&input.warehouse)
    .fetch_one(&mut *tx)
    .await
    .map_err(AppError::unique_as(duplicate(input.number)))?;
    let all: Vec<&InstanceInput> = input.containers.iter().collect();
    insert_instances(&mut tx, id, &all).await?;
    audit::record(
        &mut *tx,
        "module",
        id,
        "create",
        json!({
            "number": input.number,
            "warehouse": input.warehouse,
            "containers": input.containers.len(),
        }),
    )
    .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(fetch(&db, id).await?)))
}

async fn insert_instances(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    module_id: Uuid,
    instances: &[&InstanceInput],
) -> AppResult<()> {
    if instances.is_empty() {
        return Ok(());
    }
    let numbers: Vec<i32> = instances.iter().map(|c| c.number).collect();
    let containers: Vec<Uuid> = instances.iter().map(|c| c.container_id).collect();
    sqlx::query(
        "INSERT INTO module_containers (module_id, number, container_id) \
         SELECT $1, u.number, u.container_id FROM UNNEST($2::int[], $3::uuid[]) AS u(number, container_id)",
    )
    .bind(module_id)
    .bind(&numbers)
    .bind(&containers)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn update(
    State(db): State<Db>,
    Path(id): Path<Uuid>,
    Json(input): Json<ModuleInput>,
) -> AppResult<Json<Module>> {
    validate(&input)?;
    let mut tx = db.begin().await?;
    let before = sqlx::query_as::<_, ModuleRow>(
        "SELECT m.id, m.number, m.warehouse, w.name AS warehouse_name FROM modules m \
         JOIN warehouses w ON w.code = m.warehouse WHERE m.id = $1 FOR UPDATE OF m",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Модуль не найден".into()))?;
    ensure_warehouse(&mut tx, &input.warehouse).await?;
    ensure_containers(&mut tx, &input).await?;

    // Блокируем экземпляры, чтобы во время правки в них ничего не разместили.
    let existing = sqlx::query_as::<_, InstanceRow>(&format!(
        "{INSTANCES} WHERE mc.module_id = $1 ORDER BY mc.number FOR UPDATE OF mc"
    ))
    .bind(id)
    .fetch_all(&mut *tx)
    .await?;
    let placed_total: i64 = existing.iter().map(|i| i.placed).sum();

    if placed_total > 0 && before.number != input.number {
        return Err(AppError::Conflict(format!(
            "В модуле размещено устройств: {placed_total}. Номер модуля входит в адреса полок — его нельзя менять."
        )));
    }
    if placed_total > 0 && before.warehouse != input.warehouse {
        return Err(AppError::Conflict(format!(
            "В модуле размещено устройств: {placed_total}. Склад «{}» нельзя сменить, пока они не перемещены.",
            before.warehouse_name
        )));
    }

    let wanted: HashMap<i32, Uuid> = input
        .containers
        .iter()
        .map(|c| (c.number, c.container_id))
        .collect();
    let mut removed = Vec::new();
    let mut retyped = Vec::new();
    for inst in &existing {
        match wanted.get(&inst.number) {
            None if inst.placed > 0 => {
                return Err(AppError::Conflict(format!(
                    "Контейнер №{} занят ({} устройств) — его нельзя убрать из модуля. Сначала переместите устройства.",
                    inst.number, inst.placed
                )));
            }
            None => removed.push(inst.id),
            Some(container_id) if *container_id != inst.container_id => {
                if inst.placed > 0 {
                    return Err(AppError::Conflict(format!(
                        "Контейнер №{} занят ({} устройств) — его тип нельзя сменить. Сначала переместите устройства.",
                        inst.number, inst.placed
                    )));
                }
                retyped.push((inst.id, *container_id));
            }
            Some(_) => {}
        }
    }
    let existing_numbers: HashSet<i32> = existing.iter().map(|i| i.number).collect();
    let added: Vec<&InstanceInput> = input
        .containers
        .iter()
        .filter(|c| !existing_numbers.contains(&c.number))
        .collect();

    sqlx::query("DELETE FROM module_containers WHERE id = ANY($1)")
        .bind(&removed)
        .execute(&mut *tx)
        .await?;
    for (instance_id, container_id) in &retyped {
        sqlx::query("UPDATE module_containers SET container_id = $2 WHERE id = $1")
            .bind(instance_id)
            .bind(container_id)
            .execute(&mut *tx)
            .await?;
    }
    insert_instances(&mut tx, id, &added).await?;
    sqlx::query("UPDATE modules SET number = $2, warehouse = $3, updated_at = now() WHERE id = $1")
        .bind(id)
        .bind(input.number)
        .bind(&input.warehouse)
        .execute(&mut *tx)
        .await
        .map_err(AppError::unique_as(duplicate(input.number)))?;

    let mut changes = audit::diff(
        &json!({ "number": before.number, "warehouse": before.warehouse }),
        &json!({ "number": input.number, "warehouse": input.warehouse }),
    );
    if let Some(map) = changes.as_object_mut() {
        if !added.is_empty() {
            map.insert(
                "containers_added".into(),
                json!(added.iter().map(|c| c.number).collect::<Vec<_>>()),
            );
        }
        if !removed.is_empty() {
            map.insert("containers_removed".into(), json!(removed.len()));
        }
        if !retyped.is_empty() {
            map.insert("containers_retyped".into(), json!(retyped.len()));
        }
    }
    audit::record(&mut *tx, "module", id, "update", changes).await?;
    tx.commit().await?;
    Ok(Json(fetch(&db, id).await?))
}
