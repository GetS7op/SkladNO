-- D-05: «Состояние» поставки — 4 значения; таможенные только «Прямо с завода».
-- У поставок, созданных до появления поля, состояние не указано.
ALTER TABLE deliveries
    ADD COLUMN condition text CHECK (condition IN ('factory_new', 'slightly_used', 'field_tested', 'battle_hardened'));

-- Идентификаторы устройства: заполняются при загрузке данных устройств в поставку.
ALTER TABLE devices
    ADD COLUMN mac_address text,
    ADD COLUMN serial_no text;
CREATE INDEX devices_mac ON devices (mac_address) WHERE mac_address IS NOT NULL;
CREATE INDEX devices_serial ON devices (serial_no) WHERE serial_no IS NOT NULL;
