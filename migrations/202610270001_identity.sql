-- SkladNO, этап 3: пользователи, сессии, приглашения (сквозная тема «Пользователи и роли»).

CREATE TABLE users (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    login          text NOT NULL CHECK (login ~ '^[A-Za-z0-9_.-]{3,40}$'),
    last_name      text NOT NULL CHECK (btrim(last_name) <> ''),
    first_name     text NOT NULL CHECK (btrim(first_name) <> ''),
    middle_name    text NOT NULL CHECK (btrim(middle_name) <> ''),
    email          text NOT NULL CHECK (email LIKE '%_@_%'),
    telegram       text,
    password_hash  text NOT NULL,
    role           text NOT NULL CHECK (role IN ('operator', 'senior', 'admin')),
    active         boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),
    last_login_at  timestamptz
);
CREATE UNIQUE INDEX users_login_unique ON users (lower(login));
CREATE TRIGGER users_no_delete BEFORE DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION forbid_delete();

-- В БД хранится только SHA-256 токена: утечка таблицы не даёт войти.
CREATE TABLE sessions (
    token_hash   text PRIMARY KEY,
    user_id      uuid NOT NULL REFERENCES users (id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

-- Приглашение: роль + срок действия (NULL — бессрочно), одноразовое.
CREATE TABLE invites (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash  text NOT NULL UNIQUE,
    role        text NOT NULL CHECK (role IN ('operator', 'senior', 'admin')),
    note        text,
    expires_at  timestamptz,
    created_by  uuid NOT NULL REFERENCES users (id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    used_by     uuid REFERENCES users (id),
    used_at     timestamptz,
    revoked_at  timestamptz
);
