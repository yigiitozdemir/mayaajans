// Bugün ekranı: geçen haftanın yıldızı + bu haftanın canlı ilk 3'ü. Gösterecek veri yoksa null.
import { useEffect, useState } from 'preact/hooks';
import { api, onLive, MON } from '../api';
import { Avatar, useStore } from '../ui';
import '../styles/rozet.css';

export type RozetKey = 'yildiz' | 'dakik' | 'onay' | 'cekim' | 'seri';
export interface RozetMeta { key: RozetKey; emoji: string; ad: string; birim: string }
export interface Durum {
  week: { start: string; end: string }; awarded: boolean;
  top: { userId: string; done: number; onTime: number; rank: number }[];
  me: { rank: number | null; of: number; done: number };
  last: null | { week: string; end: string; current: boolean; winners: { userId: string; badge: RozetKey; value: number }[] };
  badges: RozetMeta[];
}

/** "2–8 Kas" */
export function haftaYazi(start: string, end: string) {
  const a = new Date(start + 'T00:00:00'), b = new Date(end + 'T00:00:00');
  return a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${MON[b.getMonth()]}` : `${a.getDate()} ${MON[a.getMonth()]} – ${b.getDate()} ${MON[b.getMonth()]}`;
}
export const birimYazi = (m: RozetMeta | undefined, v: number) => (m ? (m.key === 'dakik' ? `${v} iş zamanında` : `${v} ${m.birim}`) : String(v));

export function HaftaninYildizi({ openTask }: { openTask: (id: string) => void }) {
  void openTask;
  const s = useStore();
  const [d, setD] = useState<Durum | null>(null);
  const [acik, setAcik] = useState(false);

  useEffect(() => {
    let alive = true, timer: any;
    const load = () => api<Durum>('GET', '/rozetler').then((x) => alive && setD(x)).catch(() => {});
    load();
    const off = onLive(['rozet', 'tasks', 'shoots', '*'], () => { clearTimeout(timer); timer = setTimeout(load, 400); });
    return () => { alive = false; clearTimeout(timer); off(); };
  }, []);

  if (!d) return null;
  const member = (id: string) => s.team.find((m) => m.id === id) || (s.me?.id === id ? { id, firstName: s.me.firstName, lastName: s.me.lastName, color: s.me.color, photo: s.me.photo, name: s.me.firstName } : null);
  const winners = (d.last?.winners || []).filter((w) => member(w.userId));
  const stars = winners.filter((w) => w.badge === 'yildiz');
  const others = winners.filter((w) => w.badge !== 'yildiz');
  const top = d.top.filter((x) => member(x.userId));
  if (!stars.length && !others.length && !top.length) return null;
  const meta = (k: RozetKey) => d.badges.find((b) => b.key === k);
  const first = (id: string) => member(id)?.firstName || '';
  const meId = s.me?.id;
  const meInTop = top.some((x) => x.userId === meId);

  return (
    <section class={'hy card' + (acik ? ' open' : '')} aria-label="Haftanın yıldızı">
      <button type="button" class="hy-row" aria-expanded={acik} onClick={() => setAcik(!acik)}>
        {stars.length > 0 && (
          <span class="hy-star">
            <span class="hy-avs">
              {stars.slice(0, 3).map((w) => <span class="hy-glow"><Avatar m={member(w.userId)} size={34} radius={11} presence={false} /></span>)}
            </span>
            <span class="hy-txt">
              <span class="hy-k">{d.last?.current ? 'Bu haftanın yıldızı' : 'Geçen haftanın yıldızı'}</span>
              <span class="hy-v"><b>{stars.map((w) => first(w.userId)).join(', ')}</b> <span aria-hidden="true">🌟</span> <span class="hy-n">{stars[0].value} iş</span></span>
            </span>
          </span>
        )}
        {stars.length === 0 && others.length > 0 && (
          <span class="hy-star">
            <span class="hy-txt">
              <span class="hy-k">{d.last?.current ? 'Bu haftanın rozetleri' : 'Geçen haftanın rozetleri'}</span>
              <span class="hy-v">{others.slice(0, 2).map((w) => meta(w.badge)?.emoji + ' ' + first(w.userId)).join(' · ')}</span>
            </span>
          </span>
        )}
        {others.length > 0 && stars.length > 0 && (
          <span class="hy-badges" aria-label="Diğer rozetler">
            {others.slice(0, 4).map((w) => <span class="hy-b" title={`${meta(w.badge)?.ad}: ${first(w.userId)} (${birimYazi(meta(w.badge), w.value)})`}>{meta(w.badge)?.emoji}</span>)}
          </span>
        )}
        <span class="spacer" />
        {top.length > 0 && !d.last?.current && (
          <span class="hy-live">
            <span class="hy-k hy-live-k"><i class="hy-pulse" aria-hidden="true" />Bu hafta</span>
            <span class="hy-top">
              {top.map((x) => (
                <span class={'hy-p' + (x.userId === meId ? ' me' : '')} title={`${x.rank}. ${first(x.userId)} · ${x.done} iş`}>
                  <Avatar m={member(x.userId)} size={24} radius={8} presence={false} />
                  <span class="hy-pn"><span class="hy-name">{first(x.userId)}</span> <b>{x.done}</b></span>
                </span>
              ))}
            </span>
            {!meInTop && d.me.rank && <span class="hy-me">Sen {d.me.rank}. · {d.me.done}</span>}
          </span>
        )}
        <svg class="hy-chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      {acik && (
        <div class="hy-more">
          {winners.length > 0 && (
            <div class="hy-col">
              <span class="hy-h">{d.last?.current ? 'Bu hafta' : 'Geçen hafta'} · {haftaYazi(d.last!.week, d.last!.end)}</span>
              {winners.map((w) => (
                <span class="hy-line"><span class="hy-e" aria-hidden="true">{meta(w.badge)?.emoji}</span><span class="hy-ad">{meta(w.badge)?.ad}</span><span class="spacer" /><Avatar m={member(w.userId)} size={20} radius={7} presence={false} /><span>{first(w.userId)}</span><span class="hy-n">{birimYazi(meta(w.badge), w.value)}</span></span>
              ))}
            </div>
          )}
          <div class="hy-col">
            <span class="hy-h">Bu hafta · canlı · {haftaYazi(d.week.start, d.week.end)}</span>
            {top.map((x) => (
              <span class={'hy-line' + (x.userId === meId ? ' me' : '')}><span class="hy-rank">{x.rank}</span><Avatar m={member(x.userId)} size={20} radius={7} presence={false} /><span>{first(x.userId)}</span><span class="spacer" /><span class="hy-n">{x.done} iş · {x.onTime} zamanında</span></span>
            ))}
            {!top.length && <span class="hy-n">Bu hafta henüz biten iş yok.</span>}
            {top.length > 0 && !meInTop && <span class="hy-n">{d.me.rank ? `Sen ${d.me.rank}. sıradasın · ${d.me.done} iş` : 'Bu hafta ilk işini bitir, listeye gir ✨'}</span>}
            <span class="hy-rule">Rozetler Cuma 17:00'de verilir · 🌟 en çok iş · ⏱️ ≥3 iş, hepsi zamanında · ✅ tek seferde onay · 🎬 en çok çekim · 🔥 her iş günü</span>
          </div>
        </div>
      )}
    </section>
  );
}
