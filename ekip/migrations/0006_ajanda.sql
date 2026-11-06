-- Ajandam: kişiye özel notlar (ekran görüntüleriyle), yapılacaklar, takvim etkinlikleri ve anımsatıcılar.
-- Her satır yalnızca sahibine (user_id) görünür.
--
-- Anımsatıcı alanları (yapılacak ve etkinlikte aynı):
--   remind_offset  dakika: 0 zamanında · 10 · 60 · 1440 önce (tarih/saate göre hesaplanır)  — ya da NULL
--   remind_local   'YYYY-MM-DDTHH:MM' İstanbul saati, tam zaman seçildiyse                   — ya da NULL
--   remind_base    tekrarın dayandığı (sıradaki) zaman, UTC 'YYYY-MM-DD HH:MM:SS'
--   remind_at      bir sonraki gönderim zamanı (ertelenince değişir), UTC; NULL = bekleyen yok
--   fired_at       son gönderim zamanı (sayfadaki "Çaldı" listesi için; Kapat ile temizlenir)
--   repeat         none | daily | weekdays | weekly | monthly

CREATE TABLE agenda_notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'work' CHECK (kind IN ('work', 'personal')),
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  client_id TEXT,
  checks TEXT NOT NULL DEFAULT '[]',     -- [{id, text, done}]
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE INDEX agenda_notes_user ON agenda_notes(user_id, updated_at);

-- R2: personal/<user_id>/<note_id>/<file_id>-<güvenli-ad>
CREATE TABLE agenda_files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  note_id TEXT NOT NULL REFERENCES agenda_notes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX agenda_files_note ON agenda_files(note_id);

CREATE TABLE agenda_todos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  due_date TEXT,                         -- YYYY-MM-DD (isteğe bağlı)
  due_time TEXT,                         -- HH:MM İstanbul (isteğe bağlı)
  star INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  task_id TEXT,                          -- İş Planı'na dönüştürüldüyse
  repeat TEXT NOT NULL DEFAULT 'none',
  remind_offset INTEGER,
  remind_local TEXT,
  remind_base TEXT,
  remind_at TEXT,
  fired_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX agenda_todos_user ON agenda_todos(user_id, done, due_date);
CREATE INDEX agenda_todos_remind ON agenda_todos(remind_at) WHERE remind_at IS NOT NULL;

CREATE TABLE agenda_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  date TEXT NOT NULL,                    -- YYYY-MM-DD
  start_time TEXT NOT NULL DEFAULT '',   -- HH:MM İstanbul ('' = tüm gün)
  end_time TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  repeat TEXT NOT NULL DEFAULT 'none',   -- etkinlik bu sıklıkla tekrarlanır (takvimde de görünür)
  remind_offset INTEGER,
  remind_local TEXT,
  remind_base TEXT,
  remind_at TEXT,
  fired_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX agenda_events_user ON agenda_events(user_id, date);
CREATE INDEX agenda_events_remind ON agenda_events(remind_at) WHERE remind_at IS NOT NULL;
