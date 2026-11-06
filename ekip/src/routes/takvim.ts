// Takvim eşitleme: kişiye özel gizli iCalendar adresi (Google / iPhone / Mac takvimi abone olur)
// r: /api/takvim (giriş gerekli) · feed: /takvim/<token>.ics (girişsiz; token'ın yalnızca SHA-256 özeti saklanır)
import { Hono } from 'hono';
import type { Env, Vars } from '../types';
import { publicOrigin } from '../auth';
import { randomToken, sha256 } from '../util';

export const r = new Hono<{ Bindings: Env; Variables: Vars }>();
export const feed = new Hono<{ Bindings: Env }>();

export const GROUPS = ['shoots', 'tasks', 'agenda', 'special'] as const;
type Group = typeof GROUPS[number];
type Groups = Record<Group, boolean>;
const ALL_ON: Groups = { shoots: true, tasks: true, agenda: true, special: true };

interface FeedRow { user_id: string; token_hash: string | null; groups: string; created_at: string; updated_at: string; last_fetched_at: string | null }

function parseGroups(s: string | null | undefined): Groups {
  const g = { ...ALL_ON };
  try { const o = JSON.parse(s || '{}'); for (const k of GROUPS) if (typeof o?.[k] === 'boolean') g[k] = o[k]; } catch { /* */ }
  return g;
}
const getFeed = (env: Env, uid: string) => env.DB.prepare('SELECT * FROM calendar_feeds WHERE user_id = ?').bind(uid).first<FeedRow>();

function links(origin: string, token: string) {
  // takvim uygulamaları için her zaman https (yerel geliştirme hariç)
  const o = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : origin.replace(/^http:\/\//, 'https://');
  const url = o + '/takvim/' + token + '.ics';
  const webcal = url.replace(/^https?:\/\//, 'webcal://');
  return { url, webcal, google: 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(webcal) };
}
function stateOf(row: FeedRow | null) {
  return {
    active: !!row?.token_hash,
    groups: parseGroups(row?.groups),
    hint: row?.token_hash ? row.token_hash.slice(0, 10) : null, // tarayıcıda saklanan bağlantının hâlâ geçerli olup olmadığını anlamak için
    createdAt: row?.token_hash ? row.updated_at : null,
    fetchedAt: row?.token_hash ? row.last_fetched_at : null,
  };
}

// ---------- abonelik ayarları ----------
r.get('/', async (c) => c.json(stateOf(await getFeed(c.env, c.get('user').id))));

/** Yeni gizli bağlantı üretir (varsa eskisi anında geçersiz olur). Bağlantının kendisi yalnızca bu yanıtta döner. */
r.post('/yenile', async (c) => {
  const uid = c.get('user').id;
  const token = randomToken(32);
  const hash = await sha256(token);
  await c.env.DB.prepare(`INSERT INTO calendar_feeds (user_id, token_hash) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, updated_at = datetime('now'), last_fetched_at = NULL`).bind(uid, hash).run();
  return c.json({ ...stateOf(await getFeed(c.env, uid)), ...links(publicOrigin(c), token) });
});

r.patch('/', async (c) => {
  const uid = c.get('user').id;
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const g = b.groups as Record<string, unknown> | undefined;
  if (!g || typeof g !== 'object' || Array.isArray(g)) return c.json({ error: 'Takvim grupları geçersiz' }, 400);
  const row = await getFeed(c.env, uid);
  const next = parseGroups(row?.groups);
  for (const k of Object.keys(g)) {
    if (!(GROUPS as readonly string[]).includes(k) || typeof g[k] !== 'boolean') return c.json({ error: 'Takvim grupları geçersiz' }, 400);
    next[k as Group] = g[k] as boolean;
  }
  await c.env.DB.prepare(`INSERT INTO calendar_feeds (user_id, groups) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET groups = excluded.groups`).bind(uid, JSON.stringify(next)).run();
  return c.json(stateOf(await getFeed(c.env, uid)));
});

/** Aboneliği kapatır: bağlantı anında çalışmaz olur (gruplar saklanır). */
r.delete('/', async (c) => {
  const uid = c.get('user').id;
  await c.env.DB.prepare(`UPDATE calendar_feeds SET token_hash = NULL, last_fetched_at = NULL, updated_at = datetime('now') WHERE user_id = ?`).bind(uid).run();
  return c.json(stateOf(await getFeed(c.env, uid)));
});

// ---------- iCalendar (RFC 5545) ----------
const enc = new TextEncoder();
/** TEXT değer kaçışı: \ ; , ve satır sonu */
export function icsText(s: string): string {
  return String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\\;,]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
}
/** 75 sekizliyi aşan satırları katlar (UTF-8 karakterini bölmeden); devam satırı tek boşlukla başlar. */
export function icsFold(line: string): string {
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '', n = 0, limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (n + b > limit) { out.push(cur); cur = ' '; n = 1; limit = 75; }
    cur += ch; n += b;
  }
  out.push(cur);
  return out.join('\r\n');
}
const ymd = (d: string) => d.replace(/-/g, '');
const addDay = (d: string, n = 1) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const utcStamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d+/, '').replace(/^(\d{8})[ T](\d{6}).*$/, '$1T$2Z');
/** Sqlite 'YYYY-MM-DD HH:MM:SS' (UTC) → 20261106T101500Z */
const sqlUtc = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(s) ? utcStamp(s.slice(0, 19)) : null);
const pad = (n: number) => String(n).padStart(2, '0');
/** "10:00" → { h, m } */
function hm(t: string): { h: number; m: number } | null {
  const x = /^\s*(\d{1,2})[:.](\d{2})/.exec(t || '');
  if (!x) return null;
  const h = +x[1], m = +x[2];
  return h <= 23 && m <= 59 ? { h, m } : null;
}
/** İstanbul yerel saati (TZID ile): 20261106T100000 — tarih + dakika eklenerek */
function local(date: string, h: number, m: number, plusMin = 0): string {
  const t = Date.parse(date + 'T00:00:00Z') + (h * 60 + m + plusMin) * 60_000;
  const d = new Date(t);
  return d.toISOString().slice(0, 10).replace(/-/g, '') + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + '00';
}

const VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/Istanbul', 'X-LIC-LOCATION:Europe/Istanbul',
  'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0300', 'TZOFFSETTO:+0300', 'TZNAME:+03', 'END:STANDARD',
  'END:VTIMEZONE',
];
const RRULE: Record<string, string> = {
  daily: 'FREQ=DAILY', weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', weekly: 'FREQ=WEEKLY', monthly: 'FREQ=MONTHLY',
};

interface Ev {
  uid: string; summary: string; date: string; start?: { h: number; m: number }; endMin?: number; // dakika (başlangıçtan sonra)
  location?: string; description?: string; url?: string; rrule?: string; modified?: string | null; status?: string; categories?: string;
}
function vevent(e: Ev, stamp: string): string[] {
  const L = ['BEGIN:VEVENT', 'UID:' + e.uid, 'DTSTAMP:' + stamp];
  if (e.start) {
    L.push('DTSTART;TZID=Europe/Istanbul:' + local(e.date, e.start.h, e.start.m));
    L.push('DTEND;TZID=Europe/Istanbul:' + local(e.date, e.start.h, e.start.m, Math.max(15, e.endMin ?? 60)));
  } else {
    L.push('DTSTART;VALUE=DATE:' + ymd(e.date), 'DTEND;VALUE=DATE:' + ymd(addDay(e.date)), 'TRANSP:TRANSPARENT');
  }
  if (e.rrule) L.push('RRULE:' + e.rrule);
  L.push('SUMMARY:' + icsText(e.summary));
  if (e.location) L.push('LOCATION:' + icsText(e.location));
  if (e.description) L.push('DESCRIPTION:' + icsText(e.description));
  if (e.url) L.push('URL:' + e.url);
  if (e.categories) L.push('CATEGORIES:' + icsText(e.categories));
  if (e.status) L.push('STATUS:' + e.status);
  if (e.modified) L.push('LAST-MODIFIED:' + e.modified);
  L.push('END:VEVENT');
  return L;
}

const parseArr = (s: string): any[] => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };

/** Kişinin takvimi (iCalendar metni). Ajandam etkinlikleri YALNIZCA kendisinin. */
export async function buildIcs(env: Env, uid: string, firstName: string, groups: Groups, origin: string, now = new Date()): Promise<string> {
  const stamp = utcStamp(now.toISOString());
  const today = new Date(now.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
  const host = (() => { try { return new URL(origin).host; } catch { return 'ekip.mayaajans.net'; } })();
  const evs: Ev[] = [];
  const q = <T>(sql: string, ...b: unknown[]) => env.DB.prepare(sql).bind(...b).all<T>().then((x) => x.results);

  if (groups.shoots) {
    const shoots = await q<{ id: string; title: string; client: string; date: string; time: string; location: string; status: number; note: string; crew: string; outdoor: number; updated_at: string }>(
      `SELECT s.id, s.title, s.client, s.date, s.time, s.location, s.status, s.note, s.crew, s.outdoor, s.updated_at FROM shoots s
       WHERE s.status != 2 AND s.date >= ? AND EXISTS (SELECT 1 FROM json_each(s.crew) j WHERE j.value = ?)`, addDay(today, -120), uid);
    const users = await q<{ id: string; first_name: string; last_name: string }>("SELECT id, first_name, last_name FROM users WHERE status != 'removed'");
    const nm = new Map(users.map((u) => [u.id, (u.first_name + ' ' + u.last_name).trim()]));
    for (const s of shoots) {
      const times = [...(s.time || '').matchAll(/(\d{1,2})[:.](\d{2})/g)];
      const st = hm(s.time);
      let endMin = 120;
      if (st && times.length >= 2) {
        const e2 = +times[1][1] * 60 + +times[1][2] - (st.h * 60 + st.m);
        if (e2 > 0) endMin = e2;
      }
      const crew = parseArr(s.crew).map((x) => nm.get(x)).filter(Boolean);
      const desc = [
        s.client && 'Firma: ' + s.client,
        s.time && 'Saat: ' + s.time,
        s.outdoor ? 'Dış çekim' : '',
        crew.length ? 'Ekip: ' + crew.join(', ') : '',
        s.status === 1 ? 'Durum: Tamamlandı' : '',
        s.note && '\n' + s.note,
        '\n' + origin + '/cekim?id=' + s.id,
      ].filter(Boolean).join('\n');
      evs.push({
        uid: 'cekim-' + s.id + '@' + host, date: s.date, start: st || undefined, endMin,
        summary: '🎬 ' + [s.title, s.client].filter(Boolean).join(' · ') + (!st && s.time ? ' (' + s.time + ')' : ''),
        location: s.location, description: desc, url: origin + '/cekim?id=' + s.id, modified: sqlUtc(s.updated_at),
        status: 'CONFIRMED', categories: 'Çekim',
      });
    }
  }

  if (groups.tasks) {
    const tasks = await q<{ id: string; title: string; client: string; due_date: string; note: string; status: number; updated_at: string }>(
      `SELECT id, title, client, due_date, note, status, updated_at FROM tasks WHERE assignee_id = ? AND status != 2 AND due_date IS NOT NULL AND due_date >= ?`,
      uid, addDay(today, -60));
    for (const t of tasks) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t.due_date)) continue;
      evs.push({
        uid: 'teslim-' + t.id + '@' + host, date: t.due_date,
        summary: 'Teslim: ' + t.title + (t.client ? ' · ' + t.client : ''),
        description: [t.status === 1 ? 'Durum: Devam ediyor' : 'Durum: Beklemede', t.note && '\n' + t.note, '\n' + origin + '/isler?is=' + t.id].filter(Boolean).join('\n'),
        url: origin + '/isler?is=' + t.id, modified: sqlUtc(t.updated_at), categories: 'Teslim',
      });
    }
  }

  if (groups.agenda) {
    // Ajandam kişiye özeldir: yalnızca bu kişinin (user_id) etkinlikleri
    const evRows = await q<{ id: string; title: string; date: string; start_time: string; end_time: string; note: string; repeat: string; updated_at: string }>(
      `SELECT id, title, date, start_time, end_time, note, repeat, updated_at FROM agenda_events
       WHERE user_id = ? AND (date >= ? OR repeat != 'none')`, uid, addDay(today, -120));
    for (const e of evRows) {
      const st = hm(e.start_time);
      const en = hm(e.end_time);
      let endMin = 60;
      if (st && en) { const d = en.h * 60 + en.m - (st.h * 60 + st.m); if (d > 0) endMin = d; }
      evs.push({
        uid: 'ajanda-' + e.id + '@' + host, date: e.date, start: st || undefined, endMin,
        summary: e.title, description: e.note || undefined, rrule: RRULE[e.repeat], modified: sqlUtc(e.updated_at), categories: 'Ajandam',
      });
    }
  }

  if (groups.special) {
    const days = await q<{ id: string; name: string; date: string; star: number; note: string; range_label: string | null; updated_at: string }>(
      'SELECT id, name, date, star, note, range_label, updated_at FROM special_days WHERE date >= ?', addDay(today, -60));
    for (const d of days) {
      evs.push({
        uid: 'ozelgun-' + d.id + '@' + host, date: d.date,
        summary: (d.star ? '⭐ ' : '') + d.name,
        description: [d.range_label, d.note, origin + '/ozel-gunler?id=' + d.id].filter(Boolean).join('\n'),
        url: origin + '/ozel-gunler?id=' + d.id, modified: sqlUtc(d.updated_at), categories: 'Özel gün',
      });
    }
  }

  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Maya Ajans//Maya Ekip//TR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + icsText('Maya Ekip · ' + (firstName || 'Ekip')),
    'X-WR-CALDESC:' + icsText('Maya Ekip programından çekimler, teslimler, Ajandam ve özel günler'),
    'X-WR-TIMEZONE:Europe/Istanbul',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
    ...VTIMEZONE,
  ];
  for (const e of evs) lines.push(...vevent(e, stamp));
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

// ---------- abonelik adresi (girişsiz) ----------
feed.get('/:file', async (c) => {
  const file = c.req.param('file');
  const notFound = () => c.text('Takvim bulunamadı', 404, { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  const m = /^([A-Za-z0-9_-]{20,100})\.ics$/.exec(file || '');
  if (!m) return notFound();
  const hash = await sha256(m[1]);
  const row = await c.env.DB.prepare(
    `SELECT f.user_id, f.groups, f.last_fetched_at, u.first_name FROM calendar_feeds f JOIN users u ON u.id = f.user_id
     WHERE f.token_hash = ? AND u.status = 'active'`,
  ).bind(hash).first<{ user_id: string; groups: string; last_fetched_at: string | null; first_name: string }>();
  if (!row) return notFound();
  const body = await buildIcs(c.env, row.user_id, row.first_name, parseGroups(row.groups), publicOrigin(c));
  // son çekilme zamanı (en fazla 10 dakikada bir yazılır)
  c.executionCtx.waitUntil(c.env.DB.prepare(
    `UPDATE calendar_feeds SET last_fetched_at = datetime('now') WHERE token_hash = ? AND (last_fetched_at IS NULL OR last_fetched_at < datetime('now', '-10 minutes'))`,
  ).bind(hash).run().catch(() => {}));
  return c.body(body, 200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': 'inline; filename="maya-ekip.ics"',
    'Cache-Control': 'private, max-age=300',
    'X-Robots-Tag': 'noindex',
  });
});
