-- F-03: файлы документа-основания поставки (jpg, png, pdf). Сами файлы лежат в папке FILES_DIR
-- (её можно смонтировать с SMB-шары), в БД — описание и относительный путь.
CREATE TABLE delivery_files (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id   uuid NOT NULL REFERENCES deliveries (id),
    name          text NOT NULL,
    content_type  text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'application/pdf')),
    size          bigint NOT NULL CHECK (size > 0),
    path          text NOT NULL UNIQUE,
    uploaded_by   text NOT NULL,
    uploaded_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX delivery_files_delivery ON delivery_files (delivery_id, uploaded_at);
CREATE TRIGGER delivery_files_no_delete BEFORE DELETE ON delivery_files
    FOR EACH ROW EXECUTE FUNCTION forbid_delete();
