// Cloudflare Worker: 앱 화면 파일 + 서버 기능(/api/...)
// 앱 화면 파일은 배포할 때 scripts/build-worker.mjs 가 .wrangler-build/assets.js 로 만듦
import { FILES, CSP } from '../../.wrangler-build/assets.js';
import { handleOcr } from './ocr.js';

const cache = new Map();
const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

function serveFile(request, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405 });
  const path = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = FILES[path];
  if (!file) return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  if (!cache.has(path)) cache.set(path, bytes(file[1]));
  const headers = {
    'content-type': file[0],
    // 해시가 붙은 파일(assets/)은 오래 보관, 나머지는 매번 새 버전 확인
    'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  };
  if (path.endsWith('.html')) Object.assign(headers, { 'content-security-policy': CSP, 'x-frame-options': 'DENY' });
  return new Response(request.method === 'HEAD' ? null : cache.get(path), { headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/ocr') return handleOcr(request, env);
    if (url.pathname.startsWith('/api/')) return new Response('Not Found', { status: 404 });
    return serveFile(request, url);
  },
};
