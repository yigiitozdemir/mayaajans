-- İçerik onay takibi: Hazırlanıyor ('') → Onaya gönderildi ('sent') → Revize istendi ('revision') → Onaylandı ('approved') → Paylaşıldı ('published')
-- Müşteri programı kullanmaz; adımları ekip işaretler. Mevcut status (0/1/2) aynen kalır, onay adımı ona göre günceller (src/index.ts).
ALTER TABLE tasks ADD COLUMN approval TEXT NOT NULL DEFAULT '' CHECK (approval IN ('', 'sent', 'revision', 'approved', 'published'));
ALTER TABLE tasks ADD COLUMN approval_at TEXT;            -- son onay adımı değişikliği (UTC)
ALTER TABLE tasks ADD COLUMN sent_at TEXT;                -- son "Onaya gönderildi" zamanı (UTC)
ALTER TABLE tasks ADD COLUMN revisions INTEGER NOT NULL DEFAULT 0;  -- kaç kez revize istendi
ALTER TABLE tasks ADD COLUMN approval_reminded_at TEXT;   -- son "müşteri onayı bekleniyor" hatırlatması (günde en fazla bir)
CREATE INDEX idx_tasks_approval ON tasks(approval, sent_at);

-- Onay geçmişi: her adım bir satır (kim, ne zaman); revize notları step = 'revision' satırlarında.
-- prev: adımdan önceki iş durumu (JSON) — "Geri al" bunu geri yükler ve satırı siler.
CREATE TABLE task_revisions (
  id      TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  step    TEXT NOT NULL,
  note    TEXT NOT NULL DEFAULT '',
  by_user TEXT REFERENCES users(id),
  at      TEXT NOT NULL DEFAULT (datetime('now')),
  prev    TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_task_revisions_task ON task_revisions(task_id, at);
