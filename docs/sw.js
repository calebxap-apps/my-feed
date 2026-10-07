// 앱이 꺼져 있어도 알림을 받고, 인터넷이 약할 때도 마지막 소식을 보여주는 일꾼
const SHELL = 'shell-v3';
const DATA = 'data-v1';
const SHELL_FILES = ['./', 'index.html', 'style.css', 'app.js?v=3', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => ![SHELL, DATA].includes(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// 소식 데이터와 화면 파일 모두 '인터넷 먼저, 안 되면 저장본'
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const bucket = url.pathname.includes('/data/') ? DATA : SHELL;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }) // GitHub 의 10분 보관본 대신 항상 새 파일 확인
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(bucket).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: bucket === SHELL }))
  );
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data.json(); } catch { data = { title: '내 소식함', body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || '내 소식함', {
    body: data.body,
    tag: data.tag,
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    data: { url: new URL(data.url || './', self.registration.scope).href },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = e.notification.data?.url || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(self.registration.scope));
    return open ? open.navigate(target).then((c) => c?.focus()) : self.clients.openWindow(target);
  }));
});
