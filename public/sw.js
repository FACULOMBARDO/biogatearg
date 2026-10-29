// Service worker del panel: muestra las notificaciones push aunque el panel esté cerrado.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Biogate', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Biogate', {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag, icon: d.icon || '/logo-icon.png', badge: '/logo-icon.png',
    requireInteraction: !!d.sticky, data: { url: d.url || '/' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) if (new URL(w.url).origin === self.location.origin) { await w.focus(); try { await w.navigate(url); } catch { w.postMessage({ goto: url }); } return; }
    await self.clients.openWindow(url);
  })());
});
