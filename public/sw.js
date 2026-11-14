// 오프라인에서도 앱 화면이 열리도록 같은 출처의 화면 파일만 캐시합니다.
// - assets/ (이름에 내용 해시가 붙어 절대 바뀌지 않는 파일): 저장해 둔 것 먼저 → 빠르게 열림
// - 그 밖의 화면 파일(index.html 등): 서버 먼저 → 새 버전을 바로 받음. 서버가 느리거나 안 되면 저장해 둔 것
// - 서버 기능(/api, 클로드 연결 /mcp·/oauth 등)은 저장하지 않음 (로그인 정보·최신 숫자가 오가는 곳)
const CACHE = 'maeip-v1'; // 이름을 바꾸면 이전 캐시가 지워지므로 그대로 둠
const MAX_ASSETS = 80; // 예전 버전 파일이 끝없이 쌓이지 않게
const NAV_TIMEOUT = 4000; // 첫 화면을 서버에서 4초 안에 못 받으면 저장해 둔 화면으로

const SKIP = /^\/(api|mcp|oauth|authorize|token|register|\.well-known)(\/|$)/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

async function trimAssets(cache) {
  const keys = (await cache.keys()).filter((r) => new URL(r.url).pathname.includes('/assets/'));
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((r) => cache.delete(r)));
}

async function put(req, res) {
  const cache = await caches.open(CACHE);
  await cache.put(req, res);
  if (new URL(req.url).pathname.includes('/assets/')) await trimAssets(cache);
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const fallback = async () => (await caches.match(req)) || (req.mode === 'navigate' ? await caches.match('./index.html') : null);
  const net = fetch(req).then(async (res) => {
    if (res.ok) {
      put(req, res.clone());
      return res;
    }
    // 서버가 404·500 등을 주면(호스팅 장애·계정 문제) 저장해 둔 화면으로 열어 장부를 계속 쓸 수 있게
    return (await fallback()) || res;
  });
  if (req.mode !== 'navigate') return net.catch(async () => (await fallback()) || Response.error());
  // 첫 화면: 서버가 너무 느리면 저장해 둔 화면 (저장해 둔 게 없으면 서버를 끝까지 기다림)
  const slow = new Promise((resolve) => setTimeout(async () => resolve(await fallback()), NAV_TIMEOUT));
  return Promise.race([net.catch(() => null), slow]).then(async (r) => r || (await net.catch(() => null)) || (await fallback()) || Response.error());
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || SKIP.test(url.pathname)) return;
  e.respondWith(url.pathname.includes('/assets/') ? cacheFirst(req) : networkFirst(req));
});
