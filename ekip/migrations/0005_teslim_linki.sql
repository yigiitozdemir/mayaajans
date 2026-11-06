-- İş tamamlanınca eklenen, bitmiş çalışmanın Drive (ya da başka) linki. İsteğe bağlı.
ALTER TABLE tasks ADD COLUMN done_link TEXT NOT NULL DEFAULT '';
