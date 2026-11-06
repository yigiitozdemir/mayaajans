// Profil penceresi: sesler ve titreşim ayarı + her sesi dinleme düğmeleri.
import { useState } from 'preact/hooks';
import { api, loadMe, snack, store } from '../api';
import { Switch, useStore } from '../ui';
import { SESLER, sesDinle, titresimVar } from '../ses';
import '../styles/rozet.css';

export function SesAyari() {
  const s = useStore();
  const settings = s.me?.settings || {};
  const [local, setLocal] = useState<Record<string, boolean>>({});
  const val = (k: 'sesler' | 'titresim') => (k in local ? local[k] : settings[k] === undefined ? true : !!settings[k]);
  const vib = titresimVar();
  // profil penceresi açıldığında elindeki ayar nesnesi (Kaydet onu gönderir)
  const [ilk] = useState(() => store.get().me?.settings as Record<string, unknown> | undefined);
  const yaz = (k: string, v: boolean) => { for (const o of [ilk, store.get().me?.settings as Record<string, unknown> | undefined]) if (o) o[k] = v; };

  async function toggle(k: 'sesler' | 'titresim') {
    const next = !val(k);
    setLocal({ ...local, [k]: next });
    // profil penceresinin Kaydet'i eski değeri geri yazmasın
    yaz(k, next);
    try {
      await api('PATCH', '/me', { settings: { [k]: next } });
      await loadMe();
    } catch (e: any) {
      setLocal({ ...local, [k]: !next });
      yaz(k, !next);
      snack(e?.message || 'Kaydedilemedi');
    }
  }

  return (
    <div class="ses-ayari">
      <Switch on={val('sesler')} label="Sesler" hint="İş bitince, mesaj, onay ve atama gelince kısa bir ses · odaklanırken ve Rahatsız etme açıkken susar" onToggle={() => toggle('sesler')} />
      <div class="ses-dinle" role="group" aria-label="Sesleri dinle">
        {SESLER.map((x) => (
          <button type="button" class="ses-chip" aria-label={x.ad + ' sesini dinle'} onClick={() => sesDinle(x.tur)}>
            <svg width="9" height="10" viewBox="0 0 9 10" aria-hidden="true"><path d="M1 1.2v7.6c0 .5.5.8.9.5l6-3.8a.6.6 0 0 0 0-1L1.9.7C1.5.4 1 .7 1 1.2Z" fill="currentColor" /></svg>
            {x.ad}
          </button>
        ))}
      </div>
      {vib && <Switch on={val('titresim')} label="Titreşim" hint="Seslerle birlikte kısa bir titreşim" onToggle={() => toggle('titresim')} />}
    </div>
  );
}
