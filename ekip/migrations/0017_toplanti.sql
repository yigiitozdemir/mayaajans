-- Toplantılar: müşteri (firma) toplantıları, tarih/saat, katılımcılar, gündem; sonrasında notlar, kararlar,
-- aksiyon maddeleri (İş Planı'na aktarılabilir), ses kayıtları ve dosyalar (R2).
-- Müşteri bağlantısı işlerdeki gibi ADLA tutulur (tasks.client ile aynı yol). Serbest metin de olabilir.

--   type    yuzyuze | online | telefon
--   status  planlandi | yapildi | ertelendi | iptal
--   participants  JSON: ekip üyesi id'leri  ["u_pelin", …]
--   agenda        JSON: [{ "text": "…", "done": false }]
--   decisions     JSON: ["…"]
--   reminded_for  30 dk önce hatırlatması gönderilen '<date> <start_time>' (tarih/saat değişirse sıfırlanır)
CREATE TABLE meetings (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  client           TEXT NOT NULL DEFAULT '',
  date             TEXT NOT NULL,
  start_time       TEXT NOT NULL,
  end_time         TEXT NOT NULL DEFAULT '',
  type             TEXT NOT NULL DEFAULT 'yuzyuze' CHECK (type IN ('yuzyuze', 'online', 'telefon')),
  location         TEXT NOT NULL DEFAULT '',
  link             TEXT NOT NULL DEFAULT '',
  participants     TEXT NOT NULL DEFAULT '[]',
  client_attendees TEXT NOT NULL DEFAULT '',
  agenda           TEXT NOT NULL DEFAULT '[]',
  status           TEXT NOT NULL DEFAULT 'planlandi' CHECK (status IN ('planlandi', 'yapildi', 'ertelendi', 'iptal')),
  notes            TEXT NOT NULL DEFAULT '',
  decisions        TEXT NOT NULL DEFAULT '[]',
  reminded_for     TEXT,
  created_by       TEXT REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX meetings_date ON meetings(date, start_time);
CREATE INDEX meetings_client ON meetings(client COLLATE NOCASE, date);

-- aksiyon maddeleri: sorumlu + teslim tarihi isteğe bağlı; "İş Planı'na ekle" ile gerçek iş açılınca task_id dolar
CREATE TABLE meeting_actions (
  id          TEXT PRIMARY KEY,
  meeting_id  TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  assignee_id TEXT REFERENCES users(id),
  due_date    TEXT,
  done        INTEGER NOT NULL DEFAULT 0,
  task_id     TEXT,
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX meeting_actions_meeting ON meeting_actions(meeting_id, created_at);

-- ses kayıtları ve dosyalar (R2: toplantilar/<meeting_id>/<file_id>.<uzantı>)
--   kind ses | dosya
CREATE TABLE meeting_files (
  id           TEXT PRIMARY KEY,
  meeting_id   TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('ses', 'dosya')),
  name         TEXT NOT NULL,
  r2_key       TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  duration_s   INTEGER,
  created_by   TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX meeting_files_meeting ON meeting_files(meeting_id, created_at);
