// 오프라인에서도 앱 화면이 열리도록 같은 출처의 파일만 캐시합니다 (네트워크 우선).
// Claude API 요청 등 다른 출처 요청은 건드리지 않습니다.
const CACHE = 'maeip-v1'; // 이름을 바꾸면 이전 캐시가 지워지므로 그대로 둠

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then(async (res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        }
        // 서버가 404·500 등을 주면(호스팅 장애·계정 문제) 저장해 둔 화면으로 열어 장부를 계속 쓸 수 있게
        const cached = (await caches.match(req)) || (req.mode === 'navigate' ? await caches.match('./index.html') : null);
        return cached || res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html'))),
  );
});
