-- Drive önizlemeleri için kısa süreli önbellek (Google Drive API isteklerini azaltır).
CREATE TABLE IF NOT EXISTS drive_cache (
  anahtar TEXT PRIMARY KEY,           -- 'klasor:<id>' / 'dosya:<id>'
  veri    TEXT NOT NULL,              -- JSON (önizleme ya da hata)
  at      TEXT NOT NULL DEFAULT (datetime('now'))
);
