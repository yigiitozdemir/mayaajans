// Müşteri portalı (Vatan onay) — ekip sayfası ve misafir sayfasının ortak parçaları
import { useState } from 'preact/hooks';
import { Icon } from '../ui';
import '../styles/portal.css';

export interface PItem {
  id: string; kind: 'content' | 'request'; no: number; title: string; link: string;
  planDate: string | null; givenDate: string | null; dueDate: string | null; dateText: string;
  description: string; status: string; createdByKind: 'team' | 'guest' | 'import'; createdAt: string; updatedAt: string;
}
export interface PNote { id: string; itemId: string; authorKind: 'team' | 'guest' | 'import'; authorName: string; action: 'note' | 'approve' | 'revise' | 'status'; body: string; createdAt: string }
export interface PGuest { id: string; email: string; firstName: string; lastName: string; status: 'pending' | 'active'; lastLoginAt: string | null; createdAt: string }

export const CONTENT_STATUS: { v: string; label: string; tone: string }[] = [
  { v: 'onay_bekliyor', label: 'Onay bekleniyor', tone: 'amber' },
  { v: 'revize', label: 'Revize istendi', tone: 'red' },
  { v: 'hazirlaniyor', label: 'Hazırlanıyor', tone: 'blue' },
  { v: 'onaylandi', label: 'Onaylandı', tone: 'green' },
  { v: 'paylasildi', label: 'Paylaşıldı', tone: 'mute' },
];
export const REQUEST_STATUS: { v: string; label: string; tone: string }[] = [
  { v: 'bekliyor', label: 'Beklemede', tone: 'amber' },
  { v: 'devam', label: 'Devam ediyor', tone: 'blue' },
  { v: 'tamam', label: 'Tamamlandı', tone: 'green' },
];
export const statusMeta = (kind: 'content' | 'request', v: string) =>
  (kind === 'content' ? CONTENT_STATUS : REQUEST_STATUS).find((s) => s.v === v) || { v, label: v, tone: 'mute' };

export function StatusPill({ kind, status }: { kind: 'content' | 'request'; status: string }) {
  const m = statusMeta(kind, status);
  return <span class={'pt-pill ' + m.tone}><span class="pt-dot" aria-hidden="true" />{m.label}</span>;
}

const TR_MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
export function fmtDate(iso: string | null | undefined, long = false): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  return long ? `${d} ${TR_MONTHS[m - 1]} ${y}` : `${d} ${TR_MONTHS[m - 1]}`;
}
/** sunucu zamanı (UTC, "YYYY-MM-DD HH:MM:SS") → "12 Kas 14:05" */
export function fmtTime(s: string): string {
  const d = new Date(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z'));
  if (isNaN(+d)) return '';
  const today = new Date(); const same = d.toDateString() === today.toDateString();
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  return same ? 'Bugün ' + hm : `${d.getDate()} ${TR_MONTHS[d.getMonth()]} ${hm}`;
}

export function DriveButton({ link, compact }: { link: string; compact?: boolean }) {
  if (!link) return <span class="pt-nolink">Bağlantı yok</span>;
  const drive = /drive\.google\.com|docs\.google\.com/.test(link);
  return (
    <a class={'btn sm pt-drive' + (compact ? ' compact' : '')} href={link} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
      <Icon n={drive ? 'folder' : 'link'} size={14} />{compact ? (drive ? 'Drive' : 'Aç') : drive ? "Drive'da aç" : 'Bağlantıyı aç'}
    </a>
  );
}

const ACTION_LABEL: Record<string, string> = { approve: 'onayladı', revise: 'revize istedi', status: 'durumu değiştirdi', note: '' };

export function NoteThread({ notes, empty }: { notes: PNote[]; empty?: string }) {
  if (!notes.length) return <div class="pt-thread-empty">{empty || 'Henüz not yok.'}</div>;
  return (
    <ol class="pt-thread">
      {notes.map((n) => (
        <li class={'pt-note ' + n.authorKind + ' ' + n.action}>
          <div class="pt-note-h">
            <span class="pt-note-ic" aria-hidden="true">{n.action === 'approve' ? '✓' : n.action === 'revise' ? '↺' : n.action === 'status' ? '•' : n.authorKind === 'team' ? 'M' : n.authorName.slice(0, 1)}</span>
            <b>{n.authorName}</b>
            {ACTION_LABEL[n.action] && <span class="pt-note-act">{ACTION_LABEL[n.action]}{n.action === 'status' && n.body ? ': ' + n.body : ''}</span>}
            <span class="pt-note-t">{n.authorKind === 'import' ? "Slack'ten" : fmtTime(n.createdAt)}</span>
          </div>
          {n.body && n.action !== 'status' && <p class="pt-note-b">{n.body}</p>}
        </li>
      ))}
    </ol>
  );
}

export function NoteBox({ placeholder, onSend, label = 'Not ekle' }: { placeholder: string; onSend: (body: string) => Promise<void>; label?: string }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!v.trim() || busy) return;
    setBusy(true);
    try { await onSend(v.trim()); setV(''); } finally { setBusy(false); }
  }
  return (
    <div class="pt-notebox">
      <textarea class="input" rows={2} placeholder={placeholder} value={v} onInput={(e) => setV((e.target as HTMLTextAreaElement).value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }} />
      <button type="button" class="btn sm" disabled={!v.trim() || busy} onClick={send}><Icon n="chat" size={14} />{label}</button>
    </div>
  );
}

/** İçerik/talep için gösterilecek tarih */
export function itemDate(it: PItem): string {
  if (it.kind === 'content') return it.planDate ? fmtDate(it.planDate, true) : it.dateText;
  if (it.dueDate) return 'Teslim ' + fmtDate(it.dueDate, true);
  return it.givenDate ? fmtDate(it.givenDate, true) : it.dateText;
}
