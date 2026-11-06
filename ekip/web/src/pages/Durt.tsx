// Dürtme: ekipten birinin dikkatini çek (karşı tarafta ses + ekran titremesi + Mac bildirimi)
import { useEffect, useState } from 'preact/hooks';
import { api, loadMe, MON, onLive, snack, store, type Member } from '../api';
import { Avatar, Icon, Switch, useStore } from '../ui';
import { Bell } from '../components/Notify';
import { cooldownLeft, NUDGE_COOLDOWN_S, NUDGE_MSG_MAX, nudgeSnack, sendNudge, useCooldownTick } from '../components/NudgeReceiver';
import '../styles/durt.css';

interface LogItem { id: string; fromId: string; toId: string; message: string; at: string; dir: 'in' | 'out' }

const QUICK = ['Bakar mısın? 👀', 'Toplantı başlıyor', 'Onay bekliyorum', 'Revize geldi', 'Acil!', 'Çay? ☕'];
const SETTINGS = [
  { key: 'nudgeSound', label: 'Ses çalsın', hint: 'Kısa, üç notalı bir ses', def: true },
  { key: 'nudgeShake', label: 'Ekran titresin', hint: 'Yarım saniyelik sallanma', def: true },
  { key: 'nudgeMac', label: 'Mac bildirimi', hint: 'Program açıkken de bildirim merkezine düşer', def: true },
  { key: 'dnd', label: 'Rahatsız etme', hint: 'Ses ve titreme olmaz, dürtmeler sessizce geçmişe düşer', def: false },
] as const;

function when(at: string) {
  const d = new Date(at);
  if (isNaN(d.getTime())) return '';
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay) return hm;
  if (d.toDateString() === y.toDateString()) return 'Dün ' + hm;
  return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + hm;
}

export function Durt({ openTask }: { openTask: (id: string) => void }) {
  const s = useStore();
  const me = s.me!;
  const [chip, setChip] = useState('');
  const [custom, setCustom] = useState('');
  const [log, setLog] = useState<LogItem[]>([]);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [hit, setHit] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useCooldownTick();

  const loadLog = () => api<LogItem[]>('GET', '/nudge/log').then(setLog).catch(() => {});
  const loadOnline = () => api<string[]>('GET', '/online').then((ids) => setOnline(new Set(Array.isArray(ids) ? ids : []))).catch(() => {});

  useEffect(() => {
    loadLog(); loadOnline();
    const iv = setInterval(loadOnline, 20_000); // çevrimiçi durumu için ayrı canlı yayın yok: düzenli yenile
    const vis = () => { if (document.visibilityState === 'visible') { loadOnline(); loadLog(); } };
    document.addEventListener('visibilitychange', vis);
    const offLive = onLive(['nudge', 'team'], (m) => { if (m.type !== 'team') loadLog(); loadOnline(); });
    const sent = () => loadLog();
    window.addEventListener('maya-nudge-sent', sent);
    return () => { clearInterval(iv); offLive(); document.removeEventListener('visibilitychange', vis); window.removeEventListener('maya-nudge-sent', sent); };
  }, []);

  const message = custom.trim() || chip;
  const people = s.team.filter((m) => m.id !== me.id && m.status === 'active')
    .sort((a, b) => Number(online.has(b.id)) - Number(online.has(a.id)) || a.name.localeCompare(b.name, 'tr'));
  const byId = (id: string) => s.team.find((m) => m.id === id);

  async function nudge(m: Member) {
    if (busy || cooldownLeft(m.id) > 0) return;
    setBusy(m.id);
    const r = await sendNudge(m.id, message);
    setBusy(null);
    nudgeSnack(m.name, r);
    if (r.ok) {
      setHit(m.id); setTimeout(() => setHit((h) => (h === m.id ? null : h)), 900);
      setChip(''); setCustom('');
    }
  }

  async function toggle(key: string, on: boolean) {
    const settings = { ...me.settings, [key]: on };
    store.set({ me: { ...me, settings } }); // anında yansısın
    try { await api('PATCH', '/me', { settings: { [key]: on } }); loadMe(); }
    catch (e: any) { snack(e.message); loadMe(); }
  }
  const setOn = (k: string, def: boolean) => (def ? me.settings[k] !== false : me.settings[k] === true);

  const lastWith = (id: string) => log.find((l) => l.fromId === id || l.toId === id);

  return (
    <div class="page">
      <header class="row" style="align-items:flex-end;justify-content:space-between">
        <div style="display:flex;flex-direction:column;gap:6px">
          <h1 class="h1">Dürtme</h1>
          <span class="sub" style="max-width:600px;line-height:1.5">Ekipten birinin dikkatini çekmek için dürt. Karşı tarafta kısa bir ses çalar, ekran bir an titrer ve köşede bildirim çıkar. Açık olan hiçbir şeyi kapatmaz, engellemez.</span>
        </div>
        <div class="row"><Bell onOpenTask={openTask} /></div>
      </header>

      <div class="durt-grid">
        <div class="durt-main">
          <section class="card durt-box" aria-label="Mesaj ekle">
            <div class="row" style="gap:8px;align-items:baseline">
              <h2>Mesaj ekle</h2>
              <span class="sub" style="font-size:12px">İsteğe bağlı · eklemeden de dürtebilirsin</span>
            </div>
            <div class="durt-chips" role="group" aria-label="Hazır mesajlar">
              {QUICK.map((q) => {
                const on = chip === q && !custom.trim();
                return <button type="button" key={q} class="durt-chip" aria-pressed={on} onClick={() => { setChip(on ? '' : q); setCustom(''); }}>{q}</button>;
              })}
            </div>
            <label class="durt-input">
              <span class="sr">Kendi mesajın</span>
              <input type="text" maxLength={NUDGE_MSG_MAX} value={custom} placeholder={`Ya da kendin yaz… (en fazla ${NUDGE_MSG_MAX} karakter)`}
                onInput={(e) => setCustom((e.target as HTMLInputElement).value.slice(0, NUDGE_MSG_MAX))}
                onKeyDown={(e) => { if (e.key === 'Escape') { setCustom(''); setChip(''); } }} />
              {custom && <span class="cnt">{Array.from(custom).length}/{NUDGE_MSG_MAX}</span>}
            </label>
          </section>

          <section class="durt-team" aria-label="Ekip">
            {people.map((m) => {
              const left = cooldownLeft(m.id);
              const isOn = online.has(m.id);
              const last = lastWith(m.id);
              return (
                <div class={'card durt-person' + (hit === m.id ? ' hit' : '')} key={m.id} data-person={m.id}>
                  <span class={'durt-av' + (hit === m.id ? ' durt-wiggle' : '')}>
                    <Avatar m={m} size={64} radius={20} />
                    <span class={'dot' + (isOn ? ' on' : '')} title={isOn ? 'Çevrimiçi' : 'Çevrimdışı'} />
                  </span>
                  <span class="who">
                    <span class="name">{m.name}</span>
                    <span class={'durt-state' + (isOn ? ' on' : '')}>{isOn ? 'Çevrimiçi' : 'Çevrimdışı'}</span>
                    <span class="meta">{last ? when(last.at) + (last.dir === 'in' ? ' · seni dürttü' : ' · sen dürttün') : ''}</span>
                  </span>
                  <button type="button" class={'btn ' + (left > 0 ? 'ghost' : 'primary')} disabled={left > 0 || busy === m.id}
                    aria-label={left > 0 ? `${m.name}: ${left} saniye sonra yeniden dürtebilirsin` : `${m.name} kişisini dürt`}
                    onClick={() => nudge(m)}>
                    <Icon n="hand" size={18} />
                    {left > 0 ? `Tekrar ${left} sn` : 'Dürt'}
                  </button>
                </div>
              );
            })}
            {!people.length && <div class="empty">Ekipte dürtülecek kimse yok.</div>}
          </section>

          <div class="durt-note">
            <span style="flex:none;margin-top:1px;color:var(--accent)"><Icon n="hand" size={16} /></span>
            <span>Aynı kişiyi {NUDGE_COOLDOWN_S} saniyede bir dürtebilirsin, böylece kimse art arda rahatsız edilmez. Karşı taraf "Rahatsız etme"yi açtıysa dürtme sessizce iletilir ve onun zilinde görünür.</span>
          </div>
        </div>

        <aside class="durt-rail" aria-label="Ayarlar ve geçmiş">
          <section class="card durt-box" style="gap:4px">
            <h2 style="margin-bottom:6px">Bana dürtme gelince</h2>
            {SETTINGS.map((x) => {
              const on = setOn(x.key, x.def);
              return <Switch key={x.key} on={on} label={x.label} hint={x.hint} onToggle={() => toggle(x.key, !on)} />;
            })}
          </section>

          <section class="card durt-box" aria-label="Son dürtmeler">
            <h2>Son dürtmeler</h2>
            <div class="durt-log">
              {log.map((l) => {
                const other = byId(l.dir === 'in' ? l.fromId : l.toId);
                const name = other?.name || 'Eski üye';
                return (
                  <div class="durt-log-item" key={l.id}>
                    <Avatar m={other} size={28} radius={8} />
                    <span class="txt">
                      <span><span class={'durt-dir ' + l.dir}>{l.dir === 'in' ? 'Gelen' : 'Giden'}</span>{l.dir === 'in' ? name + ' seni dürttü' : name + ' kişisini dürttün'}</span>
                      {l.message && <span class="q">“{l.message}”</span>}
                    </span>
                    <span class="when">{when(l.at)}</span>
                  </div>
                );
              })}
              {!log.length && <p class="sub" style="margin:0">Henüz dürtme yok. Birini dürterek başla.</p>}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
