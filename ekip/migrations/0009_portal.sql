-- Müşteri portalı (ilk: Vatan Hastanesi içerik onayı). Misafirler ekip üyesi DEĞİLDİR: ayrı tablo, ayrı oturum;
-- ekip verisine (işler, sohbet, ekip listesi…) hiçbir erişimleri yoktur.
CREATE TABLE guests (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  first_name    TEXT NOT NULL DEFAULT '',
  last_name     TEXT NOT NULL DEFAULT '',
  client        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'removed')),
  password_hash TEXT,
  password_salt TEXT,
  last_login_at TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE guest_sessions (
  id           TEXT PRIMARY KEY,
  guest_id     TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  device       TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL
);
CREATE INDEX idx_guest_sessions ON guest_sessions(guest_id);
CREATE TABLE guest_invites (
  id         TEXT PRIMARY KEY,
  guest_id   TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- portalı ekipten kimler görür/düzenler (yönetici her zaman)
CREATE TABLE portal_members (
  client  TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (client, user_id)
);
INSERT OR IGNORE INTO portal_members (client, user_id) SELECT 'vatan', id FROM users WHERE email = 'pelin@mayaajans.net';

CREATE TABLE portal_items (
  id          TEXT PRIMARY KEY,
  client      TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('content', 'request')),
  no          INTEGER NOT NULL,
  title       TEXT NOT NULL,
  link        TEXT NOT NULL DEFAULT '',
  plan_date   TEXT,                       -- içerik: paylaşım için planlanan tarih
  given_date  TEXT,                       -- talep: işin verildiği tarih
  due_date    TEXT,                       -- talep: teslim tarihi
  date_text   TEXT NOT NULL DEFAULT '',   -- tarih yerine yazı ("1–30 Kasım")
  description TEXT NOT NULL DEFAULT '',   -- içerik: Maya Ajans açıklaması · talep: not
  status      TEXT NOT NULL,
  created_by_kind TEXT NOT NULL DEFAULT 'team' CHECK (created_by_kind IN ('team', 'guest', 'import')),
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
);
CREATE INDEX idx_portal_items ON portal_items(client, kind, deleted_at);
CREATE TABLE portal_notes (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES portal_items(id) ON DELETE CASCADE,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('team', 'guest', 'import')),
  author_id   TEXT,
  author_name TEXT NOT NULL,
  action      TEXT NOT NULL DEFAULT 'note' CHECK (action IN ('note', 'approve', 'revise', 'status')),
  body        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_portal_notes ON portal_notes(item_id, created_at);
