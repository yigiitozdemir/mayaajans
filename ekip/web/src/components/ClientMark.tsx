// Müşteri işareti: logosu varsa logo, yoksa marka renginde baş harfler. İş, çekim, özel gün ve sohbette firma adının yanında.
import { initials, type Client } from '../api';
import { useStore } from '../ui';

const PAL = ['#2F6F8F', '#7A4E9C', '#3E7A55', '#9C4A5E', '#8A5A2B', '#5B6B3A', '#4C6A9E', '#8E5B8A'];
const norm = (s: string) => s.toLocaleLowerCase('tr').replace(/[^a-z0-9çğıöşü]+/g, ' ').trim();
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

/** Firma adına göre müşteri kaydı (tam ad, sonra "ad … ile başlıyor" eşleşmesi). */
export function findClient(clients: Client[], name: string | null | undefined): Client | null {
  if (!name) return null;
  const n = norm(name); if (!n) return null;
  return clients.find((c) => norm(c.name) === n)
    || clients.find((c) => { const cn = norm(c.name); return cn.length >= 4 && (n.startsWith(cn) || cn.startsWith(n)); })
    || null;
}

/** Kartlardaki renk şeridi için marka rengi (yoksa null). */
export function useClientColor(name: string | null | undefined): string | null {
  const s = useStore();
  return findClient(s.clients, name)?.color || null;
}

export function ClientMark({ name, size = 18, title = true }: { name: string | null | undefined; size?: number; title?: boolean }) {
  const s = useStore();
  if (!name) return null;
  const c = findClient(s.clients, name);
  const r = Math.round(size * 0.28);
  const box = { width: size + 'px', height: size + 'px', borderRadius: r + 'px' };
  if (c?.logoFileId) {
    const dark = c.logoVariant === 'Beyaz';
    return (
      <span class={'cmark img' + (dark ? ' dark' : '')} style={box} title={title ? c.name : undefined}>
        <img src={`/api/clients/${c.id}/files/${c.logoFileId}`} alt="" loading="lazy" />
      </span>
    );
  }
  const parts = (c?.name || name).split(/\s+/);
  const bg = c?.color || PAL[hash(norm(c?.name || name)) % PAL.length];
  return (
    <span class="cmark" style={{ ...box, background: bg, fontSize: Math.max(8, Math.round(size * 0.42)) + 'px' }} title={title ? (c?.name || name) : undefined} aria-hidden="true">
      {initials(parts[0] || '', parts[1] || '')}
    </span>
  );
}
