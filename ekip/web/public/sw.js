// Maya Ekip — service worker: yalnızca bildirimler (iPhone ana ekran uygulaması ve tarayıcılar).
// Önbellekleme yapmaz; sayfalar her zaman sunucudan gelir.
'use strict';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Safari / iPhone'da her push için bildirim GÖSTERİLMELİ (yoksa abonelik iptal edilebilir).
const ua = (self.navigator && self.navigator.userAgent) || '';
const isSafari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua);

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'Maya Ekip';
  const link = typeof d.link === 'string' && d.link.startsWith('/') ? d.link : '/';
  const kind = d.tag || 'maya';
  e.waitUntil((async () => {
    // Uygulama şu an önünde açıksa (Chrome/Firefox), ekrandaki açılır bildirim yeterli
    if (!isSafari) {
      const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (list.some((c) => c.focused && c.visibilityState === 'visible')) return;
    }
    await self.registration.showNotification(title, {
      body: d.body || '',
      icon: '/icon-192.png',
      badge: '/icon-64.png',
      // aynı iş/sayfa için gelen yeni bildirim eskisinin yerine geçer; farklı işler üst üste kalır
      tag: kind + ':' + link,
      renotify: true,
      lang: 'tr',
      data: { link },
    });
    // ana ekran simgesindeki kırmızı sayı (iPhone ana ekran uygulaması)
    try {
      if (typeof d.badge === 'number' && self.navigator.setAppBadge) {
        if (d.badge > 0) await self.navigator.setAppBadge(d.badge); else if (self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
      }
    } catch (_) {}
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || '/';
  const url = new URL(link, self.location.origin).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const c = list.find((x) => x.url.startsWith(self.location.origin));
    if (c) {
      try { await c.focus(); } catch (_) { /* */ }
      // sayfa kendi içinde yönlenir (yeniden yüklenmeden)
      c.postMessage({ type: 'maya-open', link });
      return;
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});

// Tarayıcı aboneliği yenilediyse sunucuya bildir (oturum çerezi aynı kökene gider)
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    try {
      const old = e.oldSubscription;
      const key = old && old.options && old.options.applicationServerKey;
      const sub = e.newSubscription || (key ? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) : null);
      if (!sub) return;
      await fetch('/api/push/subscribe', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), device: '' }),
      });
      if (old) await fetch('/api/push/unsubscribe', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: old.endpoint }),
      });
    } catch (_) { /* */ }
  })());
});
