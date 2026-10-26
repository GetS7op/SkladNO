//! Реестры для выгрузки: данные и статистика по каждому.

use std::collections::BTreeMap;

use chrono::NaiveDate;
use skladno_core::{AppResult, Db};

use crate::table::{Cell, Table};

fn destination(v: &str) -> &'static str {
    match v {
        "park" => "Парк",
        "workshop" => "Мастерская",
        _ => "?",
    }
}

fn stage(v: &str) -> &'static str {
    match v {
        "created" => "Создание",
        "receiving" => "Приём поставки",
        "confirmation" => "Подтверждение поставки",
        "closed" => "Закрытие поставки",
        _ => "?",
    }
}

fn yes_no(v: bool) -> Cell {
    (if v { "да" } else { "нет" }).into()
}

fn date(v: NaiveDate) -> Cell {
    v.format("%d.%m.%Y").to_string().into()
}

/// Счётчики «значение → количество» для статистики, в порядке убывания.
fn tally<'a>(prefix: &str, values: impl Iterator<Item = &'a str>) -> Vec<(String, Cell)> {
    let mut counts: BTreeMap<&str, i64> = BTreeMap::new();
    for v in values {
        *counts.entry(v).or_default() += 1;
    }
    let mut pairs: Vec<_> = counts.into_iter().collect();
    pairs.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
    pairs.into_iter().map(|(k, n)| (format!("{prefix}: {k}"), n.into())).collect()
}

pub const NAMES: [&str; 8] = [
    "devices", "inventory", "clients", "deliveries", "pools", "workers", "containers", "modules",
];

pub async fn build(db: &Db, name: &str) -> AppResult<Option<Table>> {
    Ok(Some(match name {
        "devices" => device_models(db).await?,
        "inventory" => inventory(db).await?,
        "clients" => clients(db).await?,
        "deliveries" => deliveries(db).await?,
        "pools" => pools(db).await?,
        "workers" => workers(db).await?,
        "containers" => containers(db).await?,
        "modules" => modules(db).await?,
        _ => return Ok(None),
    }))
}

#[derive(sqlx::FromRow)]
struct ModelRow {
    manufacturer: String,
    model: String,
    hashrate_ths: Option<f64>,
    power_w: Option<i32>,
    dimensions_mm: Option<String>,
    weight_kg: Option<String>,
    archived: bool,
    devices: i64,
}

async fn device_models(db: &Db) -> AppResult<Table> {
    let rows = sqlx::query_as::<_, ModelRow>(
        "SELECT m.manufacturer, m.model, m.hashrate_ths, m.power_w, m.dimensions_mm, m.weight_kg, m.archived, \
         (SELECT count(*) FROM devices d WHERE d.model_id = m.id) AS devices \
         FROM device_models m ORDER BY m.archived, lower(m.manufacturer), lower(m.model)",
    )
    .fetch_all(db)
    .await?;
    let mut stats = vec![
        ("Моделей".to_string(), (rows.len() as i64).into()),
        ("В архиве".to_string(), (rows.iter().filter(|r| r.archived).count() as i64).into()),
        ("Устройств этих моделей".to_string(), rows.iter().map(|r| r.devices).sum::<i64>().into()),
    ];
    stats.extend(tally("Моделей производителя", rows.iter().map(|r| r.manufacturer.as_str())));
    Ok(Table {
        title: "Устройства (модели)".into(),
        file: "devices".into(),
        columns: vec!["Производитель", "Модель", "XP, Th/s", "Потребление, Вт", "Размеры, мм", "Вес, кг", "Архив", "Устройств"],
        rows: rows
            .into_iter()
            .map(|r| {
                vec![
                    r.manufacturer.into(),
                    r.model.into(),
                    r.hashrate_ths.into(),
                    r.power_w.into(),
                    r.dimensions_mm.into(),
                    r.weight_kg.into(),
                    yes_no(r.archived),
                    r.devices.into(),
                ]
            })
            .collect(),
        stats,
    })
}

#[derive(sqlx::FromRow)]
struct InventoryRow {
    device_index: String,
    id: uuid::Uuid,
    manufacturer: String,
    model: String,
    hashrate_ths: Option<f64>,
    power_w: Option<i32>,
    client: String,
    number: String,
    delivery_date: NaiveDate,
    destination: String,
    stage: String,
    location: Option<String>,
}

/// Все физические устройства: Index, модель, клиент, поставка, склад, место.
async fn inventory(db: &Db) -> AppResult<Table> {
    let rows = sqlx::query_as::<_, InventoryRow>(
        "SELECT v.device_index, v.id, m.manufacturer, m.model, m.hashrate_ths, m.power_w, c.name AS client, \
         d.number, d.delivery_date, v.destination, d.stage, \
         md.number::text || 'X' || mc.number::text || 'X' || p.rack::text || 'X' || p.shelf::text AS location \
         FROM devices v JOIN device_models m ON m.id = v.model_id JOIN deliveries d ON d.id = v.delivery_id \
         JOIN clients c ON c.id = d.client_id LEFT JOIN device_placements p ON p.device_id = v.id \
         LEFT JOIN module_containers mc ON mc.id = p.module_container_id LEFT JOIN modules md ON md.id = mc.module_id \
         ORDER BY v.device_index",
    )
    .fetch_all(db)
    .await?;
    let placed = rows.iter().filter(|r| r.location.is_some()).count() as i64;
    let total_xp: f64 = rows.iter().filter_map(|r| r.hashrate_ths).sum();
    let total_kw: f64 = rows.iter().filter_map(|r| r.power_w).map(f64::from).sum::<f64>() / 1000.0;
    let mut stats = vec![
        ("Устройств".to_string(), (rows.len() as i64).into()),
        ("Размещено".to_string(), placed.into()),
        ("Не размещено".to_string(), (rows.len() as i64 - placed).into()),
        ("Суммарный XP, Th/s".to_string(), total_xp.into()),
        ("Суммарное потребление, кВт".to_string(), total_kw.into()),
    ];
    stats.extend(tally("Склад", rows.iter().map(|r| destination(&r.destination))));
    stats.extend(tally("Клиент", rows.iter().map(|r| r.client.as_str())));
    stats.extend(tally("Модель", rows.iter().map(|r| r.model.as_str())));
    Ok(Table {
        title: "Реестр устройств".into(),
        file: "inventory".into(),
        columns: vec!["Index", "UUID", "Производитель", "Модель", "XP, Th/s", "Потребление, Вт", "Клиент", "Поставка", "Дата поставки", "Склад", "Этап поставки", "Место"],
        rows: rows
            .into_iter()
            .map(|r| {
                vec![
                    r.device_index.into(),
                    r.id.to_string().into(),
                    r.manufacturer.into(),
                    r.model.into(),
                    r.hashrate_ths.into(),
                    r.power_w.into(),
                    r.client.into(),
                    r.number.into(),
                    date(r.delivery_date),
                    destination(&r.destination).into(),
                    stage(&r.stage).into(),
                    r.location.into(),
                ]
            })
            .collect(),
        stats,
    })
}

#[derive(sqlx::FromRow)]
struct ClientRow {
    name: String,
    note: Option<String>,
    deliveries: i64,
    devices: i64,
}

async fn clients(db: &Db) -> AppResult<Table> {
    let rows = sqlx::query_as::<_, ClientRow>(
        "SELECT c.name, c.note, (SELECT count(*) FROM deliveries d WHERE d.client_id = c.id) AS deliveries, \
         (SELECT count(*) FROM devices v JOIN deliveries d ON d.id = v.delivery_id WHERE d.client_id = c.id) AS devices \
         FROM clients c ORDER BY lower(c.name)",
    )
    .fetch_all(db)
    .await?;
    let stats = vec![
        ("Клиентов".to_string(), (rows.len() as i64).into()),
        ("Поставок".to_string(), rows.iter().map(|r| r.deliveries).sum::<i64>().into()),
        ("Устройств".to_string(), rows.iter().map(|r| r.devices).sum::<i64>().into()),
    ];
    Ok(Table {
        title: "Клиенты".into(),
        file: "clients".into(),
        columns: vec!["Наименование", "Заметка", "Поставок", "Устройств"],
        rows: rows
            .into_iter()
            .map(|r| vec![r.name.into(), r.note.into(), r.deliveries.into(), r.devices.into()])
            .collect(),
        stats,
    })
}

#[derive(sqlx::FromRow)]
struct DeliveryRow {
    number: String,
    delivery_date: NaiveDate,
    client: String,
    device_group: Option<String>,
    basis_doc: Option<String>,
    destination: String,
    stage: String,
    devices: i64,
    placed: i64,
}

async fn deliveries(db: &Db) -> AppResult<Table> {
    let rows = sqlx::query_as::<_, DeliveryRow>(
        "SELECT d.number, d.delivery_date, c.name AS client, d.device_group, d.basis_doc, d.destination, d.stage, \
         (SELECT count(*) FROM devices v WHERE v.delivery_id = d.id) AS devices, \
         (SELECT count(*) FROM devices v JOIN device_placements p ON p.device_id = v.id WHERE v.delivery_id = d.id) AS placed \
         FROM deliveries d JOIN clients c ON c.id = d.client_id ORDER BY d.year DESC, d.seq DESC",
    )
    .fetch_all(db)
    .await?;
    let mut stats = vec![
        ("Поставок".to_string(), (rows.len() as i64).into()),
        ("Устройств".to_string(), rows.iter().map(|r| r.devices).sum::<i64>().into()),
        ("Размещено".to_string(), rows.iter().map(|r| r.placed).sum::<i64>().into()),
    ];
    stats.extend(tally("Этап", rows.iter().map(|r| stage(&r.stage))));
    stats.extend(tally("Назначение", rows.iter().map(|r| destination(&r.destination))));
    Ok(Table {
        title: "Поставки".into(),
        file: "deliveries".into(),
        columns: vec!["Наименование", "Дата", "Клиент", "Группа устройств", "Документ-основание", "Назначение", "Этап", "Устройств", "Размещено"],
        rows: rows
            .into_iter()
            .map(|r| {
                vec![
                    r.number.into(),
                    date(r.delivery_date),
                    r.client.into(),
                    r.device_group.into(),
                    r.basis_doc.into(),
                    destination(&r.destination).into(),
                    stage(&r.stage).into(),
                    r.devices.into(),
                    r.placed.into(),
                ]
            })
            .collect(),
        stats,
    })
}

#[derive(sqlx::FromRow)]
struct PoolRow {
    name: String,
    stratum1: String,
    stratum2: Option<String>,
    stratum3: Option<String>,
    allowed: bool,
    archived: bool,
    workers: i64,
}

async fn pools(db: &Db) -> AppResult<Table> {
    let rows = sqlx::query_as::<_, PoolRow>(
        "SELECT p.name, p.stratum1, p.stratum2, p.stratum3, p.allowed, p.archived, \
         (SELECT count(*) FROM workers w WHERE w.pool_id = p.id AND NOT w.archived) AS workers \
         FROM pools p ORDER BY p.archived, lower(p.name)",
    )
    .fetch_all(db)
    .await?;
    let stats = vec![
        ("Пулов".to_string(), (rows.len() as i64).into()),
        ("Разрешено".to_string(), (rows.iter().filter(|r| r.allowed && !r.archived).count() as i64).into()),
        ("В архиве".to_string(), (rows.iter().filter(|r| r.archived).count() as i64).into()),
        ("Активных воркеров".to_string(), rows.iter().map(|r| r.workers).sum::<i64>().into()),
    ];
    Ok(Table {
        title: "Вайтлист пулов".into(),
        file: "pools".into(),
        columns: vec!["Пул", "Стратум 1", "Стратум 2", "Стратум 3", "Разрешение", "Архив", "Воркеров"],
        rows: rows
            .into_iter()
            .map(|r| {
                vec![r.name.into(), r.stratum1.into(), r.stratum2.into(), r.stratum3.into(), yes_no(r.allowed), yes_no(r.archived), r.workers.into()]
            })
            .collect(),
        stats,
    })
}

#[derive(sqlx::FromRow)]
struct WorkerRow {
    pool: String,
    name: String,
    group_name: Option<String>,
    watcher_url: Option<String>,
    archived: bool,
}

async fn workers(db: &Db) -> AppResult<Table> {
    let rows = sqlx::query_as::<_, WorkerRow>(
        "SELECT p.name AS pool, w.name, w.group_name, w.watcher_url, w.archived FROM workers w \
         JOIN pools p ON p.id = w.pool_id ORDER BY w.archived, lower(p.name), lower(w.name)",
    )
    .fetch_all(db)
    .await?;
    let mut stats = vec![
        ("Воркеров".to_string(), (rows.len() as i64).into()),
        ("В архиве".to_string(), (rows.iter().filter(|r| r.archived).count() as i64).into()),
    ];
    stats.extend(tally("Пул", rows.iter().map(|r| r.pool.as_str())));
    stats.extend(tally("Группа", rows.iter().map(|r| r.group_name.as_deref().unwrap_or("без группы"))));
    Ok(Table {
        title: "Вайтлист воркеров".into(),
        file: "workers".into(),
        columns: vec!["Пул", "Воркер", "Группа", "Вотчерлинк", "Архив"],
        rows: rows
            .into_iter()
            .map(|r| vec![r.pool.into(), r.name.into(), r.group_name.into(), r.watcher_url.into(), yes_no(r.archived)])
            .collect(),
        stats,
    })
}

#[derive(sqlx::FromRow)]
struct ContainerRow {
    name: String,
    short_name: String,
    power_kw: f64,
    racks: i32,
    shelves_per_rack: i32,
    devices_per_shelf: i32,
    shelf_dims_mm: Option<String>,
    instances: i64,
}

async fn containers(db: &Db) -> AppResult<Table> {
    let rows = sqlx::query_as::<_, ContainerRow>(
        "SELECT c.name, c.short_name, c.power_kw, c.racks, c.shelves_per_rack, c.devices_per_shelf, c.shelf_dims_mm, \
         (SELECT count(*) FROM module_containers mc WHERE mc.container_id = c.id) AS instances \
         FROM containers c ORDER BY lower(c.name)",
    )
    .fetch_all(db)
    .await?;
    let places = |r: &ContainerRow| i64::from(r.racks * r.shelves_per_rack * r.devices_per_shelf);
    let stats = vec![
        ("Шаблонов".to_string(), (rows.len() as i64).into()),
        ("Экземпляров в модулях".to_string(), rows.iter().map(|r| r.instances).sum::<i64>().into()),
        ("Мест во всех экземплярах".to_string(), rows.iter().map(|r| places(r) * r.instances).sum::<i64>().into()),
    ];
    Ok(Table {
        title: "Контейнеры".into(),
        file: "containers".into(),
        columns: vec!["Наименование", "Сокращение", "Мощность, кВт", "Стеллажей", "Полок на стеллаж", "Устройств на полку", "Мест", "Полка, мм", "В модулях"],
        rows: rows
            .iter()
            .map(|r| {
                vec![
                    r.name.clone().into(),
                    r.short_name.clone().into(),
                    r.power_kw.into(),
                    r.racks.into(),
                    r.shelves_per_rack.into(),
                    r.devices_per_shelf.into(),
                    places(r).into(),
                    r.shelf_dims_mm.clone().into(),
                    r.instances.into(),
                ]
            })
            .collect(),
        stats,
    })
}

#[derive(sqlx::FromRow)]
struct ModuleRow {
    number: i32,
    location: Option<String>,
    warehouse: String,
    containers: String,
    capacity: i64,
    placed: i64,
}

async fn modules(db: &Db) -> AppResult<Table> {
    let rows = sqlx::query_as::<_, ModuleRow>(
        "SELECT m.number, m.location, m.warehouse, \
         COALESCE(string_agg(mc.number::text || '·' || c.short_name, ', ' ORDER BY mc.number), '') AS containers, \
         COALESCE(sum(c.racks * c.shelves_per_rack * c.devices_per_shelf), 0)::bigint AS capacity, \
         (SELECT count(*) FROM device_placements p JOIN module_containers x ON x.id = p.module_container_id WHERE x.module_id = m.id) AS placed \
         FROM modules m LEFT JOIN module_containers mc ON mc.module_id = m.id LEFT JOIN containers c ON c.id = mc.container_id \
         GROUP BY m.id ORDER BY m.number",
    )
    .fetch_all(db)
    .await?;
    let capacity: i64 = rows.iter().map(|r| r.capacity).sum();
    let placed: i64 = rows.iter().map(|r| r.placed).sum();
    let mut stats = vec![
        ("Модулей".to_string(), (rows.len() as i64).into()),
        ("Мест".to_string(), capacity.into()),
        ("Занято".to_string(), placed.into()),
        ("Свободно".to_string(), (capacity - placed).into()),
    ];
    stats.extend(tally("Модулей на складе", rows.iter().map(|r| destination(&r.warehouse))));
    Ok(Table {
        title: "Модули".into(),
        file: "modules".into(),
        columns: vec!["№ модуля", "Расположение", "Склад", "Контейнеры", "Мест", "Занято", "Свободно"],
        rows: rows
            .into_iter()
            .map(|r| {
                vec![
                    r.number.into(),
                    r.location.into(),
                    destination(&r.warehouse).into(),
                    r.containers.into(),
                    r.capacity.into(),
                    r.placed.into(),
                    (r.capacity - r.placed).into(),
                ]
            })
            .collect(),
        stats,
    })
}
