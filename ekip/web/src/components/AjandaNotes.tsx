// Ajandam: notlar (iş / kişisel), ekran görüntüleri ve dosyalar, büyük önizleme
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { snack, LMON } from '../api';
import { Icon, useStore, Portal } from '../ui';
import { type Note, type AFile, type Check, COLORS, agendaApi, uploadFile, fmtSize, lower, isoLocal, dayWord } from './AjandaData';

const noteTitle = (n: Pick<Note, 'title' | 'body'>) => n.title.trim() || n.body.trim().split('\n')[0].slice(0, 80) || 'Başlıksız not';
const isEmpty = (n: Pick<Note, 'title' | 'body' | 'checks'>, files: number) => !n.title.trim() && !n.body.trim() && !n.checks.some((c) => c.text.trim()) && files === 0;
const kid = () => 'k' + Math.random().toString(36).slice(2, 10);
function when(iso: string) {
  const l = isoLocal(iso); const d = l.slice(0, 10);
  const w = dayWord(d);
  return /^(Bugün|Dün)$/.test(w) ? w + ' ' + l.slice(11, 16) : w;
}
/** Panodan/sürüklemeden gelen dosyalar */
const filesOf = (dt: DataTransfer | null): File[] => {
  if (!dt) return [];
  const out: File[] = [];
  if (dt.items && dt.items.length) { for (const it of Array.from(dt.items)) if (it.kind === 'file') { const f = it.getAsFile(); if (f) out.push(f); } }
  else for (const f of Array.from(dt.files || [])) out.push(f);
  return out;
};
/** Not yokken yapıştırılan dosyalar: yeni not açılınca editör yükler */
let pending: { noteId: string; files: File[] } | null = null;
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,.heic,.heif,application/pdf';
const MAX = 15 * 1024 * 1024;

export function NotesView({ notes, setNotes, openId, setOpenId, wantNew, onConsumed }: {
  notes: Note[]; setNotes: (f: (l: Note[]) => Note[]) => void; openId: string | null; setOpenId: (id: string | null) => void;
  wantNew: boolean; onConsumed: () => void;
}) {
  const s = useStore();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | 'work' | 'personal'>(() => { try { return (localStorage.getItem('maya.ajanda.kind') as any) || 'all'; } catch { return 'all'; } });
  useEffect(() => { try { localStorage.setItem('maya.ajanda.kind', kind); } catch { /* */ } }, [kind]);
  const replace = (n: Note) => setNotes((l) => (l.some((x) => x.id === n.id) ? l.map((x) => (x.id === n.id ? n : x)) : [n, ...l]));

  async function create(extra: Record<string, unknown> = {}, files?: File[]) {
    try {
      const n = await agendaApi.addNote({ kind: kind === 'personal' ? 'personal' : 'work', ...extra });
      if (files) pending = { noteId: n.id, files };
      replace(n); setOpenId(n.id);
      return n;
    } catch (e: any) { snack(e.message); return null; }
  }
  // N kısayolu / "Yeni not" düğmesi
  useEffect(() => { if (wantNew) { onConsumed(); create(); } }, [wantNew]);

  // not açık değilken yapıştırılan ekran görüntüsü → yeni not
  useEffect(() => {
    const f = async (e: ClipboardEvent) => {
      if (openId) return; // editör kendi yakalar
      const files = filesOf(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      await create({ title: 'Ekran görüntüsü' }, files);
    };
    document.addEventListener('paste', f);
    return () => document.removeEventListener('paste', f);
  }, [openId, kind]);

  const clientName = (id: string | null) => (id ? s.clients.find((c) => c.id === id)?.name || '' : '');
  const list = useMemo(() => {
    const ql = lower(q.trim());
    return notes
      .filter((n) => kind === 'all' || n.kind === kind)
      .filter((n) => !ql || lower([n.title, n.body, n.checks.map((c) => c.text).join(' '), clientName(n.clientId), n.files.map((f) => f.name).join(' ')].join(' ')).includes(ql))
      .sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : a.updatedAt < b.updatedAt ? 1 : -1));
  }, [notes, q, kind, s.clients]);
  const opened = openId ? notes.find((n) => n.id === openId) || null : null;
  const counts = { all: notes.length, work: notes.filter((n) => n.kind === 'work').length, personal: notes.filter((n) => n.kind === 'personal').length };

  return (
    <div class={'aj-notes' + (opened ? ' has-open' : '')}>
      <section class="panel aj-panel aj-nlist" aria-label="Notlar">
        <div class="aj-ph">
          <h2>Notlarım<span>{notes.length}</span></h2><span class="spacer" />
          <button type="button" class="btn primary sm" onClick={() => create()}><Icon n="plus" size={14} w={2.4} />Yeni not</button>
        </div>
        <label class="aj-search"><Icon n="search" size={15} /><span class="sr">Notlarda ara</span>
          <input type="search" value={q} placeholder="Notlarda ara…" onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        </label>
        <div class="seg aj-seg-sm" role="group" aria-label="Not türü">
          {([['all', 'Tümü'], ['work', 'İş'], ['personal', 'Kişisel']] as const).map(([k, l]) => (
            <button type="button" class={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>{l} <span class="sub">{counts[k]}</span></button>
          ))}
        </div>
        {list.length ? (
          <ul class="aj-nitems">
            {list.map((n) => {
              const img = n.files.find((f) => f.inline);
              const ch = n.checks.filter((c) => c.text.trim());
              return (
                <li>
                  <button type="button" class={'aj-nitem' + (n.id === openId ? ' on' : '') + (n.color ? ' c-' + n.color : '')} aria-current={n.id === openId ? 'true' : undefined} onClick={() => setOpenId(n.id)}>
                    <span class="aj-nitem-t">{n.pinned && <span class="aj-pin" aria-label="Sabitlendi">📌</span>}{noteTitle(n)}</span>
                    {n.body.trim() && n.title.trim() && <span class="aj-nitem-s">{n.body.trim().slice(0, 140)}</span>}
                    <span class="aj-nitem-m">
                      <span>{when(n.updatedAt)}</span>
                      <span class={'aj-kind ' + n.kind}>{n.kind === 'work' ? 'İş' : 'Kişisel'}</span>
                      {n.clientId && clientName(n.clientId) && <span><Icon n="clients" size={11} />{clientName(n.clientId)}</span>}
                      {ch.length > 0 && <span><Icon n="check" size={11} />{ch.filter((c) => c.done).length}/{ch.length}</span>}
                      {n.files.length > 0 && <span><Icon n="camera" size={11} />{n.files.length}</span>}
                    </span>
                    {img && <img class="aj-nitem-img" src={img.url} alt="" loading="lazy" />}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : <p class="empty">{notes.length ? 'Aramaya uyan not yok.' : 'Henüz not yok. “Yeni not” (N) ile başla ya da bir ekran görüntüsünü buraya yapıştır (⌘V).'}</p>}
      </section>
      {opened ? (
        <NoteEditor key={opened.id} note={opened} onChange={replace} onClose={() => setOpenId(null)}
          onDiscard={(id) => setNotes((l) => l.filter((x) => x.id !== id))}
          onDeleted={(id) => { setNotes((l) => l.filter((x) => x.id !== id)); setOpenId(null); }} />
      ) : (
        <section class="panel aj-editor aj-ghost" aria-label="Not">
          <Icon n="note" size={30} />
          <p>Bir not seç ya da <strong>Yeni not</strong> oluştur.</p>
          <p class="sub">Ekran görüntüsünü doğrudan buraya yapıştırabilirsin: Mac’te <kbd>⌘</kbd><kbd>⇧</kbd><kbd>⌃</kbd><kbd>4</kbd> ile panoya al, sonra <kbd>⌘</kbd><kbd>V</kbd>.</p>
        </section>
      )}
    </div>
  );
}

type Draft = Pick<Note, 'title' | 'body' | 'checks'>;

function NoteEditor({ note, onChange, onClose, onDeleted, onDiscard }: {
  note: Note; onChange: (n: Note) => void; onClose: () => void; onDeleted: (id: string) => void; onDiscard: (id: string) => void;
}) {
  const s = useStore();
  const [d, setD] = useState<Draft>({ title: note.title, body: note.body, checks: note.checks });
  const [status, setStatus] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const [uploading, setUploading] = useState(0);
  const [over, setOver] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [lb, setLb] = useState<number | null>(null);
  const [showChecks, setShowChecks] = useState(note.checks.length > 0);
  const dRef = useRef(d); dRef.current = d;
  const dirtyRef = useRef(false);
  const timer = useRef<any>(null);
  const noteRef = useRef(note); noteRef.current = note;
  const upRef = useRef(0); upRef.current = uploading;
  const fileInput = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const checkRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [focusCheck, setFocusCheck] = useState<string | null>(null);

  // başka pencerede değiştiyse ve burada yazılmamış bir şey yoksa güncel hâli al
  useEffect(() => {
    if (!dirtyRef.current) setD({ title: note.title, body: note.body, checks: note.checks });
  }, [note.updatedAt]);

  async function flush() {
    clearTimeout(timer.current);
    if (!dirtyRef.current) return;
    dirtyRef.current = false; setStatus('saving');
    const cur = dRef.current;
    try {
      const n = await agendaApi.patchNote(note.id, { title: cur.title, body: cur.body, checks: cur.checks.filter((c, i, a) => c.text.trim() || i === a.length - 1) });
      if (!dirtyRef.current) setStatus('saved');
      onChange({ ...n, ...(dirtyRef.current ? dRef.current : {}) });
    } catch (e: any) { dirtyRef.current = true; setStatus('error'); snack(e.message); }
  }
  const edit = (p: Partial<Draft>) => {
    setD((x) => ({ ...x, ...p })); dirtyRef.current = true; setStatus('dirty');
    clearTimeout(timer.current); timer.current = setTimeout(flush, 1500);
  };
  async function quick(p: Record<string, unknown>) {
    try { onChange(await agendaApi.patchNote(note.id, p)); } catch (e: any) { snack(e.message); }
  }
  // kapanırken: bekleyen yazıyı kaydet, tamamen boş kaldıysa notu sil
  useEffect(() => () => {
    clearTimeout(timer.current);
    const cur = dRef.current;
    if (isEmpty(cur, noteRef.current.files.length) && !upRef.current) { agendaApi.delNote(note.id).catch(() => {}); onDiscard(note.id); return; }
    if (dirtyRef.current) agendaApi.patchNote(note.id, { title: cur.title, body: cur.body, checks: cur.checks }).then(onChange).catch(() => {});
  }, []);
  useEffect(() => { const f = () => { if (dirtyRef.current) flush(); }; window.addEventListener('beforeunload', f); return () => window.removeEventListener('beforeunload', f); }, []);

  async function upload(files: File[]) {
    for (const f of files) {
      if (f.size > MAX) { snack('“' + (f.name || 'Dosya') + '” 15 MB’tan büyük'); continue; }
      setUploading((n) => n + 1);
      try {
        const af = await uploadFile(note.id, f);
        onChange({ ...noteRef.current, files: [...noteRef.current.files.filter((x) => x.id !== af.id), af], updatedAt: new Date().toISOString() });
      } catch (e: any) { snack(e.message); }
      finally { setUploading((n) => n - 1); }
    }
  }
  // not açıkken yapıştır: görsel varsa nota ekle (yazı yapıştırma olağan çalışır)
  useEffect(() => {
    const f = (e: ClipboardEvent) => { const files = filesOf(e.clipboardData); if (!files.length) return; e.preventDefault(); upload(files); };
    if (pending && pending.noteId === note.id) { const fs = pending.files; pending = null; upload(fs); }
    document.addEventListener('paste', f);
    return () => document.removeEventListener('paste', f);
  }, []);
  // yeni maddeye odak: ekrana çizilmeden önce (hızlı yazınca ilk harf önceki maddeye kaçmasın)
  useLayoutEffect(() => { if (focusCheck) { checkRefs.current[focusCheck]?.focus(); setFocusCheck(null); } }, [focusCheck, d.checks]);

  async function delFile(f: AFile) {
    if (!window.confirm('“' + f.name + '” silinsin mi?')) return;
    try { await agendaApi.delFile(f.id); onChange({ ...noteRef.current, files: noteRef.current.files.filter((x) => x.id !== f.id) }); setLb(null); }
    catch (e: any) { snack(e.message); }
  }
  async function del() {
    if (!confirm) { setConfirm(true); setTimeout(() => setConfirm(false), 4000); return; }
    clearTimeout(timer.current); dirtyRef.current = false;
    try { await agendaApi.delNote(note.id); snack('Not silindi'); onDeleted(note.id); } catch (e: any) { snack(e.message); }
  }
  const setCheck = (id: string, p: Partial<Check>) => edit({ checks: d.checks.map((c) => (c.id === id ? { ...c, ...p } : c)) });
  const addCheck = (after?: string) => {
    const nc = { id: kid(), text: '', done: false };
    const i = after ? d.checks.findIndex((c) => c.id === after) + 1 : d.checks.length;
    edit({ checks: [...d.checks.slice(0, i), nc, ...d.checks.slice(i)] }); setFocusCheck(nc.id); setShowChecks(true);
  };
  const st = { saved: 'Kaydedildi', dirty: 'Yazılıyor…', saving: 'Kaydediliyor…', error: 'Kaydedilemedi · tekrar denenecek' }[status];
  const created = isoLocal(note.createdAt);

  return (
    <section class={'panel aj-editor' + (note.color ? ' c-' + note.color : '') + (over ? ' over' : '')} aria-label="Not düzenleyici"
      onDragOver={(e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); const fs = filesOf(e.dataTransfer); if (fs.length) upload(fs); }}>
      <div class="aj-etop">
        <button type="button" class="iconbtn aj-back" aria-label="Not listesine dön" onClick={() => { flush(); onClose(); }}>‹</button>
        <div class="seg aj-seg-sm" role="group" aria-label="Not türü">
          <button type="button" class={note.kind === 'work' ? 'on' : ''} aria-pressed={note.kind === 'work'} onClick={() => quick({ kind: 'work' })}>İş</button>
          <button type="button" class={note.kind === 'personal' ? 'on' : ''} aria-pressed={note.kind === 'personal'} onClick={() => quick({ kind: 'personal' })}>Kişisel</button>
        </div>
        <div class="aj-colors" role="radiogroup" aria-label="Renk etiketi">
          {COLORS.map((c) => <button type="button" role="radio" aria-checked={note.color === c.key} aria-label={c.label} title={c.label} class={'aj-color c-' + (c.key || 'none')} onClick={() => quick({ color: c.key })} />)}
        </div>
        <span class="spacer" />
        <span class={'aj-save ' + status} role="status" aria-live="polite">{status === 'saved' ? <Icon n="check" size={13} w={2.6} /> : null}{st}</span>
        <button type="button" class={'iconbtn' + (note.pinned ? ' aj-on' : '')} aria-pressed={note.pinned} aria-label={note.pinned ? 'Sabitlemeyi kaldır' : 'Üste sabitle'} title={note.pinned ? 'Sabitlemeyi kaldır' : 'Üste sabitle'} onClick={() => quick({ pinned: !note.pinned })}>📌</button>
        <button type="button" class={'btn sm danger' + (confirm ? ' confirm' : '')} onClick={del}>{confirm ? 'Eminim, sil' : 'Sil'}</button>
      </div>
      <input class="aj-etitle" value={d.title} maxLength={200} placeholder="Başlık" aria-label="Not başlığı"
        onInput={(e) => edit({ title: (e.target as HTMLInputElement).value })} onBlur={flush}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); bodyRef.current?.focus(); } }} />
      <div class="aj-emeta">
        <label class="aj-client"><Icon n="clients" size={13} /><span class="sr">Müşteri</span>
          <select value={note.clientId || ''} onChange={(e) => quick({ clientId: (e.target as HTMLSelectElement).value || null })}>
            <option value="">Müşteri bağlantısı yok</option>
            {s.clients.map((c) => <option value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <span class="sub">Oluşturuldu {+created.slice(8, 10)} {LMON[+created.slice(5, 7) - 1]} {created.slice(11, 16)}</span>
      </div>
      <textarea ref={bodyRef} class="aj-ebody" value={d.body} placeholder="Notunu yaz… (otomatik kaydedilir)" aria-label="Not metni"
        rows={Math.max(6, Math.min(30, d.body.split('\n').length + 1))}
        onInput={(e) => edit({ body: (e.target as HTMLTextAreaElement).value })} onBlur={flush} />

      {showChecks || d.checks.length ? (
        <div class="aj-checks" role="group" aria-label="Kontrol listesi">
          <h3 class="aj-h3">Kontrol listesi {d.checks.length > 0 && <span class="sub">{d.checks.filter((c) => c.done).length}/{d.checks.length}</span>}</h3>
          {d.checks.map((c) => (
            <div class={'aj-check' + (c.done ? ' done' : '')}>
              <input type="checkbox" checked={c.done} aria-label={(c.done ? 'İşareti kaldır: ' : 'İşaretle: ') + (c.text || 'madde')} onChange={() => { setCheck(c.id, { done: !c.done }); }} />
              <input type="text" class="aj-ctext" ref={(el) => { checkRefs.current[c.id] = el; }} value={c.text} maxLength={300} placeholder="Madde" aria-label="Madde"
                onInput={(e) => setCheck(c.id, { text: (e.target as HTMLInputElement).value })} onBlur={flush}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addCheck(c.id); }
                  else if (e.key === 'Backspace' && !c.text) { e.preventDefault(); const i = d.checks.findIndex((x) => x.id === c.id); edit({ checks: d.checks.filter((x) => x.id !== c.id) }); const prev = d.checks[i - 1]; if (prev) setFocusCheck(prev.id); }
                }} />
              <button type="button" class="aj-cx" aria-label={'Maddeyi sil: ' + (c.text || 'boş')} onClick={() => edit({ checks: d.checks.filter((x) => x.id !== c.id) })}>×</button>
            </div>
          ))}
          <button type="button" class="btn sm ghost aj-addc" onClick={() => addCheck()}><Icon n="plus" size={13} />Madde ekle</button>
        </div>
      ) : null}

      <div class="aj-files">
        <div class="aj-ph">
          <h3 class="aj-h3">Ekran görüntüleri ve dosyalar {note.files.length > 0 && <span class="sub">{note.files.length}</span>}</h3>
          <span class="spacer" />
          {!showChecks && !d.checks.length && <button type="button" class="btn sm ghost" onClick={() => addCheck()}><Icon n="check" size={13} />Kontrol listesi</button>}
          <button type="button" class="btn sm" onClick={() => fileInput.current?.click()}><Icon n="plus" size={13} />Dosya seç</button>
          <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden aria-label="Dosya seç"
            onChange={(e) => { const el = e.target as HTMLInputElement; const fs = Array.from(el.files || []); el.value = ''; if (fs.length) upload(fs); }} />
        </div>
        {note.files.length > 0 && (
          <ul class="aj-thumbs">
            {note.files.map((f, i) => (
              <li class="aj-thumb">
                <button type="button" class="aj-thumb-b" onClick={() => setLb(i)} aria-label={'Büyüt: ' + f.name}>
                  {f.inline ? <img src={f.url} alt={f.name} loading="lazy" /> : <span class="aj-fileic">{f.type === 'application/pdf' ? 'PDF' : 'HEIC'}</span>}
                </button>
                <span class="aj-thumb-n" title={f.name}>{f.name}</span>
                <span class="aj-thumb-a">
                  <a class="iconbtn" href={f.url + '?download'} download={f.name} aria-label={'İndir: ' + f.name} title="İndir">↓</a>
                  <button type="button" class="iconbtn" aria-label={'Sil: ' + f.name} title="Sil" onClick={() => delFile(f)}><Icon n="x" size={13} /></button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div class={'aj-drop' + (over ? ' on' : '')} onClick={() => fileInput.current?.click()} role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.current?.click(); } }}>
          {uploading > 0 ? <strong>Yükleniyor… ({uploading})</strong> : over ? <strong>Bırak, nota eklensin</strong> : (
            <span>Ekran görüntüsünü <strong>yapıştır</strong> (<kbd>⌘</kbd><kbd>V</kbd>), buraya <strong>sürükle</strong> ya da tıklayıp seç · PNG, JPG, WEBP, GIF, HEIC, PDF · en fazla 15 MB</span>
          )}
        </div>
      </div>
      {lb !== null && note.files[lb] && <Portal><Lightbox files={note.files} index={lb} setIndex={setLb} onDelete={delFile} /></Portal>}
    </section>
  );
}

function Lightbox({ files, index, setIndex, onDelete }: { files: AFile[]; index: number; setIndex: (i: number | null) => void; onDelete: (f: AFile) => void }) {
  const f = files[index];
  const cur = useRef(index); cur.current = index;
  const go = (n: number) => { cur.current = (cur.current + n + files.length) % files.length; setIndex(cur.current); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setIndex(null); }
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true);
  }, [files.length]);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  return (
    <div class="aj-lb" role="dialog" aria-modal="true" aria-label={'Önizleme: ' + f.name}>
      <button type="button" class="aj-lb-scrim" aria-label="Kapat" onClick={() => setIndex(null)} />
      <div class="aj-lb-bar">
        <span class="aj-lb-n">{f.name} <span>{index + 1}/{files.length} · {fmtSize(f.size)}</span></span>
        <a class="btn sm" href={f.url + '?download'} download={f.name}>İndir</a>
        <button type="button" class="btn sm danger" onClick={() => onDelete(f)}>Sil</button>
        <button type="button" class="btn sm" ref={closeRef} aria-label="Kapat (Esc)" onClick={() => setIndex(null)}><Icon n="x" size={14} />Kapat</button>
      </div>
      <div class="aj-lb-body">
        {f.inline ? <img src={f.url} alt={f.name} /> : (
          <div class="aj-lb-file"><span class="aj-fileic big">{f.type === 'application/pdf' ? 'PDF' : 'HEIC'}</span>
            <p>{f.type === 'application/pdf' ? 'PDF dosyası' : 'HEIC görseli tarayıcıda gösterilemiyor'} · indirip açabilirsin.</p>
            <a class="btn primary" href={f.url + '?download'} download={f.name}>İndir</a>
          </div>
        )}
      </div>
      {files.length > 1 && <>
        <button type="button" class="aj-lb-nav prev" aria-label="Önceki" onClick={() => go(-1)}>‹</button>
        <button type="button" class="aj-lb-nav next" aria-label="Sonraki" onClick={() => go(1)}>›</button>
      </>}
    </div>
  );
}
