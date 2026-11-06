// Profil penceresi: kişinin topladığı rozetler (sayılarıyla) ve son kazanılanlar.
import { useEffect, useState } from 'preact/hooks';
import { api, onLive } from '../api';
import { haftaYazi, birimYazi, type RozetKey, type RozetMeta } from './HaftaninYildizi';
import '../styles/rozet.css';

interface Gecmis {
  userId: string; total: number;
  counts: { badge: RozetKey; count: number; last: string }[];
  recent: { week: string; badge: RozetKey; value: number }[];
  badges: RozetMeta[];
}
const sunday = (w: string) => new Date(Date.parse(w + 'T00:00:00Z') + 6 * 864e5).toISOString().slice(0, 10);

export function RozetRafi() {
  const [g, setG] = useState<Gecmis | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => api<Gecmis>('GET', '/rozetler/kisi/ben').then((x) => { if (alive) { setG(x); setErr(false); } }).catch(() => alive && setErr(true));
    load();
    const off = onLive(['rozet'], load);
    return () => { alive = false; off(); };
  }, []);
  if (err && !g) return null;
  const meta = (k: RozetKey) => g?.badges.find((b) => b.key === k);
  const have = new Map((g?.counts || []).map((c) => [c.badge, c.count]));

  return (
    <section class="rr" aria-label="Rozetlerim">
      <div class="rr-head">
        <span class="rr-title">Rozetlerim</span>
        {g && g.total > 0 && <span class="rr-total">{g.total} rozet</span>}
      </div>
      {!g && <div class="rr-shelf rr-loading" aria-hidden="true">{[0, 1, 2, 3, 4].map(() => <span class="rr-slot" />)}</div>}
      {g && (
        <div class="rr-shelf">
          {g.badges.map((b) => {
            const n = have.get(b.key) || 0;
            return (
              <span class={'rr-slot' + (n ? ' on' : '')} title={n ? `${b.ad} · ${n} kez` : `${b.ad} · henüz yok`} aria-label={n ? `${b.ad}, ${n} kez` : `${b.ad}, henüz yok`}>
                <span class="rr-e" aria-hidden="true">{b.emoji}</span>
                {n > 0 && <span class="rr-x">×{n}</span>}
                <span class="rr-ad">{b.ad}</span>
              </span>
            );
          })}
        </div>
      )}
      {g && g.total === 0 && (
        <p class="rr-empty">Henüz rozetin yok. Rozetler her Cuma 17:00'de dağıtılıyor — bu hafta senin olabilir ✨</p>
      )}
      {g && g.recent.length > 0 && (
        <div class="rr-recent">
          <span class="rr-h">Son kazanılanlar</span>
          {g.recent.slice(0, 4).map((r) => (
            <span class="rr-line">
              <span aria-hidden="true">{meta(r.badge)?.emoji}</span>
              <span class="rr-lad">{meta(r.badge)?.ad}</span>
              <span class="rr-n">{birimYazi(meta(r.badge), r.value)}</span>
              <span class="spacer" />
              <span class="rr-n">{haftaYazi(r.week, sunday(r.week))}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
