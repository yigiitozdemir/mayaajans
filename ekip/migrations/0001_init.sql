-- Maya Ajans ekip programı · Aşama 1 şeması

-- Ekip üyeleri. Tek yönetici (role = 'admin'), diğerleri üye.
CREATE TABLE users (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  first_name       TEXT NOT NULL DEFAULT '',
  last_name        TEXT NOT NULL DEFAULT '',
  photo            TEXT,                         -- Aşama 2'de R2 adresine taşınacak
  color            TEXT NOT NULL DEFAULT '#2F6F8F',
  role             TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  can_edit_clients INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'removed')),
  password_hash    TEXT,
  password_salt    TEXT,
  settings         TEXT NOT NULL DEFAULT '{}',   -- {"remindHourly":true,"quietHours":true,...}
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Oturumlar: bir kere giriş, cihazda açık kalır. id = token'ın SHA-256 özeti (token'ın kendisi saklanmaz).
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device       TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Davet / şifre belirleme bağlantıları (tek kullanımlık). id = token özeti.
CREATE TABLE invites (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'invite' CHECK (kind IN ('invite', 'reset')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at    TEXT
);

-- Hatalı giriş denemeleri (kaba kuvvet koruması)
CREATE TABLE login_attempts (
  email TEXT NOT NULL COLLATE NOCASE,
  at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_login_attempts ON login_attempts(email, at);

-- Müşteriler (Slack kanallarından). Aşama 2'de marka kiti alanları eklenecek.
CREATE TABLE clients (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  slack_channel TEXT,
  archived      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- İşler. Teslim tarihi yeni işlerde zorunlu (API'de); Slack'ten gelen eski işlerde boş olabilir.
CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  client       TEXT NOT NULL DEFAULT '',
  assignee_id  TEXT REFERENCES users(id),
  due_date     TEXT,                                   -- YYYY-MM-DD
  status       INTEGER NOT NULL DEFAULT 0 CHECK (status IN (0, 1, 2)),  -- 0 beklemede, 1 devam, 2 tamamlandı
  note         TEXT NOT NULL DEFAULT '',
  items        TEXT NOT NULL DEFAULT '[]',             -- kapsam (JSON dizi)
  link         TEXT NOT NULL DEFAULT '',
  source       TEXT NOT NULL DEFAULT 'app',            -- 'slack' = aktarılan
  created_by   TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX idx_tasks_status_due ON tasks(status, due_date);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);

-- Bildirimler: atama (okunana kadar saatte bir hatırlatılır), çekim, dürtme vb.
CREATE TABLE notifications (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL,
  task_id          TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id         TEXT REFERENCES users(id),
  title            TEXT NOT NULL DEFAULT '',
  body             TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  read_at          TEXT,
  reminders        INTEGER NOT NULL DEFAULT 0,
  last_reminded_at TEXT
);
CREATE INDEX idx_notif_user ON notifications(user_id, read_at);
