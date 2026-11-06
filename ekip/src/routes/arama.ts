// ⌘K hızlı arama: müşteri, iş, çekim, özel gün, (kendi) Ajandam notları/yapılacakları, (erişebildiği) sohbet mesajları, kişiler
//
// Türkçe duyarsız eşleştirme: SQLite LIKE/lower() yalnızca ASCII harfleri bilir. Bu yüzden alanlar SQL içinde iç içe
// replace() ile "katlanır" (Ç→c, Ş→s, Ğ→g, Ü→u, Ö→o, İ/I/ı→i, Â→a …) ve lower() ile küçültülür; sorgu da JS'te aynı
// şekilde katlanıp instr() ile aranır. Her harf tek harfe dönüştüğü için konumlar korunur (vurgulama istemcide aynı katlamayla yapılır).
import { Hono } from 'hono';
import type { Env, Vars } from '../types';
export const r = new Hono<{ Bindings: Env; Variables: Vars }>();

const PER = 6;
const MAX_Q = 80;
const MAX_TOKENS = 4;

// harf → katlanmış ASCII karşılığı (istemcideki fold() ile aynı)
const FOLD: [string, string][] = [
  ['Ç', 'c'], ['ç', 'c'], ['Ş', 's'], ['ş', 's'], ['Ğ', 'g'], ['ğ', 'g'], ['Ü', 'u'], ['ü', 'u'], ['Ö', 'o'], ['ö', 'o'],
  ['İ', 'i'], ['I', 'i'], ['ı', 'i'], ['Â', 'a'], ['â', 'a'], ['Î', 'i'], ['î', 'i'], ['Û', 'u'], ['û', 'u'],
];
const FOLD_MAP = new Map(FOLD);
const fold = (s: string) => Array.from(s, (ch) => FOLD_MAP.get(ch) ?? (ch >= 'A' && ch <= 'Z' ? ch.toLowerCase() : ch)).join('');

/** SQL ifadesi: alanın katlanmış küçük harfli hali */
const sqlFold = (expr: string) => 'lower(' + FOLD.reduce((acc, [a, b]) => `replace(${acc}, '${a}', '${b}')`, expr) + ')';

/** Her kelime alanlardan birinde (birleşik metinde) geçmeli. Bağlanacak değerleri `binds`e ekler. */
function matchAll(fields: string[], tokens: string[], binds: unknown[]): string {
  const hay = sqlFold(fields.map((f) => `COALESCE(${f}, '')`).join(` || ' ' || `));
  return tokens.map((tk) => { binds.push(tk); return `instr(${hay}, ?${binds.length}) > 0`; }).join(' AND ');
}

/** Metinden eşleşmenin çevresini al */
function snippet(text: string, tokens: string[], span = 70): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= span * 2) return t;
  const f = fold(t);
  let at = -1;
  for (const tk of tokens) { const i = f.indexOf(tk); if (i >= 0 && (at < 0 || i < at)) at = i; }
  const s = Math.max(0, at < 0 ? 0 : at - Math.floor(span / 2));
  const e = Math.min(t.length, s + span * 2);
  return (s > 0 ? '…' : '') + t.slice(s, e) + (e < t.length ? '…' : '');
}

const iso = (s: string | null) => (s ? s.replace(' ', 'T') + (/[zZ]$/.test(s) ? '' : 'Z') : null);

r.get('/', async (c) => {
  const t0 = Date.now();
  const me = c.get('user');
  const raw = (c.req.query('q') || '').replace(/\s+/g, ' ').trim().slice(0, MAX_Q);
  const q = fold(raw);
  const tokens = [...new Set(q.split(' ').filter(Boolean))].slice(0, MAX_TOKENS);
  if (Array.from(q.replace(/ /g, '')).length < 2) {
    return c.json({ q: raw, tasks: [], clients: [], shoots: [], days: [], agenda: [], messages: [], people: [], ms: 0 });
  }

  const DB = c.env.DB;
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10); // İstanbul (UTC+3)
  /** `%W` yerine eşleşme koşulu konur; `extra` değerleri ?1, ?2 … olarak önce bağlanır */
  const q1 = (sql: string, fields: string[], extra: unknown[] = []) => {
    const binds = [...extra];
    const where = matchAll(fields, tokens, binds);
    return DB.prepare(sql.replace('%W', where)).bind(...binds);
  };

  const [tasks, clients, shoots, days, notes, todos, events, msgs, people] = await DB.batch([
    q1(`SELECT id, title, client, due_date, status, assignee_id FROM tasks WHERE %W
        ORDER BY status = 2, due_date IS NULL, due_date, created_at DESC LIMIT ${PER}`, ['title', 'client', 'note']),
    q1(`SELECT id, name FROM clients WHERE archived = 0 AND %W ORDER BY name LIMIT ${PER}`, ['name']),
    q1(`SELECT id, title, client, date, time, location, status FROM shoots WHERE %W
        ORDER BY status != 0, CASE WHEN status = 0 THEN date END, date DESC LIMIT ${PER}`, ['title', 'client', 'location']),
    q1(`SELECT id, name, date, range_label FROM special_days WHERE %W
        ORDER BY date < ?1, CASE WHEN date >= ?1 THEN date END, date DESC LIMIT ${PER}`, ['name'], [today]),
    // Ajandam: yalnızca kişinin kendi kayıtları
    q1(`SELECT id, title, body, kind FROM agenda_notes WHERE user_id = ?1 AND %W ORDER BY pinned DESC, updated_at DESC LIMIT ${PER}`, ['title', 'body'], [me.id]),
    q1(`SELECT id, title, due_date, done FROM agenda_todos WHERE user_id = ?1 AND %W
        ORDER BY done, due_date IS NULL, due_date LIMIT ${PER}`, ['title', 'note'], [me.id]),
    q1(`SELECT id, title, date, start_time, repeat FROM agenda_events WHERE user_id = ?1 AND %W
        ORDER BY date < ?2 AND repeat = 'none', CASE WHEN date >= ?2 THEN date END, date DESC LIMIT ${PER}`, ['title', 'note'], [me.id, today]),
    // Sohbet: genel + müşteri kanalları + kendi birebir konuşmaları; silinen mesajlar hariç
    q1(`SELECT m.id, m.channel_id, m.user_id, m.text, m.created_at, ch.name AS ch_name, ch.kind AS ch_kind, ch.dm_key
        FROM messages m JOIN channels ch ON ch.id = m.channel_id
        WHERE m.deleted = 0 AND ch.archived = 0
          AND (ch.kind != 'dm' OR substr(ch.dm_key, 1, length(?1) + 1) = ?1 || '|' OR substr(ch.dm_key, -(length(?1) + 1)) = '|' || ?1)
          AND %W
        ORDER BY m.created_at DESC LIMIT ${PER}`, ['m.text'], [me.id]),
    q1(`SELECT id, first_name, last_name, color, photo FROM users WHERE status = 'active' AND id != ?1 AND %W
        ORDER BY first_name LIMIT ${PER}`, ['first_name', 'last_name'], [me.id]),
  ]);

  type Row = Record<string, any>;
  const rows = (x: { results?: unknown[] }) => (x.results || []) as Row[];
  const agenda = [
    ...rows(todos).map((t) => ({ type: 'todo', id: t.id, title: t.title, date: t.due_date, done: !!t.done, link: '/ajanda?r=' + t.id })),
    ...rows(events).map((e) => ({ type: 'event', id: e.id, title: e.title, date: e.date, time: e.start_time || '', done: e.repeat === 'none' && e.date < today, link: '/ajanda?r=' + e.id })),
    ...rows(notes).map((n) => ({ type: 'note', id: n.id, title: n.title || snippet(n.body || '', tokens, 30) || 'Adsız not', date: null, done: false, link: '/ajanda?not=' + n.id })),
  ].sort((a, b) => Number(a.done) - Number(b.done)).slice(0, PER);

  const messages = rows(msgs)
    .filter((m) => m.ch_kind !== 'dm' || String(m.dm_key || '').split('|').includes(me.id)) // ikinci güvence
    .map((m) => ({
      id: m.id, channelId: m.channel_id, userId: m.user_id, text: snippet(m.text, tokens), createdAt: iso(m.created_at),
      channel: m.ch_kind === 'dm' ? null : m.ch_name, kind: m.ch_kind,
      dmWith: m.ch_kind === 'dm' ? (String(m.dm_key).split('|').find((x) => x !== me.id) ?? me.id) : null,
      link: '/sohbet?c=' + m.channel_id,
    }));

  return c.json({
    q: raw,
    tasks: rows(tasks).map((t) => ({ id: t.id, title: t.title, client: t.client, dueDate: t.due_date, status: t.status, assigneeId: t.assignee_id, done: t.status === 2 })),
    clients: rows(clients).map((x) => ({ id: x.id, name: x.name, link: '/musteriler?id=' + x.id })),
    shoots: rows(shoots).map((s) => ({ id: s.id, title: s.title, client: s.client, date: s.date, time: s.time, location: s.location, status: s.status, done: s.status !== 0, link: '/cekim?id=' + s.id })),
    days: rows(days).map((d) => ({ id: d.id, name: d.name, date: d.date, range: d.range_label, done: d.date < today, link: '/ozel-gunler?id=' + d.id })),
    agenda,
    messages,
    people: rows(people).map((p) => ({ id: p.id, firstName: p.first_name, lastName: p.last_name, color: p.color, photo: p.photo })),
    ms: Date.now() - t0,
  });
});
