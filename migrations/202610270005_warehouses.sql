-- Склады становятся справочником: имя и маска INDEX (префикс из цифр + X, всего 7 знаков).
-- Маска задаёт диапазон INDEX для поставок на склад: 9XXXXXX → 9000000–9999999.
-- Код склада — внутренний ключ: у «Парка» и «Мастерской» прежние park/workshop, у новых — w<префикс>.
CREATE TABLE warehouses (
    code         text PRIMARY KEY,
    name         text NOT NULL,
    index_mask   text NOT NULL UNIQUE CHECK (index_mask ~ '^[0-9]{1,6}X{1,6}$' AND length(index_mask) = 7),
    first_value  integer NOT NULL,
    next_value   integer NOT NULL,
    max_value    integer NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CHECK (first_value <= next_value AND next_value <= max_value + 1),
    -- Диапазоны складов не пересекаются: один INDEX не может принадлежать двум складам.
    EXCLUDE USING gist (int4range(first_value, max_value, '[]') WITH &&)
);
CREATE UNIQUE INDEX warehouses_name ON warehouses (lower(name));

-- «Парк» сужается с 0000001–8999999 до маски 0XXXXXX (0000001–0999999), чтобы освободить
-- префиксы 1–8 для новых складов. Если INDEX Парка уже вышли за 0999999, миграция остановится.
DO $$
BEGIN
    IF (SELECT next_value FROM index_ranges WHERE destination = 'park') > 1000000 THEN
        RAISE EXCEPTION 'INDEX Парка уже больше 0999999 — маска 0XXXXXX не подходит';
    END IF;
END $$;

INSERT INTO warehouses (code, name, index_mask, first_value, next_value, max_value)
SELECT 'park', 'Парк', '0XXXXXX', 1, next_value, 999999 FROM index_ranges WHERE destination = 'park'
UNION ALL
SELECT 'workshop', 'Мастерская', '9XXXXXX', 9000000, next_value, 9999999 FROM index_ranges WHERE destination = 'workshop';

DROP TABLE index_ranges;

ALTER TABLE deliveries DROP CONSTRAINT deliveries_destination_check,
    ADD CONSTRAINT deliveries_destination_fkey FOREIGN KEY (destination) REFERENCES warehouses (code);
ALTER TABLE devices DROP CONSTRAINT devices_destination_check,
    ADD CONSTRAINT devices_destination_fkey FOREIGN KEY (destination) REFERENCES warehouses (code);
-- «Расположение» модуля теперь склад: текстовое поле убирается (прежние значения остаются в журнале).
ALTER TABLE modules DROP CONSTRAINT modules_warehouse_check,
    ADD CONSTRAINT modules_warehouse_fkey FOREIGN KEY (warehouse) REFERENCES warehouses (code),
    DROP COLUMN location;
