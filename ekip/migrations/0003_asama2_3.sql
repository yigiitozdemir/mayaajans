-- Aşama 2–3: Müşteriler (marka kiti, logolar), Özel Günler, Çekim Planı, Sohbet, Dürtme

-- Müşteri marka kiti: { sector, owner, colors:[{hex,name}], fonts:[{name,use}], tone:[], banned:[],
--   tagSets:[{name,tags}], links:{instagram,facebook,web,drive,...}, notes:[{id,text,by,at}] }
ALTER TABLE clients ADD COLUMN kit TEXT NOT NULL DEFAULT '{}';
ALTER TABLE clients ADD COLUMN updated_at TEXT;

-- Logolar ve marka dosyaları (R2: clients/<client_id>/<file_id>/<ad>)
CREATE TABLE client_files (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  variant TEXT NOT NULL,                 -- Renkli, Beyaz, Siyah, Yatay, Dikey, İkon, Diğer…
  name TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX client_files_client ON client_files(client_id);

-- Özel günler: gün → firmalar (tek tek seçilir) → sorumlu (kullanıcı atar) → Hazırladım
CREATE TABLE special_days (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  star INTEGER NOT NULL DEFAULT 0,       -- önemli gün
  tone TEXT NOT NULL DEFAULT 'bilgi',    -- anma | kutlama | bilgi | kampanya
  note TEXT NOT NULL DEFAULT '',
  range_label TEXT,                      -- "3–9 Kasım" gibi
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX special_days_date ON special_days(date);

CREATE TABLE special_day_rows (
  day_id TEXT NOT NULL REFERENCES special_days(id) ON DELETE CASCADE,
  client TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'Story',  -- Story | Post | Reels | Video
  lang TEXT NOT NULL DEFAULT 'TR',
  assignee_id TEXT REFERENCES users(id),
  status INTEGER NOT NULL DEFAULT 0,     -- 0 Bekliyor · 1 Hazırlanıyor · 2 Hazırlandı
  done_by TEXT REFERENCES users(id),
  done_at TEXT,
  task_id TEXT,                          -- İş Planı'na gönderildiyse
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (day_id, client)
);

-- Çekim planı (tarih zorunlu). Durum: 0 Planlandı · 1 Tamamlandı · 2 İptal
CREATE TABLE shoots (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  client TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  time TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  status INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  crew TEXT NOT NULL DEFAULT '[]',       -- kullanıcı id listesi
  checks TEXT NOT NULL DEFAULT '[]',     -- [{text, done}]
  source TEXT NOT NULL DEFAULT 'app',
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  reminded_for TEXT                      -- "yarın çekim var" hatırlatması gönderilen tarih
);
CREATE INDEX shoots_date ON shoots(date);

-- Sohbet: genel kanallar, müşteri kanalları, birebir mesajlar
CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('general', 'client', 'dm')),
  topic TEXT NOT NULL DEFAULT '',
  client_id TEXT REFERENCES clients(id),
  dm_key TEXT UNIQUE,                    -- birebir: "u_a|u_b" (sıralı)
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  text TEXT NOT NULL DEFAULT '',
  file_key TEXT, file_name TEXT, file_type TEXT, file_size INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  edited_at TEXT,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX messages_channel ON messages(channel_id, created_at);

CREATE TABLE channel_reads (
  user_id TEXT NOT NULL REFERENCES users(id),
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  last_read_at TEXT NOT NULL,
  PRIMARY KEY (user_id, channel_id)
);

-- Dürtme
CREATE TABLE nudges (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES users(id),
  to_id TEXT NOT NULL REFERENCES users(id),
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX nudges_to ON nudges(to_id, created_at);

-- Bildirim tıklanınca açılacak sayfa (ör. /cekim?id=…)
ALTER TABLE notifications ADD COLUMN link TEXT;
