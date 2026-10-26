-- SkladNO: первый срез (F-01 устройства, F-02 клиенты, F-03 поставки, журнал действий).

CREATE FUNCTION forbid_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Удаление записей из % запрещено', TG_TABLE_NAME;
END;
$$;

-- Журнал действий
CREATE TABLE audit_log (
    id         bigserial PRIMARY KEY,
    at         timestamptz NOT NULL DEFAULT now(),
    actor      text NOT NULL,
    entity     text NOT NULL,
    entity_id  uuid,
    action     text NOT NULL,
    changes    jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_entity ON audit_log (entity, entity_id, at DESC);

-- F-01. Реестр устройств и характеристик
CREATE TABLE device_models (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    manufacturer   text NOT NULL CHECK (btrim(manufacturer) <> ''),
    model          text NOT NULL CHECK (btrim(model) <> ''),
    hashrate_ths   double precision CHECK (hashrate_ths >= 0),
    power_w        integer CHECK (power_w >= 0),
    dimensions_mm  text CHECK (dimensions_mm ~ '^[0-9]+x[0-9]+x[0-9]+$'),
    weight_kg      text,
    archived       boolean NOT NULL DEFAULT false,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
-- R-03: «Производитель + Модель» уникальны
CREATE UNIQUE INDEX device_models_unique ON device_models (lower(btrim(manufacturer)), lower(btrim(model)));
-- R-01: удаление запрещено, только архив
CREATE TRIGGER device_models_no_delete BEFORE DELETE ON device_models
    FOR EACH ROW EXECUTE FUNCTION forbid_delete();

-- F-02. Клиенты
CREATE TABLE clients (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL CHECK (char_length(btrim(name)) >= 3),
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX clients_name_unique ON clients (lower(btrim(name)));
CREATE TRIGGER clients_no_delete BEFORE DELETE ON clients
    FOR EACH ROW EXECUTE FUNCTION forbid_delete();

-- F-03. Поставки
CREATE TABLE deliveries (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id     uuid NOT NULL UNIQUE,
    number         text NOT NULL UNIQUE,
    year           integer NOT NULL,
    seq            integer NOT NULL,
    client_id      uuid NOT NULL REFERENCES clients (id),
    device_group   text,
    delivery_date  date NOT NULL,
    basis_doc      text,
    basis_date     date,
    destination    text NOT NULL CHECK (destination IN ('park', 'workshop')),
    stage          text NOT NULL DEFAULT 'created'
                   CHECK (stage IN ('created', 'receiving', 'confirmation', 'closed')),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (year, seq)
);
CREATE INDEX deliveries_client ON deliveries (client_id);
CREATE TRIGGER deliveries_no_delete BEFORE DELETE ON deliveries
    FOR EACH ROW EXECUTE FUNCTION forbid_delete();

CREATE TABLE delivery_lines (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id  uuid NOT NULL REFERENCES deliveries (id),
    position     integer NOT NULL,
    model_id     uuid NOT NULL REFERENCES device_models (id),
    quantity     integer NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
    UNIQUE (delivery_id, model_id)
);

-- R-02: состав поставки после создания не меняется
CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Изменение записей в % запрещено', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER delivery_lines_frozen BEFORE UPDATE OR DELETE ON delivery_lines
    FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- R-01: раздельные диапазоны Index по назначению
CREATE TABLE index_ranges (
    destination  text PRIMARY KEY CHECK (destination IN ('park', 'workshop')),
    next_value   integer NOT NULL,
    max_value    integer NOT NULL
);
INSERT INTO index_ranges (destination, next_value, max_value) VALUES
    ('park', 1, 8999999),
    ('workshop', 9000000, 9999999);

CREATE TABLE devices (
    id            uuid PRIMARY KEY,
    device_index  text NOT NULL UNIQUE CHECK (device_index ~ '^[0-9]{7}$'),
    delivery_id   uuid NOT NULL REFERENCES deliveries (id),
    model_id      uuid NOT NULL REFERENCES device_models (id),
    destination   text NOT NULL CHECK (destination IN ('park', 'workshop')),
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX devices_delivery ON devices (delivery_id, device_index);
CREATE TRIGGER devices_frozen BEFORE UPDATE OF device_index, model_id, delivery_id OR DELETE ON devices
    FOR EACH ROW EXECUTE FUNCTION forbid_change();
