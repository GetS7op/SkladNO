-- Обслуживание устройств (по образцу mf-old): статусы с матрицей переходов, отправки контрагентам,
-- склад комплектующих.

-- ---------- Статусы устройств ----------
CREATE TABLE status_categories (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX status_categories_name ON status_categories (lower(name));

CREATE TABLE device_statuses (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name         text NOT NULL,
    category_id  uuid REFERENCES status_categories (id) ON DELETE SET NULL,
    note         text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX device_statuses_name ON device_statuses (lower(name));

-- Матрица: из какого статуса в какой можно перевести устройство вручную.
CREATE TABLE status_transitions (
    from_id  uuid NOT NULL REFERENCES device_statuses (id) ON DELETE CASCADE,
    to_id    uuid NOT NULL REFERENCES device_statuses (id) ON DELETE CASCADE,
    PRIMARY KEY (from_id, to_id),
    CHECK (from_id <> to_id)
);

ALTER TABLE devices ADD COLUMN status_id uuid REFERENCES device_statuses (id) ON DELETE SET NULL;
CREATE INDEX devices_status ON devices (status_id);

-- Начальный справочник — как в mf-old у заказчика; дальше правится в «Настройки → Статусы».
INSERT INTO status_categories (name, note) VALUES
    ('В контейнере', 'Устройство физически находится в контейнере'),
    ('В мастерской', 'Устройство физически находится в мастерской'),
    ('Отсутствует', 'Устройство физически находится не на территории');

INSERT INTO device_statuses (name, category_id, note)
SELECT s.name, c.id, s.note FROM (VALUES
    ('В работе', 'В контейнере', 'Находится в контейнере на позиции, работает штатно.'),
    ('Внимание', 'В контейнере', 'Находится в контейнере, требует внимания дежурных.'),
    ('Требует ТО', 'В контейнере', 'Находится в контейнере, отключен, требует переноса на диагностику.'),
    ('Ремонт', 'В мастерской', 'Находится на ремонте.'),
    ('Упакован', 'В мастерской', 'Упакован для отправки клиенту.'),
    ('На размещение', 'В мастерской', 'Аппарат в исправном состоянии, требует размещения в контейнере.'),
    ('Возврат', 'Отсутствует', 'Отправлен клиенту обратно.'),
    ('Донор', 'В мастерской', 'Служит донором для других устройств. С разрешения клиента.')
) AS s (name, category, note) JOIN status_categories c ON c.name = s.category;

INSERT INTO status_transitions (from_id, to_id)
SELECT f.id, t.id FROM (VALUES
    ('В работе', 'Внимание'), ('В работе', 'Требует ТО'),
    ('Внимание', 'В работе'), ('Внимание', 'Требует ТО'),
    ('Возврат', 'Ремонт'), ('Возврат', 'На размещение'),
    ('Донор', 'Ремонт'),
    ('На размещение', 'В работе'), ('На размещение', 'Ремонт'),
    ('Ремонт', 'Упакован'), ('Ремонт', 'На размещение'), ('Ремонт', 'Донор'),
    ('Требует ТО', 'В работе'), ('Требует ТО', 'Внимание'), ('Требует ТО', 'Ремонт'),
    ('Упакован', 'Возврат')
) AS p (f, t) JOIN device_statuses f ON f.name = p.f JOIN device_statuses t ON t.name = p.t;

-- ---------- Отправки ----------
-- Устройство уезжает к контрагенту (ремонт, возврат клиенту) и возвращается. Пока нет даты прибытия,
-- отправка открыта, и упаковать устройство повторно нельзя.
CREATE TABLE shipments (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id    uuid NOT NULL REFERENCES devices (id),
    recipient    text,
    packed_at    date,
    shipped_at   date,
    arrived_at   date,
    comment      text,
    repair_note  text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   text NOT NULL,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CHECK (packed_at IS NOT NULL OR shipped_at IS NOT NULL OR arrived_at IS NOT NULL)
);
CREATE UNIQUE INDEX shipments_one_open ON shipments (device_id) WHERE arrived_at IS NULL;
CREATE INDEX shipments_device ON shipments (device_id, created_at);

-- ---------- Комплектующие ----------
CREATE TABLE part_types (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX part_types_name ON part_types (lower(name));
INSERT INTO part_types (name) VALUES ('Power supply'), ('FAN'), ('Hash Board'), ('Control Board');

CREATE TABLE parts (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text NOT NULL,
    part_type_id  uuid REFERENCES part_types (id) ON DELETE SET NULL,
    note          text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX parts_name ON parts (lower(name));

-- Приход: поставка комплектующих от поставщика.
CREATE TABLE part_receipts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    received_at  date NOT NULL,
    supplier     text,
    document     text,
    note         text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   text NOT NULL
);
CREATE TABLE part_receipt_lines (
    receipt_id  uuid NOT NULL REFERENCES part_receipts (id) ON DELETE CASCADE,
    part_id     uuid NOT NULL REFERENCES parts (id),
    quantity    integer NOT NULL CHECK (quantity > 0),
    PRIMARY KEY (receipt_id, part_id)
);

-- Расход и возврат: установлено в устройство, снято с устройства (вернулось на склад), списано.
CREATE TABLE part_movements (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    part_id     uuid NOT NULL REFERENCES parts (id),
    action      text NOT NULL CHECK (action IN ('installed', 'removed', 'written_off')),
    quantity    integer NOT NULL CHECK (quantity > 0),
    device_id   uuid REFERENCES devices (id),
    note        text,
    at          timestamptz NOT NULL DEFAULT now(),
    actor       text NOT NULL,
    CHECK (action = 'written_off' OR device_id IS NOT NULL)
);
CREATE INDEX part_movements_part ON part_movements (part_id, at);
CREATE INDEX part_movements_device ON part_movements (device_id, at);
