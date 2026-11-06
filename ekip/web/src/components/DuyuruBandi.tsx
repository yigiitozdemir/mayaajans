// Bugün ekranında başlığın altında: okunmamış ya da sabitlenmiş duyurular (en çok 2). Gösterecek bir şey yoksa null.
import { useStore, Icon, Avatar, Link, navigate } from '../ui';
import { useDuyurular, okudum, since, type Duyuru } from '../pages/Duyurular';
import '../styles/duyuru.css';

/** Saf: bantta gösterilecekler — önce okunmamış önemliler, sonra okunmamışlar, sonra sabitler (her grupta yeniye göre). */
export function bantSecimi(items: Duyuru[]): Duyuru[] {
  const rank = (d: Duyuru) => (!d.readByMe ? (d.important ? 0 : 1) : 2);
  return items
    .filter((d) => !d.archived && (!d.readByMe || d.pinned))
    .sort((a, b) => rank(a) - rank(b) || (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1) || b.createdAt.localeCompare(a.createdAt));
}

export function DuyuruBandi({ openTask }: { openTask: (id: string) => void }) {
  void openTask;
  const s = useStore();
  const { items, replace } = useDuyurular();
  if (!items) return null;
  const all = bantSecimi(items);
  if (!all.length) return null;
  const shown = all.slice(0, 2);
  const unreadN = items.filter((d) => !d.readByMe).length;
  return (
    <section class="dyb" aria-label="Duyurular">
      <div class="dyb-h">
        <span class="dyb-ic" aria-hidden="true"><Icon n="megafon" size={15} /></span>
        <span class="dyb-t">Duyurular</span>
        {unreadN > 0 && <span class="dyb-n">{unreadN} yeni</span>}
        <span class="spacer" />
        <Link href="/duyurular" class="dyb-all">{all.length > shown.length ? `Tümü (+${all.length - shown.length})` : 'Tümü'}</Link>
      </div>
      <div class={'dyb-list' + (shown.length > 1 ? ' two' : '')}>
        {shown.map((d) => {
          const a = s.team.find((m) => m.id === d.authorId);
          return (
            <div class={'dyb-item' + (!d.readByMe ? ' unread' : '') + (d.important ? ' important' : '')} data-duyuru={d.id}>
              <button type="button" class="dyb-open" onClick={() => navigate('/duyurular?id=' + d.id)} aria-label={'Duyuruyu aç: ' + d.title}>
                <span class="dyb-row">
                  {d.important && <span class="dy-flag imp"><Icon n="uyari" size={11} />Önemli</span>}
                  {d.pinned && <span class="dy-flag pin"><Icon n="pin" size={11} />Sabit</span>}
                  <span class="dyb-title">{d.title}</span>
                </span>
                {d.body && <span class="dyb-body">{d.body.replace(/\s+/g, ' ')}</span>}
                <span class="dyb-meta"><Avatar m={a} size={18} presence={false} />{a?.firstName || 'Ekip'} · {since(d.createdAt)} · {d.readCount}/{d.total} okudu</span>
              </button>
              {!d.readByMe
                ? <button type="button" class="btn primary sm dyb-ok" onClick={async (e) => { const n = await okudum(d, e.currentTarget); if (n) replace(n); }}><Icon n="check" size={14} />Okudum</button>
                : <span class="dy-done dyb-ok"><Icon n="check" size={14} />Okudun</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
