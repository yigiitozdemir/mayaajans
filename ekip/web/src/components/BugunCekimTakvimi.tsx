// Bugün sayfasında küçük çekim takvimi (Çekim Planı'ndaki takvimin aynısı, küçük hali) + seçili günün / yaklaşan çekimler.
// Yalnızca çekimleri yakından takip eden kişilerde görünür (CEKIM_TAKVIMI_KISILER).
import { useEffect, useState } from 'preact/hooks';
import { api, onLive, todayIso, LMON, LDAY, parseD } from '../api';
import { Icon, Link, navigate, useStore } from '../ui';
import { ClientMark, findClient } from './ClientMark';
import { type Shoot, STATUS, MonthCal, CrewStack, byWhenAsc, isLate } from './CekimPanels';
import '../styles/cekim.css';

/** Bugün sayfasında çekim takvimini görenler: Yiğit, Emre, Volkan. */
export const CEKIM_TAKVIMI_KISILER = ['u_yigit', 'u_emre', 'u_volkan'];

export function BugunCekimTakvimi() {
  const s = useStore();
  const goster = !!s.me && CEKIM_TAKVIMI_KISILER.includes(s.me.id);
  const today = todayIso();
  const [shoots, setShoots] = useState<Shoot[] | null>(null);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState<string | null>(null);

  useEffect(() => {
    if (!goster) return;
    let alive = true;
    const load = () => api<Shoot[]>('GET', '/shoots').then((x) => alive && setShoots(x)).catch(() => alive && setShoots((y) => y || []));
    load();
    const off = onLive(['shoots', '*'], load);
    return () => { alive = false; off(); };
  }, [goster]);

  if (!goster || !shoots) return null;
  const aktif = shoots.filter((x) => x.status !== 2); // iptaller takvimde yok
  const liste = day
    ? aktif.filter((x) => x.date === day).sort(byWhenAsc)
    : aktif.filter((x) => x.status === 0 && x.date >= today).sort(byWhenAsc).slice(0, 5);
  const gunYazi = (ds: string) => { const d = parseD(ds); return ds === today ? 'Bugün' : d.getDate() + ' ' + LMON[d.getMonth()] + ' ' + LDAY[d.getDay()]; };

  return (
    <section class="card bct" aria-label="Çekim takvimi">
      <div class="bct-h">
        <span class="bct-ic" aria-hidden="true"><Icon n="cam" size={15} /></span>
        <h2>Çekim takvimi</h2>
        <span class="spacer" />
        <Link href="/cekim" class="sub">Çekim Planı</Link>
      </div>
      <div class="bct-ic-g">
        <MonthCal month={month} setMonth={setMonth} shoots={aktif} day={day} onPick={(d) => setDay(day === d ? null : d)} />
        <div class="bct-list">
          <div class="bct-lh">
            <span>{day ? gunYazi(day) : 'Yaklaşan çekimler'}</span>
            {day && <button type="button" class="btn sm ghost" onClick={() => setDay(null)}>Yaklaşanlar</button>}
          </div>
          {liste.map((x) => {
            const c = findClient(s.clients, x.client);
            return (
              <button type="button" class={'bct-it' + (isLate(x) ? ' late' : '')} onClick={() => navigate('/cekim?id=' + x.id)}>
                <span class="bct-when"><b>{x.time && /\d/.test(x.time) ? x.time.slice(0, 5) : '—'}</b><span>{day ? '' : gunYazi(x.date)}</span></span>
                <span class="bct-t">
                  <span class="bct-tt">{x.title}</span>
                  <span class="bct-sub">{c && <ClientMark name={x.client} size={16} />}{[x.client, x.location].filter(Boolean).join(' · ') || STATUS[x.status].label}</span>
                </span>
                {x.crew.length > 0 && <CrewStack ids={x.crew} size={22} />}
              </button>
            );
          })}
          {liste.length === 0 && <p class="empty" style="padding:10px 2px">{day ? 'Bu gün çekim yok.' : 'Yaklaşan çekim yok.'}</p>}
        </div>
      </div>
    </section>
  );
}
