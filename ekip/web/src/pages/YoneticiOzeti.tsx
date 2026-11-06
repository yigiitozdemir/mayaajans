// Yönetici özeti (yalnızca yönetici): ekibin iş yükü, gecikenler, müşteri başı iş, haftalık trend, dikkat listesi, yedek durumu
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { api, fmtDate, onLive, snack } from '../api';
import { Avatar, Icon, navigate, useStore } from '../ui';
import { Bell } from '../components/Notify';
import '../styles/yonetici.css';

type DonemKey = 'bu-hafta' | 'gecen-hafta' | 'bu-ay' | 'son-30';
const DONEMLER: [DonemKey, string][] = [['bu-hafta', 'Bu hafta'], ['gecen-hafta', 'Geçen hafta'], ['bu-ay', 'Bu ay'], ['son-30', 'Son 30 gün']];
const DONEM_LS = 'maya-yonetici-donem';

interface Person { id: string | null; firstName: string; lastName: string; name: string; color: string; photo: string | null; open: number; late: number; doing: number; done: number; avgDelay: number | null; upcoming: number }
interface Summary {
  today: string; period: { key: DonemKey; label: string; start: string; end: string }; week: { start: string; end: string };
  approvalEnabled: boolean;
  totals: { open: number; late: number; done: number; shoots: number; approval: number | null; special: { pending: number; total: number } };
  people: Person[];
  clients: { name: string; open: number; late: number; done: number; lastShoot: string | null }[];
  trend: { start: string; end: string; count: number }[];
  attention: {
    late: { id: string; title: string; client: string; assigneeId: string | null; dueDate: string; days: number }[];
    unassigned: { id: string; title: string; client: string; dueDate: string | null }[];
    shoots: { id: string; title: string; client: string; date: string; time: string }[];
  };
}
interface Backup { key: string; name: string; size: number; uploaded: string; tables: number; rows: number }
interface Backups { count: number; last: Backup | null; items: Backup[] }

const range = (a: string, b: string) => {
  const [da, db] = [fmtDate(a), fmtDate(b)];
  return a.slice(0, 7) === b.slice(0, 7) ? da.split(' ')[0] + '–' + db : da + ' – ' + db;
};
const fmtSize = (n: number) => (n < 1024 ? n + ' B' : n < 1024 * 1024 ? (n / 1024).toFixed(1).replace('.', ',') + ' KB' : (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB');
const fmtWhen = (iso: string) => new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const ago = (iso: string) => {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 864e5);
  return d <= 0 ? 'bugün' : d === 1 ? 'dün' : d + ' gün önce';
};

export function YoneticiOzeti({ openTask }: { openTask: (id: string) => void }) {
  const s = useStore();
  const [donem, setDonem] = useState<DonemKey>(() => { try { const v = localStorage.getItem(DONEM_LS) as DonemKey; if (DONEMLER.some(([k]) => k === v)) return v; } catch { /* */ } return 'bu-hafta'; });
  const [data, setData] = useState<Summary | null>(null);
  const [err, setErr] = useState('');
  const [backups, setBackups] = useState<Backups | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  async function load(k = donem) {
    const n = ++seq.current;
    try { const d = await api<Summary>('GET', '/admin-summary?donem=' + k); if (n === seq.current) { setData(d); setErr(''); } }
    catch (e: any) { if (n === seq.current) setErr(e.message); }
  }
  async function loadBackups() {
    try { setBackups(await api<Backups>('GET', '/admin-summary/backups')); } catch (e: any) { snack(e.message); }
  }
  useEffect(() => { load(donem); try { localStorage.setItem(DONEM_LS, donem); } catch { /* */ } }, [donem]);
  useEffect(() => { loadBackups(); }, []);
  const latest = useRef(donem); latest.current = donem;
  useEffect(() => onLive(['tasks', 'shoots', 'days'], () => load(latest.current)), []);

  async function backupNow() {
    setBusy(true);
    try { const b = await api<Backup>('POST', '/admin-summary/backup'); snack('Yedek alındı · ' + fmtSize(b.size)); await loadBackups(); }
    catch (e: any) { snack(e.message); }
    finally { setBusy(false); }
  }

  const header = (
    <header class="row" style="align-items:flex-end;justify-content:space-between">
      <div style="display:flex;flex-direction:column;gap:6px">
        <h1 class="h1">Yönetici özeti</h1>
        <span class="row sub" style="gap:6px"><span class="dot" style={{ background: s.online ? 'var(--green-dot)' : 'var(--red)' }} />
          {data ? `${data.period.label} · ${range(data.period.start, data.period.end)} · canlı` : 'Yükleniyor…'}</span>
      </div>
      <div class="row">
        <Bell onOpenTask={openTask} />
        <div class="seg yo-donem" role="group" aria-label="Dönem">
          {DONEMLER.map(([k, l]) => <button type="button" class={donem === k ? 'on' : ''} aria-pressed={donem === k} onClick={() => setDonem(k)}>{l}</button>)}
        </div>
      </div>
    </header>
  );
  if (!data) return <div class="page yo">{header}{err ? <div class="empty">{err}</div> : <div class="empty">Yükleniyor…</div>}</div>;

  const t = data.totals;
  const boxes: { k: string; label: string; v: number | string; sub?: string; dot: string; go?: () => void; warn?: boolean }[] = [
    { k: 'open', label: 'Açık iş', v: t.open, sub: 'beklemede + devam eden', dot: 'var(--blue)', go: () => navigate('/isler') },
    { k: 'late', label: 'Geciken', v: t.late, sub: 'teslim tarihi geçmiş', dot: '#f28482', go: () => navigate('/isler'), warn: t.late > 0 },
    { k: 'done', label: 'Tamamlanan', v: t.done, sub: data.period.label.toLocaleLowerCase('tr'), dot: 'var(--green-dot)' },
    ...(data.approvalEnabled && t.approval !== null ? [{ k: 'approval', label: 'Onay bekleyen', v: t.approval, sub: 'müşteri dönüşü', dot: 'var(--amber)', go: () => navigate('/isler') }] : []),
    { k: 'shoots', label: 'Yapılan çekim', v: t.shoots, sub: data.period.label.toLocaleLowerCase('tr'), dot: 'var(--accent)', go: () => navigate('/cekim') },
    { k: 'special', label: 'Özel gün · bu hafta', v: t.special.pending, sub: t.special.total ? `${t.special.total - t.special.pending}/${t.special.total} hazır` : 'bu hafta görev yok', dot: 'var(--wait)', go: () => navigate('/ozel-gunler') },
  ];
  const maxOpen = Math.max(1, ...data.people.map((p) => p.open));
  const att = data.attention;
  const attCount = att.late.length + att.unassigned.length + att.shoots.length;
  const member = (id: string | null) => s.team.find((m) => m.id === id);

  return (
    <div class="page yo">
      {header}

      <div class="stats yo-stats">
        {boxes.map((b) => {
          const inner = (<>
            <span class="row sub" style="gap:8px;color:var(--mute)"><span class="dot" style={{ background: b.dot }} />{b.label}</span>
            <span class={'v' + (b.warn ? ' yo-warn' : '')}>{b.v}</span>
            {b.sub && <span class="yo-statsub">{b.sub}</span>}
          </>);
          return b.go
            ? <button type="button" class="stat" data-k={b.k} onClick={b.go}>{inner}</button>
            : <div class="stat" data-k={b.k}>{inner}</div>;
        })}
      </div>

      <div class="yo-grid">
        <div class="yo-col">
          <section class="panel yo-card" aria-labelledby="yo-kisi">
            <div class="yo-h"><h2 id="yo-kisi">Kişi bazında</h2><span class="sub">Satıra tıkla → İş Planı</span></div>
            <div class="yo-scroll">
              <table class="yo-table yo-people">
                <thead><tr>
                  <th>Kişi</th><th class="n">Açık</th><th class="n">Geciken</th><th class="n">Devam</th>
                  <th class="n" title={'Tamamlanan · ' + data.period.label}>Biten</th>
                  <th class="n" title="Dönemde biten işler teslim tarihinden ortalama kaç gün sonra bitti">Ort. gecikme</th>
                  <th class="n" title="Bugün dahil 7 gün içinde teslim">7 gün</th>
                  <th class="bar">İş yükü</th>
                </tr></thead>
                <tbody>
                  {data.people.map((p) => (
                    <tr class="yo-tr" tabIndex={0} role="link" aria-label={p.name + ': İş Planı'}
                      onClick={() => navigate('/isler' + (p.id ? '?kisi=' + p.id : ''))} onKeyDown={(e) => { if (e.key === 'Enter') navigate('/isler' + (p.id ? '?kisi=' + p.id : '')); }}>
                      <td><span class="row" style="gap:8px;flex-wrap:nowrap"><Avatar m={p.id ? (member(p.id) || p) : null} size={24} radius={7} /><span class="yo-name">{p.id ? p.firstName : 'Atanmamış'}</span></span></td>
                      <td class="n"><b>{p.open}</b></td>
                      <td class={'n' + (p.late ? ' yo-red' : ' yo-zero')}>{p.late}</td>
                      <td class={'n' + (p.doing ? '' : ' yo-zero')}>{p.doing}</td>
                      <td class={'n' + (p.done ? ' yo-green' : ' yo-zero')}>{p.done}</td>
                      <td class={'n' + (p.avgDelay ? '' : ' yo-zero')}>{p.avgDelay === null ? '—' : p.avgDelay.toLocaleString('tr-TR') + ' g'}</td>
                      <td class={'n' + (p.upcoming ? '' : ' yo-zero')}>{p.upcoming}</td>
                      <td class="bar"><span class="yo-bar" aria-hidden="true"><span class="yo-bar-late" style={{ width: (p.late / maxOpen) * 100 + '%' }} /><span class="yo-bar-open" style={{ width: ((p.open - p.late) / maxOpen) * 100 + '%' }} /></span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div class="yo-legend"><span><i class="yo-sw open" />Açık</span><span><i class="yo-sw late" />Geciken</span></div>
          </section>

          <section class="panel yo-card" aria-labelledby="yo-musteri">
            <div class="yo-h"><h2 id="yo-musteri">Müşteri bazında iş yükü</h2><span class="sub">En çok açık işi olan 10 müşteri</span></div>
            {data.clients.length === 0 ? <div class="empty">Açık işi olan müşteri yok.</div> : (
              <div class="yo-scroll">
                <table class="yo-table yo-clients">
                  <thead><tr><th>Müşteri</th><th class="n">Açık</th><th class="n">Geciken</th><th class="n">Biten</th><th>Son çekim</th></tr></thead>
                  <tbody>
                    {data.clients.map((c) => (
                      <tr>
                        <td class="yo-name">{c.name}</td>
                        <td class="n"><b>{c.open}</b></td>
                        <td class={'n' + (c.late ? ' yo-red' : ' yo-zero')}>{c.late}</td>
                        <td class={'n' + (c.done ? ' yo-green' : ' yo-zero')}>{c.done}</td>
                        <td class={c.lastShoot ? '' : 'yo-zero'}>{c.lastShoot ? fmtDate(c.lastShoot) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section class="panel yo-card" aria-labelledby="yo-trend">
            <div class="yo-h"><h2 id="yo-trend">Haftalık tamamlanan iş</h2><span class="sub">Son 8 hafta</span></div>
            <Trend data={data.trend} />
          </section>
        </div>

        <div class="yo-col">
          <section class="panel yo-card" aria-labelledby="yo-dikkat">
            <div class="yo-h"><h2 id="yo-dikkat">Dikkat</h2><span class="sub">{attCount ? attCount + ' konu' : 'Her şey yolunda'}</span></div>
            <AttGroup title="7 günden fazla geciken" count={att.late.length} empty="7 günden fazla geciken iş yok.">
              {att.late.map((x) => (
                <button type="button" class="yo-att" onClick={() => openTask(x.id)}>
                  <span class="t"><span class="tt">{x.title}</span><span class="ts">{(x.client || '—') + ' · ' + (member(x.assigneeId)?.firstName || 'Atanmamış')}</span></span>
                  <span class="tag late">{x.days} gün</span>
                </button>
              ))}
            </AttGroup>
            <AttGroup title="Sorumlusu olmayan açık işler" count={att.unassigned.length} empty="Her açık işin sorumlusu var.">
              {att.unassigned.map((x) => (
                <button type="button" class="yo-att" onClick={() => openTask(x.id)}>
                  <span class="t"><span class="tt">{x.title}</span><span class="ts">{x.client || '—'}</span></span>
                  <span class="tag far">{x.dueDate ? fmtDate(x.dueDate) : 'Tarih yok'}</span>
                </button>
              ))}
            </AttGroup>
            <AttGroup title={'Tarihi geçmiş, hâlâ “Planlandı” çekimler'} count={att.shoots.length} empty="Tarihi geçmiş planlı çekim yok.">
              {att.shoots.map((x) => (
                <button type="button" class="yo-att" onClick={() => navigate('/cekim?id=' + x.id)}>
                  <span class="t"><span class="tt">{x.title}</span><span class="ts">{x.client || '—'}</span></span>
                  <span class="tag late">{fmtDate(x.date)}</span>
                </button>
              ))}
            </AttGroup>
          </section>

          <section class="panel yo-card" aria-labelledby="yo-yedek">
            <div class="yo-h"><h2 id="yo-yedek">Veritabanı yedeği</h2><span class="sub">Her pazartesi 03:17</span></div>
            {!backups ? <div class="empty">Yükleniyor…</div> : (<>
              <div class="yo-bk">
                <div><span class="yo-k">Son yedek</span><b>{backups.last ? fmtWhen(backups.last.uploaded) : 'Henüz yok'}</b>{backups.last && <span class="yo-statsub">{ago(backups.last.uploaded)}</span>}</div>
                <div><span class="yo-k">Boyut</span><b>{backups.last ? fmtSize(backups.last.size) : '—'}</b>{backups.last && <span class="yo-statsub">{backups.last.rows} satır</span>}</div>
                <div><span class="yo-k">Saklanan</span><b>{backups.count}</b><span class="yo-statsub">en fazla 12</span></div>
              </div>
              <button type="button" class="btn primary" disabled={busy} onClick={backupNow}><Icon n="save" size={16} />{busy ? 'Yedek alınıyor…' : 'Şimdi yedek al'}</button>
              {backups.items.length > 0 && (
                <ul class="yo-bklist">
                  {backups.items.map((b) => (
                    <li>
                      <span class="t"><span class="tt">{fmtWhen(b.uploaded)}</span><span class="ts">{fmtSize(b.size)} · {b.tables} tablo · {b.rows} satır</span></span>
                      <a class="btn sm" href={'/api/admin-summary/backup/' + encodeURIComponent(b.name)} download={'maya-ekip-' + b.name} aria-label={fmtWhen(b.uploaded) + ' yedeğini indir'}>İndir</a>
                    </li>
                  ))}
                </ul>
              )}
              <p class="yo-note">Yalnızca veritabanı yedeklenir (işler, müşteriler, çekimler, sohbet yazıları…). Logolar ve sohbet dosyaları ayrı depoda durur, bu yedekte yoktur. Oturumlar ve davet bağlantıları yedeklenmez.</p>
            </>)}
          </section>
        </div>
      </div>
    </div>
  );
}

function AttGroup({ title, count, empty, children }: { title: string; count: number; empty: string; children: ComponentChildren }) {
  return (
    <div class="yo-attg">
      <h3>{title} <span>{count}</span></h3>
      {count === 0 ? <div class="yo-ok"><Icon n="check" size={14} w={2.4} />{empty}</div> : <div class="yo-attl">{children}</div>}
    </div>
  );
}

/** Son 8 haftanın tamamlanan iş sayısı: tek seri, sade çubuk grafik (inline SVG). */
function Trend({ data }: { data: Summary['trend'] }) {
  // genişlik kaba göre ölçülür: telefonda yazılar küçülmesin
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(560);
  useEffect(() => {
    const el = box.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(Math.max(300, Math.round(el.clientWidth))));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const H = 210, L = 30, R = 6, T = 22, B = 34;
  const max = Math.max(...data.map((d) => d.count));
  const step = max <= 4 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : Math.ceil(max / 50) * 10;
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks: number[] = []; for (let v = 0; v <= top; v += step) ticks.push(v);
  const pw = (W - L - R) / data.length;
  const bw = Math.min(40, pw * 0.56);
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div class="yo-trend" ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={'Son 8 haftada tamamlanan iş: ' + data.map((d) => fmtDate(d.start) + ' haftası ' + d.count).join(', ')}>
        {ticks.map((v) => (
          <g>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} class={v === 0 ? 'yo-axis' : 'yo-grid'} />
            <text x={L - 8} y={y(v) + 4} text-anchor="end" class="yo-tick">{v}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = L + pw * i + (pw - bw) / 2;
          const h = Math.max(0, y(0) - y(d.count));
          const r = Math.min(4, h / 2);
          const cur = i === data.length - 1;
          const path = h > 0 ? `M${x},${y(0)} V${y(0) - h + r} Q${x},${y(0) - h} ${x + r},${y(0) - h} H${x + bw - r} Q${x + bw},${y(0) - h} ${x + bw},${y(0) - h + r} V${y(0)} Z` : '';
          return (
            <g class={'yo-col-g' + (hover === i ? ' on' : '')} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={L + pw * i} y={T - 18} width={pw} height={H - T - B + 18} fill="transparent" />
              {path && <path d={path} class={'yo-barm' + (cur ? ' cur' : '')} />}
              <text x={x + bw / 2} y={y(d.count) - 6} text-anchor="middle" class="yo-val">{d.count}</text>
              <text x={x + bw / 2} y={H - B + 16} text-anchor="middle" class="yo-tick">{fmtDate(d.start)}</text>
              {cur && <text x={x + bw / 2} y={H - B + 29} text-anchor="middle" class="yo-tick">bu hafta</text>}
              <title>{range(d.start, d.end)}: {d.count} iş tamamlandı{cur ? ' (hafta sürüyor)' : ''}</title>
            </g>
          );
        })}
      </svg>
      <table class="sr">
        <caption>Haftalık tamamlanan iş</caption>
        <thead><tr><th>Hafta</th><th>Tamamlanan</th></tr></thead>
        <tbody>{data.map((d) => <tr><td>{range(d.start, d.end)}</td><td>{d.count}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
