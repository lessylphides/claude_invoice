// dist/ 의 앱 파일을 Cloudflare Worker 에 담을 모듈로 만듦 (배포: npm run deploy)
// 파일 업로드 대신 코드 한 번 올리기로 배포하므로, API 토큰 하나로 끝남
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { CSP } from '../vite.config.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const collect = (dir) => {
  const out = {};
  for (const f of walk(dir)) out['/' + relative(dir, f).split('\\').join('/')] = [TYPES[extname(f)] ?? 'application/octet-stream', readFileSync(f).toString('base64')];
  return out;
};
const files = collect('dist'); // 앱 (app.costnote.co.kr)
const landing = collect('landing'); // 소개 페이지 (costnote.co.kr)
if (!files['/index.html']) throw new Error('dist/index.html 이 없습니다. 먼저 npm run build');

const out = `// 자동 생성 파일 (scripts/build-worker.mjs). 직접 고치지 마세요.
export const FILES = ${JSON.stringify(files)};
export const CSP = ${JSON.stringify(CSP)};
export const LANDING = ${JSON.stringify(landing)};
`;
mkdirSync('.wrangler-build', { recursive: true });
writeFileSync('.wrangler-build/assets.js', out);
console.log(`소개 페이지 파일 ${Object.keys(landing).length}개`);
console.log(`앱 파일 ${Object.keys(files).length}개, ${(out.length / 1024).toFixed(0)}KB → .wrangler-build/assets.js`);
