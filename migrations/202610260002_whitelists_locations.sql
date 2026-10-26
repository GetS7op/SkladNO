-- SkladNO, этап 2: вайтлисты (F-04, F-05) и места размещения (F-07, F-08, F-09, F-06).

-- F-04. Вайтлист пулов
CREATE TABLE pools (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL CHECK (btrim(name) <> ''),
    stratum1    text NOT NULL CHECK (btrim(stratum1) <> ''),
    stratum2    text,
    stratum3    text,
    allowed     boolean NOT NULL DEFAULT true,
    archived    boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pools_name_unique ON pools (lower(btrim(name)));
CREATE TRIGGER pools_no_delete BEFORE DELETE ON pools
    FOR EACH ROW EXECUTE FUNCTION forbid_delete();

-- F-05. Вайтлист воркеров
CREATE TABLE workers (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pool_id      uuid NOT NULL REFERENCES pools (id),
    name         text NOT NULL CHECK (btrim(name) <> ''),
    group_name   text,
    watcher_url  text,
    archived     boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
-- Воркер уникален в рамках пула
CREATE UNIQUE INDEX workers_pool_name_unique ON workers (pool_id, lower(btrim(name)));
CREATE TRIGGER workers_no_delete BEFORE DELETE ON workers
    FOR EACH ROW EXECUTE FUNCTION forbid_delete();

-- F-07. Контейнеры (шаблоны)
CREATE TABLE containers (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name               text NOT NULL CHECK (btrim(name) <> ''),
    short_name         text NOT NULL CHECK (btrim(short_name) <> ''),
    power_kw           double precision NOT NULL CHECK (power_kw > 0),
    racks              integer NOT NULL CHECK (racks BETWEEN 1 AND 100),
    shelves_per_rack   integer NOT NULL CHECK (shelves_per_rack BETWEEN 1 AND 100),
    devices_per_shelf  integer NOT NULL CHECK (devices_per_shelf BETWEEN 1 AND 100),
    shelf_dims_mm      text CHECK (shelf_dims_mm ~ '^[0-9]+x[0-9]+x[0-9]+$'),
    description        text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX containers_name_unique ON containers (lower(btrim(name)));
CREATE UNIQUE INDEX containers_short_unique ON containers (lower(btrim(short_name)));
CREATE TRIGGER containers_no_delete BEFORE DELETE ON containers
    FOR EACH ROW EXECUTE FUNCTION forbid_delete();

-- F-08. Модули: набор экземпляров контейнеров
CREATE TABLE modules (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    number      integer NOT NULL UNIQUE CHECK (number > 0),
    location    text,
    warehouse   text NOT NULL CHECK (warehouse IN ('park', 'workshop')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER modules_no_delete BEFORE DELETE ON modules
    FOR EACH ROW EXECUTE FUNCTION forbid_delete();

CREATE TABLE module_containers (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id     uuid NOT NULL REFERENCES modules (id),
    number        integer NOT NULL CHECK (number > 0),
    container_id  uuid NOT NULL REFERENCES containers (id),
    UNIQUE (module_id, number)
);

-- F-09. Размещение устройства на полке: адрес M X C X S X P
CREATE TABLE device_placements (
    device_id            uuid PRIMARY KEY REFERENCES devices (id),
    module_container_id  uuid NOT NULL REFERENCES module_containers (id),
    rack                 integer NOT NULL CHECK (rack > 0),
    shelf                integer NOT NULL CHECK (shelf > 0),
    placed_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_placements_shelf ON device_placements (module_container_id, rack, shelf);
