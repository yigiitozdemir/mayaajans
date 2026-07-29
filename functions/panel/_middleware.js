// Maya Ajans — Müşteri Paneli girişi (Cloudflare Pages Function)
// Bu dosya /panel ve altındaki her sayfayı kullanıcı adı + şifre ile korur.
// Kullanıcıları Cloudflare Pages → Settings → Environment variables içindeki
// PANEL_USERS değişkeninde tutuyoruz. Örn: {"ozikiz":"Sifre123","kasap":"Abc987"}

export async function onRequest(context) {
  const { request, env, next } = context;

  const auth = request.headers.get("Authorization") || "";
  let girisBasarili = false;

  if (auth.startsWith("Basic ")) {
    try {
      const cozulmus = atob(auth.slice(6));           // "kullanici:sifre"
      const ayirici = cozulmus.indexOf(":");
      const kullanici = cozulmus.slice(0, ayirici);
      const sifre = cozulmus.slice(ayirici + 1);
      const kullanicilar = JSON.parse(env.PANEL_USERS || "{}");
      if (kullanici && kullanicilar[kullanici] !== undefined && kullanicilar[kullanici] === sifre) {
        girisBasarili = true;
      }
    } catch (e) { /* hatalı başlık → giriş başarısız */ }
  }

  if (!girisBasarili) {
    return new Response("Bu alan Maya Ajans müşterilerine özeldir. Lütfen kullanıcı adı ve şifrenizle giriş yapın.", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Maya Ajans Musteri Paneli", charset="UTF-8"',
        "Content-Type": "text/plain; charset=utf-8"
      }
    });
  }

  // Giriş başarılı → sayfayı göster
  return next();
}
