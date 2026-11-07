// Cloudflare Worker: 앱 화면 파일 + 서버 기능(/api/...)
// 앱 화면 파일은 배포할 때 scripts/build-worker.mjs 가 .wrangler-build/assets.js 로 만듦
import { FILES, CSP, LANDING } from '../../.wrangler-build/assets.js';
import { handleOcr } from './ocr.js';

const cache = new Map();
const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// 소개 페이지는 스크립트 없이 같은 사이트의 그림·글꼴만
const LANDING_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function serveFile(request, url, files = FILES, csp = CSP, key = 'app') {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405 });
  const path = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = files[path];
  if (!file) return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const ck = `${key}:${path}`;
  if (!cache.has(ck)) cache.set(ck, bytes(file[1]));
  const headers = {
    'content-type': file[0],
    // 해시가 붙은 파일(assets/)은 오래 보관, 나머지는 매번 새 버전 확인
    'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  };
  if (key === 'landing' && path.startsWith('/assets/')) headers['cache-control'] = 'public, max-age=86400';
  if (path.endsWith('.html')) Object.assign(headers, { 'content-security-policy': csp, 'x-frame-options': 'DENY' });
  return new Response(request.method === 'HEAD' ? null : cache.get(ck), { headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // www → 소개 페이지 주소로, costnote.co.kr → 소개 페이지, 그 밖(app. 등) → 앱
    if (url.hostname === 'www.costnote.co.kr') return Response.redirect(`https://costnote.co.kr${url.pathname}${url.search}`, 301);
    if (url.hostname === 'costnote.co.kr') return serveFile(request, url, LANDING, LANDING_CSP, 'landing');
    if (url.pathname === '/api/ocr') return handleOcr(request, env);
    if (url.pathname.startsWith('/api/')) return new Response('Not Found', { status: 404 });
    return serveFile(request, url);
  },
};
