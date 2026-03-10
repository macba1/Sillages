/* eslint-disable no-restricted-globals */

// ── Push event ──────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  const fallback = { title: 'Sillages', body: 'Tu brief diario está listo', url: '/dashboard' };
  let data = fallback;

  try {
    data = event.data ? event.data.json() : fallback;
  } catch {
    data = fallback;
  }

  event.waitUntil(
    self.registration.showNotification(data.title || fallback.title, {
      body: data.body || fallback.body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: { url: data.url || '/dashboard' },
      vibrate: [100, 50, 100],
    })
  );
});

// ── Notification click ──────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/dashboard';
  const fullUrl = new URL(url, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing window if open
      for (const client of clients) {
        if (client.url === fullUrl && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open new window
      return self.clients.openWindow(fullUrl);
    })
  );
});
