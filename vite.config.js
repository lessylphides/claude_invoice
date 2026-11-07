import { defineConfig } from 'vite';

import { SUPABASE_URL } from './src/config.js';

// 배포본 보안 정책(CSP): 이 앱 자신(영수증 인식 서버 포함)과 로그인·장부 서버(Supabase)로만 연결할 수 있게 막음.
// 혹시 악성 코드가 끼어들어도 API 키나 장부 데이터를 다른 서버로 보내지 못하게 하는 이중 잠금.
// (개발 서버는 화면 자동 새로고침 연결이 필요해 배포본에만 넣음)
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  `connect-src 'self' ${SUPABASE_URL}`, // 영수증 인식은 우리 서버(/api/ocr)를 거침
  "img-src 'self' blob: data:",
  "style-src 'self' 'unsafe-inline'", // 막대 길이 등 style 속성
  "font-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const securityHeaders = {
  name: 'security-meta',
  apply: 'build',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
    { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head-prepend' },
  ],
};

// base './' 로 두면 GitHub Pages 등 하위 경로에 배포해도 동작합니다.
export default defineConfig({
  base: './',
  build: { target: 'es2020' },
  plugins: [securityHeaders],
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
  },
});
