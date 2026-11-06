import { useEffect, useState } from 'preact/hooks';
import { api, reloadTeam, snack } from '../api';
import { Avatar, Icon, Switch, useStore } from '../ui';

interface AdminUser {
  id: string; name: string; firstName: string; lastName: string; color: string; photo: string | null; email: string;
  role: 'admin' | 'member'; status: 'pending' | 'active'; canEditClients: boolean;
  sessions: { id: string; device: string; lastSeenAt: string; isThis: boolean }[];
}

function ago(s: string) {
  const m = Math.round((Date.now() - Date.parse(s.replace(' ', 'T') + 'Z')) / 60000);
  if (m < 2) return 'şimdi';
  if (m < 60) return m + ' dk önce';
  if (m < 1440) return Math.round(m / 60) + ' saat önce';
  return Math.round(m / 1440) + ' gün önce';
}

export function Ekip() {
  const s = useStore();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [link, setLink] = useState<{ who: string; url: string; kind: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const load = async () => setUsers(await api<AdminUser[]>('GET', '/admin/users'));
  useEffect(() => { load().catch((e) => snack(e.message)); }, [s.team]);
  if (s.me!.role !== 'admin') return <div class="page"><p>Bu sayfa sadece yöneticiye açık.</p></div>;

  async function invite() {
    setErr('');
    try {
      const r = await api<{ link: string }>('POST', '/admin/invite', { email });
      setLink({ who: email, url: r.link, kind: 'invite' }); setEmail(''); await reloadTeam(); await load();
    } catch (e: any) { setErr(e.message); }
  }
  async function newLink(u: AdminUser) {
    const r = await api<{ link: string; kind: string }>('POST', `/admin/users/${u.id}/link`);
    setLink({ who: u.name, url: r.link, kind: r.kind });
  }
  async function act(fn: () => Promise<unknown>, msg: string) {
    try { await fn(); snack(msg); await load(); await reloadTeam(); } catch (e: any) { snack(e.message); }
  }
  const active = users.filter((u) => u.status === 'active').length;

  return (
    <div class="page" style="max-width:1100px">
      <header style="display:flex;flex-direction:column;gap:6px">
        <h1 class="h1">Ekip yönetimi</h1>
        <span class="sub">{active} aktif üye · {users.length - active} davet bekliyor · Bu sayfayı sadece sen görürsün.</span>
      </header>

      <section class="panel" style="display:flex;flex-direction:column;gap:12px">
        <strong style="font-size:15px">Yeni üye davet et</strong>
        <div class="row" style="align-items:flex-end">
          <label class="field" style="flex:2 1 260px">E-posta<input class="input" type="email" value={email} placeholder="ad@mayaajans.net" onInput={(e) => setEmail((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') invite(); }} /></label>
          <button type="button" class="btn primary" style="min-height:44px" onClick={invite}>Davet bağlantısı oluştur</button>
        </div>
        <span class="sub" style="line-height:1.5">Bağlantıyı kişiye WhatsApp ya da Slack'ten gönder. Kişi bağlantıyı açıp şifresini belirleyince ekibe <strong>üye</strong> olarak katılır. Üyeler iş ekleme, atama dahil bütün özellikleri kullanır; sadece bu sayfayı göremez. Bağlantı 14 gün geçerli ve tek kullanımlık.</span>
        {err && <span class="errtext">{err}</span>}
      </section>

      {link && (
        <section class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px;border-color:rgba(155,87,63,.4)">
          <strong>{link.kind === 'reset' ? 'Şifre belirleme bağlantısı' : 'Davet bağlantısı'} · {link.who}</strong>
          <div class="row"><input class="input" readOnly value={link.url} style="flex:1" onFocus={(e) => (e.target as HTMLInputElement).select()} />
            <button type="button" class="btn primary" onClick={async () => { try { await navigator.clipboard.writeText(link.url); snack('Bağlantı kopyalandı'); } catch { snack('Kopyalanamadı, elle seç'); } }}><Icon n="copy" size={15} />Kopyala</button>
          </div>
          <span class="sub">Bu bağlantı sadece bir kez gösterilir. Kaybolursa yeni bağlantı oluşturabilirsin.</span>
        </section>
      )}

      <section style="display:flex;flex-direction:column;gap:12px">
        {users.map((u) => {
          const isMe = u.id === s.me!.id;
          return (
            <article class="card" style="padding:18px;display:flex;flex-direction:column;gap:14px">
              <div class="row" style="gap:14px">
                <Avatar m={u} size={48} radius={15} />
                <span style="flex:1 1 220px;display:flex;flex-direction:column;gap:4px">
                  <span class="row" style="gap:8px"><strong style="font-size:16px">{u.name}</strong>{isMe && <span class="chip">Sen</span>}
                    <span class="chip" style={u.status === 'active' ? 'background:var(--green-soft);color:var(--green)' : 'background:var(--accent-soft);color:var(--accent-ink)'}>{u.status === 'active' ? 'Aktif' : 'Davet bekliyor'}</span></span>
                  <span class="sub">{u.email}</span>
                </span>
                <span class="chip" style={u.role === 'admin' ? 'background:var(--accent-soft);color:var(--accent-ink);font-weight:700' : ''}>{u.role === 'admin' ? 'Yönetici' : 'Üye · tüm özellikler'}</span>
              </div>
              {u.role !== 'admin' && <Switch on={u.canEditClients} label="Müşteri kartlarını düzenleyebilir" hint="Aşama 2'de gelecek Müşteriler ekranı için. Müşteri ekleme ve çıkarma her durumda sadece sende." onToggle={() => act(() => api('PATCH', '/admin/users/' + u.id, { canEditClients: !u.canEditClients }), 'Yetki güncellendi')} />}
              {u.status === 'active' && (
                <div style="display:flex;flex-direction:column;gap:6px;padding:12px 14px;border-radius:12px;background:var(--panel);border:1px solid var(--line)">
                  <span class="sub" style="font-weight:600">Oturumu açık cihazlar</span>
                  {u.sessions.map((se) => (
                    <div class="row" style="min-height:42px;border-bottom:1px solid var(--line)">
                      <span style="flex:1 1 160px;display:flex;flex-direction:column"><span style="font-weight:600;font-size:13px">{se.device}{se.isThis && <span style="margin-left:8px;font-size:11px;color:var(--green)">bu cihaz</span>}</span><span class="sub" style="font-size:12px">Son kullanım: {ago(se.lastSeenAt)}</span></span>
                      {!se.isThis && <button type="button" class="btn danger sm" onClick={() => act(() => api('DELETE', '/admin/sessions/' + encodeURIComponent(se.id)), 'Oturum kapatıldı')}>Oturumu kapat</button>}
                    </div>
                  ))}
                  {u.sessions.length === 0 && <span class="sub">Açık oturum yok.</span>}
                </div>
              )}
              {!isMe && (
                <div class="row">
                  <button type="button" class="btn sm" onClick={() => newLink(u)}>{u.status === 'active' ? 'Şifre sıfırlama bağlantısı' : 'Davet bağlantısını yenile'}</button>
                  {u.status === 'active' && u.sessions.length > 0 && <button type="button" class="btn sm" onClick={() => act(() => api('DELETE', `/admin/users/${u.id}/sessions`), u.name + ' tüm cihazlardan çıkarıldı')}>Tüm cihazlardan çıkış yaptır</button>}
                  <button type="button" class={'btn danger sm' + (confirm === u.id ? ' confirm' : '')} onClick={() => { if (confirm !== u.id) { setConfirm(u.id); return; } setConfirm(null); act(() => api('DELETE', '/admin/users/' + u.id), u.name + ' ekipten çıkarıldı'); }}>{confirm === u.id ? 'Emin misin? Ekipten çıkar' : u.status === 'active' ? 'Ekipten çıkar' : 'Daveti iptal et'}</button>
                </div>
              )}
            </article>
          );
        })}
      </section>
      <p class="sub" style="line-height:1.5">Ekipten çıkarılan kişinin bütün oturumları anında kapanır ve programa giremez. Yaptığı işler programda kalır. Yönetici sadece sensin.</p>
    </div>
  );
}
