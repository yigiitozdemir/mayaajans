-- Paket C: Kriz anı kayıtları + İlham panosu (moodboard).
-- Müşteri bağlantısı işlerdeki gibi ADLA tutulur (tasks.client ile aynı yol): clients.name.

-- ---------- kriz kayıtları ----------
--   source   instagram | google | dm | telefon | paylasim | diger
--   priority dusuk | orta | yuksek | acil
--   status   acik | mudahale | cozuldu
CREATE TABLE crises (
  id           TEXT PRIMARY KEY,
  client       TEXT NOT NULL,
  title        TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'diger' CHECK (source IN ('instagram', 'google', 'dm', 'telefon', 'paylasim', 'diger')),
  link         TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  priority     TEXT NOT NULL DEFAULT 'orta' CHECK (priority IN ('dusuk', 'orta', 'yuksek', 'acil')),
  status       TEXT NOT NULL DEFAULT 'acik' CHECK (status IN ('acik', 'mudahale', 'cozuldu')),
  owner_id     TEXT REFERENCES users(id),
  resolution   TEXT NOT NULL DEFAULT '',
  created_by   TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at  TEXT,
  resolved_by  TEXT REFERENCES users(id)
);
CREATE INDEX crises_status ON crises(status, created_at);
CREATE INDEX crises_client ON crises(client COLLATE NOCASE, created_at);

-- zaman çizelgesi: kim ne zaman ne yaptı / yazdı
--   kind created | status | note | edit | owner | priority | file
CREATE TABLE crisis_events (
  id         TEXT PRIMARY KEY,
  crisis_id  TEXT NOT NULL REFERENCES crises(id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES users(id),
  kind       TEXT NOT NULL,
  text       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX crisis_events_crisis ON crisis_events(crisis_id, created_at);

-- ekran görüntüleri (R2: krizler/<crisis_id>/<file_id>.<uzantı>)
CREATE TABLE crisis_files (
  id           TEXT PRIMARY KEY,
  crisis_id    TEXT NOT NULL REFERENCES crises(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  r2_key       TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  created_by   TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX crisis_files_crisis ON crisis_files(crisis_id);

-- ---------- ilham panosu ----------
--   client '' = Genel pano (ajansın kendi ilhamı), aksi hâlde clients.name
--   kind   image (R2: ilham/<pano>/<id>.<uzantı>) | link (önizlemesiz kart)
--   site   link kartının türü: instagram | pinterest | behance | web
CREATE TABLE inspirations (
  id           TEXT PRIMARY KEY,
  client       TEXT NOT NULL DEFAULT '',
  kind         TEXT NOT NULL CHECK (kind IN ('image', 'link')),
  r2_key       TEXT,
  content_type TEXT,
  size         INTEGER NOT NULL DEFAULT 0,
  width        INTEGER,
  height       INTEGER,
  url          TEXT NOT NULL DEFAULT '',
  site         TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  tags         TEXT NOT NULL DEFAULT '[]',
  created_by   TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX inspirations_client ON inspirations(client COLLATE NOCASE, created_at);
