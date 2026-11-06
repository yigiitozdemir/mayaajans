import { useEffect, useState } from 'preact/hooks';
import { api, loadMe } from '../api';
import { Icon, navigate } from '../ui';

function AuthFrame({ title, sub, children }: { title: string; sub: string; children: any }) {
  return (
    <div class="auth">
      <main>
        <div class="logo"><img src="/logo.png" alt="Maya Ajans" /><h1 class="h1" style="font-size:26px">{title}</h1><span class="sub">{sub}</span></div>
        {children}
      </main>
    </div>
  );
}

export function Login() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState('');
  const [forgot, setForgot] = useState(false);
  const [busy, setBusy] = useState(false);
  // müşteri yetkilisi zaten giriş yaptıysa doğrudan onay sayfasına
  useEffect(() => { fetch('/api/misafir/me', { credentials: 'same-origin' }).then((r) => { if (r.ok) location.replace('/misafir'); }).catch(() => {}); }, []);
  async function submit(e: Event) {
    e.preventDefault(); setErr('');
    if (!email.trim() || !pw) { setErr('E-posta ve şifreni yaz.'); return; }
    setBusy(true);
    try {
      const r = await api<{ guest?: boolean }>('POST', '/auth/login', { email, password: pw, remember });
      if (r?.guest) { location.replace('/misafir'); return; } // müşteri yetkilisi → onay sayfası
      await loadMe(); navigate('/');
    }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <AuthFrame title="Giriş" sub="Maya Ajans hesabınla giriş yap">
      <form onSubmit={submit}>
        <label class="field">E-posta<input class="input" type="email" autocomplete="username" value={email} placeholder="ad@mayaajans.net" onInput={(e) => setEmail((e.target as HTMLInputElement).value)} /></label>
        <label class="field">Şifre
          <span class="row" style="flex-wrap:nowrap;gap:0;border:1px solid var(--line2);border-radius:10px;background:var(--card);padding-right:4px">
            <input class="input" style="border:0" type={show ? 'text' : 'password'} autocomplete="current-password" value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} />
            <button type="button" class="iconbtn" style="border:0" aria-label={show ? 'Şifreyi gizle' : 'Şifreyi göster'} onClick={() => setShow(!show)}><Icon n="eye" /></button>
          </span>
        </label>
        <button type="button" role="checkbox" aria-checked={remember} class={'check' + (remember ? ' on' : '')} onClick={() => setRemember(!remember)}>
          <span class="box">{remember && <Icon n="check" size={13} stroke="#fff" w={3.2} />}</span>
          <span style="display:flex;flex-direction:column;gap:3px"><strong style="font-size:13px">Bu bilgisayarda oturumum açık kalsın</strong><span class="sub" style="font-size:12px;line-height:1.45">Bilgisayarı ya da programı kapatıp açtığında tekrar şifre sorulmaz. Ortak kullanılan bir bilgisayardaysan işareti kaldır.</span></span>
        </button>
        {err && <span class="errtext" role="alert">{err}</span>}
        <button type="submit" class="btn primary" style="min-height:48px;font-size:15px" disabled={busy}>Giriş yap</button>
        <button type="button" class="btn ghost" style="border:0;text-decoration:underline" onClick={() => setForgot(true)}>Şifremi unuttum</button>
        {forgot && <span class="sub" role="status" style="text-align:center;line-height:1.5">Yöneticinden (Yiğit) yeni şifre belirleme bağlantısı iste. Bağlantıyla yeni şifreni kendin belirlersin.</span>}
      </form>
      <p class="sub" style="text-align:center">Hesabın yok mu? Yönetici seni ekibe eklediğinde davet bağlantısı gelir.</p>
    </AuthFrame>
  );
}

export function Invite({ token }: { token: string }) {
  const [info, setInfo] = useState<{ email: string; firstName: string; lastName: string; kind: string } | null>(null);
  const [bad, setBad] = useState('');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('GET', '/auth/invite/' + encodeURIComponent(token))
      .then((r) => { setInfo(r); setFirst(r.firstName || ''); setLast(r.lastName || ''); })
      .catch((e) => setBad(e.message));
  }, [token]);
  async function submit(e: Event) {
    e.preventDefault(); setErr('');
    if (!first.trim()) { setErr('Adını yaz.'); return; }
    if (pw.length < 8) { setErr('Şifre en az 8 karakter olmalı.'); return; }
    if (pw !== pw2) { setErr('Şifreler aynı değil.'); return; }
    setBusy(true);
    try {
      const r = await api<{ guest?: boolean }>('POST', '/auth/accept', { token, firstName: first, lastName: last, password: pw });
      if (r?.guest) { location.replace('/misafir'); return; }
      await loadMe(); history.replaceState({}, '', '/'); navigate('/');
    }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  if (bad) return <AuthFrame title="Bağlantı geçersiz" sub={bad}><a class="btn" href="/giris">Giriş ekranına git</a></AuthFrame>;
  if (!info) return <AuthFrame title="Yükleniyor…" sub=" "><span /></AuthFrame>;
  const reset = info.kind === 'reset' || info.kind === 'guest-reset';
  const guest = info.kind === 'guest' || info.kind === 'guest-reset';
  return (
    <AuthFrame title={reset ? (guest ? 'Yeni şifrenizi belirleyin' : 'Yeni şifreni belirle') : guest ? 'İçerik onay sayfanız' : 'Ekibe hoş geldin'}
      sub={guest && !reset ? info.email + ' · şifrenizi belirleyin, içerikleri buradan onaylayın' : info.email}>
      <form onSubmit={submit}>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <label class="field">Ad *<input class="input" value={first} autocomplete="given-name" onInput={(e) => setFirst((e.target as HTMLInputElement).value)} /></label>
          <label class="field">Soyad<input class="input" value={last} autocomplete="family-name" onInput={(e) => setLast((e.target as HTMLInputElement).value)} /></label>
        </div>
        <input type="email" value={info.email} autocomplete="username" class="sr" readOnly tabIndex={-1} aria-hidden="true" />
        <label class="field">Şifre (en az 8 karakter)<input class="input" type="password" autocomplete="new-password" value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} /></label>
        <label class="field">Şifre tekrar<input class="input" type="password" autocomplete="new-password" value={pw2} onInput={(e) => setPw2((e.target as HTMLInputElement).value)} /></label>
        {err && <span class="errtext" role="alert">{err}</span>}
        <button type="submit" class="btn primary" style="min-height:48px;font-size:15px" disabled={busy}>{reset ? 'Şifremi kaydet' : guest ? 'Giriş yap' : 'Hesabımı aç'}</button>
        <span class="sub" style="text-align:center;line-height:1.5">Bu bilgisayarda oturumun açık kalır; bir daha şifre sorulmaz.</span>
      </form>
    </AuthFrame>
  );
}
