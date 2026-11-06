-- Akıllı geç kalma uyarısı: teslimi yaklaşan, hâlâ başlanmamış işler. Değer: '<due_date>:<aşama>' (1 = sorumluya, 2 = sorumlu + yönetici).
-- Teslim tarihi değişirse önek tutmaz, uyarı yeniden başlar.
ALTER TABLE tasks ADD COLUMN gecikme_uyari TEXT;
