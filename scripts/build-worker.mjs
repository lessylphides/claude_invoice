// dist/ 의 앱 파일을 Cloudflare Worker 코드 하나에 담음 (배포: npm run deploy)
// 파일 업로드 대신 코드 한 번 올리기로 배포하므로, API 토큰 하나로 끝남
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { CSP } from '../vite.config.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = {};
for (const f of walk('dist')) {
  const path = '/' + relative('dist', f).split('\\').join('/');
  files[path] = [TYPES[extname(f)] ?? 'application/octet-stream', readFileSync(f).toString('base64')];
}
if (!files['/index.html']) throw new Error('dist/index.html 이 없습니다. 먼저 npm run build');

const worker = `// 자동 생성 파일 (scripts/build-worker.mjs). 직접 고치지 마세요.
const FILES = ${JSON.stringify(files)};
const CSP = ${JSON.stringify(CSP)};
const cache = new Map();
const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
export default {
  async fetch(request) {
    const url = new URL(request.url);
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
  },
};
`;
mkdirSync('.wrangler-build', { recursive: true });
writeFileSync('.wrangler-build/worker.js', worker);
console.log(`worker: 파일 ${Object.keys(files).length}개, ${(worker.length / 1024).toFixed(0)}KB`);
