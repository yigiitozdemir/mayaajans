// Drive linkinin içindeki görsel/videoların küçük önizlemesi. Özellik kapalıysa (anahtar yok) ya da link Drive değilse hiçbir şey çizmez.
import { useEffect, useState } from 'preact/hooks';
import { api } from '../api';
import { Icon } from '../ui';
import '../styles/drive.css';

type Dosya = { id: string; ad: string; tur: 'gorsel' | 'video' | 'pdf' | 'klasor' | 'belge' | 'diger'; kucuk: string | null; link: string };
type Onizleme =
  | { aktif: false }
  | { aktif: true; tur: 'klasor' | 'dosya'; ad: string; toplam: number; fazlasi: boolean; dosyalar: Dosya[]; link: string }
  | { aktif: true; hata: 'erisim' | 'bulunamadi' | 'gecici' };

const onbellek = new Map<string, Promise<Onizleme>>();
const isDrive = (l: string) => /^https?:\/\/(drive|docs)\.google\.com\//i.test(l.trim());

/** `misafir`: Vatan yetkilisi sayfası (kendi uç noktası). `adet`: gösterilecek en çok küçük resim. */
export function DriveOnizleme({ link, misafir, adet = 6 }: { link: string | null | undefined; misafir?: boolean; adet?: number }) {
  const [v, setV] = useState<Onizleme | null>(null);
  const [bozuk, setBozuk] = useState<Record<string, true>>({});
  useEffect(() => {
    setV(null);
    if (!link || !isDrive(link)) return;
    const key = (misafir ? 'g:' : 't:') + link;
    let p = onbellek.get(key);
    if (!p) {
      p = api<Onizleme>('GET', (misafir ? '/misafir/drive?url=' : '/drive/onizleme?url=') + encodeURIComponent(link)).catch(() => ({ aktif: false }) as Onizleme);
      onbellek.set(key, p); setTimeout(() => onbellek.delete(key), 5 * 60_000);
    }
    let alive = true; p.then((x) => alive && setV(x));
    return () => { alive = false; };
  }, [link, misafir]);

  if (!link || !isDrive(link)) return null;
  if (v === null) return <div class="dv dv-yukleniyor" aria-hidden="true"><span /><span /><span /><span /></div>;
  if (!v.aktif) return null;
  if ('hata' in v) {
    if (v.hata === 'gecici') return null;
    return (
      <div class="dv-uyari" role="note">
        <Icon n="lock" size={13} />
        {v.hata === 'erisim' ? 'Önizleme yok: klasör paylaşıma kapalı. Drive’da “Bağlantıya sahip herkes görüntüleyebilir” yapılırsa burada görünür.' : 'Drive’da bu bağlantı bulunamadı.'}
      </div>
    );
  }
  const gorunen = v.dosyalar.filter((d) => d.kucuk && !bozuk[d.id]).slice(0, adet);
  const kalan = v.toplam - gorunen.length;
  return (
    <div class="dv" aria-label={'Drive önizleme: ' + v.ad}>
      <a class="dv-bas" href={v.link} target="_blank" rel="noopener noreferrer">
        <Icon n="folder" size={14} />
        <span class="dv-ad">{v.ad}</span>
        <span class="dv-say">{v.tur === 'klasor' ? (v.toplam === 0 ? 'boş klasör' : `${v.toplam}${v.fazlasi ? '+' : ''} dosya`) : 'dosya'}</span>
      </a>
      {gorunen.length > 0 && (
        <div class="dv-izgara">
          {gorunen.map((d) => (
            <a class="dv-kare" href={d.link} target="_blank" rel="noopener noreferrer" title={d.ad}>
              <img src={d.kucuk!} alt={d.ad} loading="lazy" referrerpolicy="no-referrer" onError={() => setBozuk((b) => ({ ...b, [d.id]: true }))} />
              {d.tur === 'video' && <span class="dv-oynat" aria-hidden="true">▶</span>}
            </a>
          ))}
          {kalan > 0 && v.tur === 'klasor' && <a class="dv-kare dv-fazla" href={v.link} target="_blank" rel="noopener noreferrer" aria-label={`Drive'da ${kalan} dosya daha`}>+{kalan}{v.fazlasi ? '+' : ''}</a>}
        </div>
      )}
    </div>
  );
}
