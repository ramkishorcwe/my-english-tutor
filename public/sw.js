self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data?.json() || {};
  } catch {
    /* Use the default visible notification. */
  }
  event.waitUntil(
    self.registration.showNotification(message.title || 'Time for English practice', {
      body: message.body || 'Your SpeakBetter coach is ready. Take a few minutes to practise.',
      tag: message.tag === 'speakbetter-test' ? 'speakbetter-test' : 'speakbetter-daily',
      icon: '/icons/speakbetter-192.png',
      data: { url: '/practice' },
    }),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL('/practice', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const client = clients.find((window) => new URL(window.url).origin === self.location.origin);
      if (client) {
        await client.navigate(target);
        return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
