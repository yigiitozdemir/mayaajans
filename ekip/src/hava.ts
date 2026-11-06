// Dış çekimler için hava durumu (Open-Meteo, anahtarsız) + "yarın yağmur var" uyarısı (her gün 18:00 İstanbul)
import type { Env } from './types';
import { notify } from './notify';
import { istanbulHour } from './util';

// ---------- tipler ----------
export interface HavaSaatlik { time: string[]; pop: number[]; mm: number[]; wind: number[]; temp: number[]; code: number[] }
export interface Konum { lat: number; lon: number; place: string; fallback: boolean }
export interface HavaOzet {
  date: string;          // YYYY-MM-DD
  hour: string;          // "14:00" — en riskli (ya da çekim) saati
  range: string;         // "10:00–12:00" ya da "08:00–18:00"
  temp: number;          // °C
  pop: number;           // en yüksek yağış olasılığı (%)
  mm: number;            // toplam yağış (mm)
  wind: number;          // en yüksek rüzgâr (km/sa)
  code: number;          // WMO hava kodu
  icon: string;          // emoji
  label: string;         // "Yağmurlu"
  risk: boolean;
  reason: string;        // "Yağış olasılığı %70 (14:00) · Rüzgâr 42 km/sa"
  place: string;         // tahminin konumu ("Çorlu (varsayılan)")
}
export interface HavaCekim { id: string; date: string; time: string; location: string }

export const RISK_POP = 50;     // %
export const RISK_WIND = 35;    // km/sa
export const HAVA_GUN = 16;     // tahmin ufku (gün)
const FC_TTL_H = 3;             // tahmin önbelleği (saat)
const GEO_TTL_D = 30;           // koordinat önbelleği (gün)
export const CORLU: Konum = { lat: 41.1592, lon: 27.8, place: 'Çorlu (varsayılan)', fallback: true };

// ---------- WMO kodu → simge / ad ----------
export function havaKodu(code: number): { icon: string; label: string; kind: 'acik' | 'bulut' | 'sis' | 'yagmur' | 'kar' | 'firtina' } {
  if (code === 0) return { icon: '☀️', label: 'Açık', kind: 'acik' };
  if (code === 1) return { icon: '🌤️', label: 'Az bulutlu', kind: 'acik' };
  if (code === 2) return { icon: '⛅', label: 'Parçalı bulutlu', kind: 'bulut' };
  if (code === 3) return { icon: '☁️', label: 'Kapalı', kind: 'bulut' };
  if (code === 45 || code === 48) return { icon: '🌫️', label: 'Sisli', kind: 'sis' };
  if (code >= 51 && code <= 57) return { icon: '🌦️', label: 'Çisenti', kind: 'yagmur' };
  if (code >= 61 && code <= 67) return { icon: '🌧️', label: 'Yağmurlu', kind: 'yagmur' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: '🌨️', label: 'Karlı', kind: 'kar' };
  if (code >= 80 && code <= 82) return { icon: '🌧️', label: 'Sağanak', kind: 'yagmur' };
  if (code >= 95) return { icon: '⛈️', label: 'Gök gürültülü', kind: 'firtina' };
  return { icon: '🌡️', label: 'Hava', kind: 'bulut' };
}

/** Çekim saati metninden bakılacak saat aralığı ("10:00" → 10–12, "Sabah" → 8–11, boş/"Tam gün" → 8–18). */
export function saatAraligi(t: string): [number, number] {
  const s = (t || '').toLocaleLowerCase('tr').trim();
  const all = [...s.matchAll(/(\d{1,2})[:.](\d{2})/g)].map((m) => Math.min(23, +m[1]));
  if (all.length >= 2 && all[1] >= all[0]) return [all[0], all[1]];
  if (all.length) return [all[0], Math.min(23, all[0] + 2)];
  if (s.includes('sabah')) return [8, 11];
  if (s.includes('öğleden sonra')) return [13, 17];
  if (s.includes('öğle')) return [11, 14];
  if (s.includes('akşam')) return [17, 20];
  if (s.includes('gece')) return [20, 23];
  return [8, 18];
}

const hh = (h: number) => String(h).padStart(2, '0') + ':00';

/** Saatlik tahminden çekim gününün/saatinin özetini çıkarır (saf fonksiyon). */
export function ozetle(fc: HavaSaatlik, date: string, time: string, place: string): HavaOzet | null {
  const [a, b] = saatAraligi(time);
  const idx: number[] = [];
  for (let i = 0; i < fc.time.length; i++) {
    const t = fc.time[i];
    if (!t.startsWith(date)) continue;
    const h = +t.slice(11, 13);
    if (h >= a && h <= b) idx.push(i);
  }
  if (!idx.length) return null;
  const num = (arr: number[], i: number) => (typeof arr[i] === 'number' && isFinite(arr[i]) ? arr[i] : 0);
  let peak = idx[0];
  for (const i of idx) if (num(fc.pop, i) > num(fc.pop, peak)) peak = i;
  const pop = Math.round(num(fc.pop, peak));
  const wind = Math.round(Math.max(...idx.map((i) => num(fc.wind, i))));
  const mm = Math.round(idx.reduce((s, i) => s + num(fc.mm, i), 0) * 10) / 10;
  const code = Math.max(...idx.map((i) => num(fc.code, i))); // aralıktaki en "kötü" hava
  const ref = pop >= RISK_POP ? peak : idx[0];
  const temp = Math.round(num(fc.temp, ref));
  const k = havaKodu(code);
  const reasons: string[] = [];
  if (pop >= RISK_POP) reasons.push((k.kind === 'kar' ? 'Kar' : 'Yağış') + ' olasılığı %' + pop + ' (' + fc.time[peak].slice(11, 16) + ')');
  if (wind >= RISK_WIND) reasons.push('Rüzgâr ' + wind + ' km/sa');
  return {
    date, hour: fc.time[ref].slice(11, 16), range: hh(a) + '–' + hh(b), temp, pop, mm, wind, code, icon: k.icon, label: k.label,
    risk: reasons.length > 0, reason: reasons.join(' · '), place,
  };
}

// ---------- sahte veri (test: wrangler dev --var HAVA_SAHTE:'{…}') ----------
interface SahteDeger { pop?: number; wind?: number; temp?: number; code?: number; mm?: number }
interface Sahte { now?: string; varsayilan?: SahteDeger; konumlar?: Record<string, SahteDeger>; hata?: string[]; bulunamaz?: string[] }
function sahte(env: Env): Sahte | null {
  if (!env.HAVA_SAHTE) return null;
  try { const o = JSON.parse(env.HAVA_SAHTE); return o && typeof o === 'object' ? o : null; } catch { return null; }
}
/** Test: HAVA_SAHTE.now verildiyse cron o saatle çalışır. */
export function sahteNow(env: Env): Date | null {
  const n = sahte(env)?.now;
  if (!n) return null;
  const d = new Date(n);
  return isNaN(d.getTime()) ? null : d;
}
const lowerTr = (s: string) => (s || '').toLocaleLowerCase('tr').trim();
function sahteKonum(sh: Sahte, loc: string): Konum | 'hata' {
  const l = lowerTr(loc);
  if ((sh.hata || []).some((x) => l.includes(lowerTr(x)))) return 'hata';
  if (!l || (sh.bulunamaz || []).some((x) => l.includes(lowerTr(x)))) return CORLU;
  const keys = Object.keys(sh.konumlar || {});
  const i = keys.findIndex((k) => l.includes(lowerTr(k)));
  return { lat: 40 + (i + 1) / 10, lon: 28 + (i + 1) / 10, place: loc, fallback: false };
}
function sahteTahmin(sh: Sahte, k: Konum): HavaSaatlik {
  const keys = Object.keys(sh.konumlar || {});
  const i = Math.round((k.lat - 40) * 10) - 1;
  const v: SahteDeger = { pop: 10, wind: 8, temp: 16, code: 1, mm: 0, ...(sh.varsayilan || {}), ...(k.fallback || i < 0 ? {} : (sh.konumlar || {})[keys[i]] || {}) };
  const fc: HavaSaatlik = { time: [], pop: [], mm: [], wind: [], temp: [], code: [] };
  const d0 = Date.parse(istanbulDate(new Date(), -1) + 'T00:00:00Z');
  for (let d = 0; d < HAVA_GUN + 1; d++) {
    const ds = new Date(d0 + d * 86_400_000).toISOString().slice(0, 10);
    for (let h = 0; h < 24; h++) {
      fc.time.push(ds + 'T' + hh(h));
      // gün ortasında tepe yapan basit eğri: en riskli saat 12–16 arası
      const f = h >= 12 && h <= 16 ? 1 : h >= 9 && h <= 18 ? 0.6 : 0.2;
      fc.pop.push(Math.round((v.pop ?? 0) * f)); fc.wind.push(Math.round((v.wind ?? 0) * f)); fc.mm.push((v.mm ?? 0) * f);
      fc.temp.push(v.temp ?? 16); fc.code.push(f === 1 ? v.code ?? 1 : Math.min(v.code ?? 1, 3));
    }
  }
  return fc;
}

// ---------- önbellek (D1) ----------
async function cacheGet<T>(env: Env, key: string, ttlSql: string): Promise<T | null> {
  const row = await env.DB.prepare(`SELECT data FROM weather_cache WHERE key = ? AND fetched_at > datetime('now', ?)`).bind(key, ttlSql).first<{ data: string }>();
  if (!row) return null;
  try { return JSON.parse(row.data) as T; } catch { return null; }
}
async function cachePut(env: Env, key: string, data: unknown) {
  await env.DB.prepare(`INSERT INTO weather_cache (key, data, fetched_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`).bind(key, JSON.stringify(data)).run();
}

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: { 'User-Agent': 'MayaEkip/1.0 (ekip.mayaajans.net)' }, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('hava servisi ' + r.status);
  return r.json();
}

/** Konum metninden koordinat (bulunamazsa Çorlu). Ağ hatasında null. */
export async function konumBul(env: Env, location: string): Promise<Konum | null> {
  const loc = (location || '').trim().slice(0, 160);
  const sh = sahte(env);
  if (sh) { const k = sahteKonum(sh, loc); return k === 'hata' ? null : k; }
  if (!loc) return CORLU;
  const key = 'geo:' + lowerTr(loc);
  const hit = await cacheGet<Konum>(env, key, `-${GEO_TTL_D} days`);
  if (hit) return hit;
  // "Klinik, Çorlu / Tekirdağ" → önce tamamı, sonra parçalar (Open-Meteo yalnızca yer adını eşler)
  const parts = [loc, ...loc.split(/[,/·()–-]+/).map((x) => x.trim()).filter((x) => x.length >= 2)];
  const tried = new Set<string>();
  try {
    for (const p of parts) {
      const q = lowerTr(p); if (tried.has(q)) continue; tried.add(q);
      if (tried.size > 4) break;
      const j = await getJson('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(p) + '&language=tr&count=1&countryCode=TR');
      const g = j?.results?.[0];
      if (g && typeof g.latitude === 'number' && typeof g.longitude === 'number') {
        const names = [g.name, g.admin1].filter((x: unknown) => typeof x === 'string' && x) as string[];
        const k: Konum = { lat: g.latitude, lon: g.longitude, place: [...new Set(names)].join(', '), fallback: false };
        await cachePut(env, key, k);
        return k;
      }
    }
  } catch (e) { console.error('konum aranamadı', e); return null; }
  await cachePut(env, key, CORLU);
  return CORLU;
}

/** Saatlik tahmin (16 gün, İstanbul saati). Ağ hatasında null. */
export async function tahmin(env: Env, k: Konum): Promise<HavaSaatlik | null> {
  const sh = sahte(env);
  if (sh) return sahteTahmin(sh, k);
  const key = 'fc:' + k.lat.toFixed(2) + ',' + k.lon.toFixed(2);
  const hit = await cacheGet<HavaSaatlik>(env, key, `-${FC_TTL_H} hours`);
  if (hit) return hit;
  try {
    const j = await getJson('https://api.open-meteo.com/v1/forecast?latitude=' + k.lat.toFixed(4) + '&longitude=' + k.lon.toFixed(4) +
      '&hourly=precipitation_probability,precipitation,wind_speed_10m,temperature_2m,weather_code&timezone=Europe%2FIstanbul&forecast_days=' + HAVA_GUN);
    const h = j?.hourly;
    if (!h || !Array.isArray(h.time)) return null;
    const fc: HavaSaatlik = {
      time: h.time, pop: h.precipitation_probability || [], mm: h.precipitation || [], wind: h.wind_speed_10m || [],
      temp: h.temperature_2m || [], code: h.weather_code || [],
    };
    await cachePut(env, key, fc);
    return fc;
  } catch (e) { console.error('hava tahmini alınamadı', e); return null; }
}

/** İstanbul (UTC+3) takvim günü, addDays gün sonrası. */
export function istanbulDate(now = new Date(), addDays = 0): string {
  return new Date(now.getTime() + 3 * 3600_000 + addDays * 86_400_000).toISOString().slice(0, 10);
}

/** Birden çok çekimin hava özetleri (aynı konum bir kez sorulur). Hata olanlar sonuçta yer almaz. */
export async function cekimHavalari(env: Env, shoots: HavaCekim[]): Promise<Record<string, HavaOzet>> {
  const out: Record<string, HavaOzet> = {};
  const locs = new Map<string, Promise<{ k: Konum; fc: HavaSaatlik } | null>>();
  const forLoc = (loc: string) => {
    const key = lowerTr(loc);
    if (!locs.has(key)) {
      locs.set(key, (async () => {
        const k = await konumBul(env, loc).catch(() => null); if (!k) return null;
        const fc = await tahmin(env, k).catch(() => null); return fc ? { k, fc } : null;
      })());
    }
    return locs.get(key)!;
  };
  await Promise.all(shoots.map(async (s) => {
    const r = await forLoc(s.location);
    if (!r) return;
    const o = ozetle(r.fc, s.date, s.time, r.k.place);
    if (o) out[s.id] = o;
  }));
  return out;
}

// ---------- 18:00 uyarısı ----------
interface UyariRow { id: string; title: string; client: string; date: string; time: string; location: string; crew: string }

/** "🌧️ Yarın Çavuşdent dış çekiminde yağmur bekleniyor (%70, 14:00)" */
export function uyariMetni(name: string, o: HavaOzet): string {
  const k = havaKodu(o.code).kind;
  if (o.pop >= RISK_POP) {
    const [ic, what] = k === 'kar' ? ['🌨️', 'kar'] : k === 'firtina' ? ['⛈️', 'sağanak ve gök gürültüsü'] : ['🌧️', 'yağmur'];
    return `${ic} Yarın ${name} dış çekiminde ${what} bekleniyor (%${o.pop}, ${o.hour})` + (o.wind >= RISK_WIND ? ` · rüzgâr ${o.wind} km/sa` : '');
  }
  return `💨 Yarın ${name} dış çekiminde kuvvetli rüzgâr bekleniyor (${o.wind} km/sa)`;
}

/** Saatlik cron'dan çağrılır; yalnızca İstanbul saatiyle 18:00'de çalışır. Ertesi günün riskli dış çekimleri için ekip + yöneticiye bildirim. */
export async function havaUyarisi(env: Env, now: Date = sahteNow(env) ?? new Date()): Promise<number> {
  if (istanbulHour(now) !== 18) return 0;
  const today = istanbulDate(now), tomorrow = istanbulDate(now, 1);
  const { results } = await env.DB.prepare(
    `SELECT id, title, client, date, time, location, crew FROM shoots
     WHERE date = ? AND status = 0 AND outdoor = 1 AND id NOT IN (SELECT shoot_id FROM weather_alerts WHERE day = ?)`,
  ).bind(tomorrow, today).all<UyariRow>();
  if (!results.length) return 0;
  const hava = await cekimHavalari(env, results);
  const { results: users } = await env.DB.prepare("SELECT id, role, settings FROM users WHERE status = 'active'").all<{ id: string; role: string; settings: string }>();
  const wants = (u: { settings: string }) => { try { return JSON.parse(u.settings || '{}').havaUyarisi !== false; } catch { return true; } };
  const admins = users.filter((u) => u.role === 'admin').map((u) => u.id);
  const byId = new Map(users.map((u) => [u.id, u]));
  let sent = 0;
  for (const s of results) {
    const o = hava[s.id];
    if (!o || !o.risk) continue;
    // önce işaretle: aynı çekim için günde bir kez
    const ins = await env.DB.prepare('INSERT OR IGNORE INTO weather_alerts (shoot_id, day) VALUES (?, ?)').bind(s.id, today).run();
    if (!ins.meta.changes) continue;
    let crew: string[] = [];
    try { const a = JSON.parse(s.crew || '[]'); if (Array.isArray(a)) crew = a.filter((x) => typeof x === 'string'); } catch { /* */ }
    const to = [...new Set([...crew, ...admins])].filter((id) => byId.has(id) && wants(byId.get(id)!));
    const title = uyariMetni(s.client || s.title, o);
    const body = [s.title, s.client].filter(Boolean).join(' · ') + ' · ' + o.icon + ' ' + o.label + ', ' + o.temp + '°C' + (o.reason ? ' · ' + o.reason : '');
    for (const uid of to) {
      try {
        await notify(env, { userId: uid, kind: 'hava', title, body, link: '/cekim?id=' + s.id, meta: [s.time, s.location || o.place].filter(Boolean).join(' · ') });
        sent++;
      } catch (e) { console.error('hava uyarısı bildirimi', e); }
    }
  }
  return sent;
}
