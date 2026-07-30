const CACHE = "maya-panel-v1";
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", (e) => { /* passthrough */ });
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data.json(); } catch (_) { data = { title: "Maya Ajans", body: e.data ? e.data.text() : "" }; }
  const options = { body: data.body || "", icon: "/panel/icon-192.png", badge: "/panel/icon-192.png", data: { url: data.url || "/panel/" } };
  e.waitUntil(self.registration.showNotification(data.title || "Maya Ajans", options));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/panel/";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.includes("/panel") && "focus" in c) return c.focus(); }
    if (clients.openWindow) return clients.openWindow(url);
  }));
});
