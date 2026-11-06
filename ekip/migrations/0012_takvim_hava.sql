-- Paket B: takvim eşitleme (Google / iPhone / Mac aboneliği) ve dış çekimler için hava durumu

-- Kişiye özel takvim aboneliği: adres https://<host>/takvim/<token>.ics
-- token'ın kendisi saklanmaz, yalnızca SHA-256 özeti (token_hash). Yenileyince eskisi anında geçersiz olur.
-- groups: hangi gruplar takvime gider {"shoots":true,"tasks":true,"agenda":true,"special":true}
CREATE TABLE calendar_feeds (
  user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT UNIQUE,                 -- NULL = abonelik kapalı
  groups          TEXT NOT NULL DEFAULT '{"shoots":true,"tasks":true,"agenda":true,"special":true}',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_fetched_at TEXT                         -- takvim uygulaması en son ne zaman çekti
);

-- Dış çekim işareti (hava durumu yalnızca bunlarda gösterilir/uyarılır)
ALTER TABLE shoots ADD COLUMN outdoor INTEGER NOT NULL DEFAULT 0;

-- Open-Meteo önbelleği: key = 'geo:<konum>' (koordinat) ya da 'fc:<enlem>,<boylam>' (saatlik tahmin)
CREATE TABLE weather_cache (
  key        TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- "Yarın yağmur bekleniyor" uyarısı: aynı çekim için günde bir kez
CREATE TABLE weather_alerts (
  shoot_id TEXT NOT NULL,
  day      TEXT NOT NULL,                      -- uyarının gönderildiği İstanbul günü (YYYY-MM-DD)
  sent_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (shoot_id, day)
);
