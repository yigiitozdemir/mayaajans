-- Haftanın yıldızı ve rozetler (Paket D). Hafta = Pazartesi–Pazar (İstanbul); week = o haftanın Pazartesi tarihi (YYYY-MM-DD).
-- Rozetler Cuma 17:00'de (İstanbul) verilir; badge_weeks satırı haftanın bir kez işlendiğini işaretler (aynı hafta iki kez verilmez).
CREATE TABLE badge_weeks (
  week       TEXT PRIMARY KEY,
  awarded_at TEXT NOT NULL DEFAULT (datetime('now')),
  stats      TEXT NOT NULL DEFAULT '{}'      -- o anki haftalık ölçüler (JSON): { u_pelin: { done, onTime, late, approved, shoots, days } }
);

-- badge: yildiz (en çok iş) · dakik (≥3 iş, hepsi zamanında) · onay (ilk seferde onay) · cekim (en çok çekim) · seri (her iş günü)
CREATE TABLE badges (
  id         TEXT PRIMARY KEY,
  week       TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge      TEXT NOT NULL,
  value      INTEGER NOT NULL DEFAULT 0,     -- rozetin sayısı (12 iş, 4 çekim, 5 gün…)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (week, user_id, badge)
);
CREATE INDEX idx_badges_user ON badges(user_id, week);
CREATE INDEX idx_badges_week ON badges(week);
