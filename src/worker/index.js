// Cloudflare Worker: 앱 화면 파일 + 서버 기능(/api/...)
// 앱 화면 파일은 배포할 때 scripts/build-worker.mjs 가 .wrangler-build/assets.js 로 만듦
import { FILES, CSP, LANDING } from '../../.wrangler-build/assets.js';
import { handleOcr } from './ocr.js';
import { handleBilling, runRenewals } from './billing.js';
import { handleAdmin, handleOcrFeedback } from './stats.js';
import { runBackup } from './backup.js';
import { handleLevel } from './levels.js';
import { makeProvider } from './mcp/provider.js';
import { handleAuthorize } from './mcp/authorize.js';
import { handleAiChanges } from './mcp/changes.js';
import { withLandingRef, handleRef } from './ref.js';
export { BillingStore } from './billingStore.js';

const cache = new Map();
const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// 소개 페이지는 스크립트 없이 같은 사이트의 그림·글꼴만
const LANDING_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function serveFile(request, url, files = FILES, csp = CSP, key = 'app') {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405 });
  let path = url.pathname === '/' ? '/index.html' : url.pathname;
  if (!files[path] && files[`${path}.html`]) path = `${path}.html`; // /terms → /terms.html
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

const app = {
  async fetch(request, env) {
    const url = new URL(request.url);
    // www → 소개 페이지 주소로, costnote.co.kr → 소개 페이지, 그 밖(app. 등) → 앱
    if (url.hostname === 'www.costnote.co.kr') return Response.redirect(`https://costnote.co.kr${url.pathname}${url.search}`, 301);
    if (url.hostname === 'costnote.co.kr') return withLandingRef(request, serveFile(request, url, LANDING, LANDING_CSP, 'landing'), env);
    if (url.pathname === '/oauth/authorize') return handleAuthorize(request, env);
    if (url.pathname.startsWith('/api/ai-changes') || url.pathname.startsWith('/api/claude/')) return handleAiChanges(request, env);
    if (url.pathname === '/api/ref') return handleRef(request, env);
    if (url.pathname === '/api/ocr') return handleOcr(request, env);
    if (url.pathname === '/api/ocr/feedback') return handleOcrFeedback(request, env);
    if (url.pathname.startsWith('/api/admin')) return handleAdmin(request, env);
    if (url.pathname === '/api/level' || url.pathname === '/api/level/claim') return handleLevel(request, env);
    if (url.pathname === '/api/billing' || url.pathname.startsWith('/api/billing/')) return handleBilling(request, env);
    if (url.pathname.startsWith('/api/')) return new Response('Not Found', { status: 404 });
    return serveFile(request, url);
  },
};

// 클로드 연결: 로그인(OAuth)·/mcp 는 provider 가 처리하고, 나머지는 app 으로
const provider = makeProvider(app);

export default {
  fetch(request, env, ctx) {
    // 소개 페이지 도메인은 OAuth 와 무관하게 바로
    const host = new URL(request.url).hostname;
    if (host === 'costnote.co.kr' || host === 'www.costnote.co.kr') return app.fetch(request, env);
    return provider.fetch(request, env, ctx);
  },
  // 매일 한 번: 결제일이 된 구독 정기결제, 장부 백업 (wrangler.jsonc 의 triggers.crons)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runRenewals(env)
        .then((r) => console.log('[billing] renewals', JSON.stringify(r)))
        .catch((e) => console.error('[billing] renewals failed', String(e)))
        .then(() => runBackup(env))
        .then((r) => console.log('[backup]', JSON.stringify(r)))
        .catch((e) => console.error('[backup] failed', String(e))),
    );
  },
};
