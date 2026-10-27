-- Настройки системы. D-06: разделитель в адресе места MXCXSXP «задаётся в настройках»,
-- по умолчанию латинская «X».
CREATE TABLE settings (
    key         text PRIMARY KEY,
    value       text NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO settings (key, value) VALUES ('address_separator', 'X');

-- Адрес полки собирается в одном месте: смена разделителя сразу действует во всех ответах.
-- STRICT: у неразмещённого устройства (NULL в номерах) адреса нет — NULL, а не пустая строка.
CREATE FUNCTION skladno_address(module integer, container integer, rack integer, shelf integer)
RETURNS text LANGUAGE sql STABLE STRICT AS $$
    SELECT concat_ws(
        COALESCE((SELECT value FROM settings WHERE key = 'address_separator'), 'X'),
        module, container, rack, shelf)
$$;
