-- Paket A: Duyuru panosu + Geri bildirim (Kasım 2026)

-- Duyurular: herkes yazar; yazan ya da yönetici düzenler/siler; yönetici sabitler
CREATE TABLE IF NOT EXISTS duyurular (
  id           TEXT PRIMARY KEY,
  author_id    TEXT NOT NULL REFERENCES users(id),
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  important    INTEGER NOT NULL DEFAULT 0,
  pinned       INTEGER NOT NULL DEFAULT 0,
  reminded_at  TEXT,                                   -- son "okumayanlara hatırlat" zamanı
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  edited_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_duyurular_created ON duyurular (created_at);

-- Kim ne zaman okudu
CREATE TABLE IF NOT EXISTS duyuru_okumalar (
  duyuru_id  TEXT NOT NULL REFERENCES duyurular(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id),
  read_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  PRIMARY KEY (duyuru_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_duyuru_okumalar_user ON duyuru_okumalar (user_id);

-- Geri bildirimler: ekip → yönetici
CREATE TABLE IF NOT EXISTS geri_bildirimler (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL CHECK (kind IN ('hata', 'istek', 'fikir')),
  message     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'yeni' CHECK (status IN ('yeni', 'inceleniyor', 'yapildi', 'olmayacak')),
  page        TEXT NOT NULL DEFAULT '',
  device      TEXT NOT NULL DEFAULT '',
  image_key   TEXT,
  image_type  TEXT,
  image_size  INTEGER,
  reply       TEXT NOT NULL DEFAULT '',
  replied_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_geri_bildirimler_user ON geri_bildirimler (user_id);
CREATE INDEX IF NOT EXISTS idx_geri_bildirimler_created ON geri_bildirimler (created_at);
