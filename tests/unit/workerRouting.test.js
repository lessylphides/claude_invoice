// 서버 주소별 응답: costnote.co.kr = 소개 페이지, www = 소개 페이지로 이동, app. = 앱
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';

const built = existsSync(new URL('../../.wrangler-build/assets.js', import.meta.url));
describe.skipIf(!built)('서버 주소별 응답 (npm run deploy 의 빌드 결과로 검사)', () => {
  const get = async (url) => (await import('../../src/worker/index.js')).default.fetch(new Request(url), {});
  it('costnote.co.kr 은 소개 페이지 (스크립트 금지 보안 정책)', async () => {
    const r = await get('https://costnote.co.kr/');
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('영수증만 찍으세요');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect((await get('https://costnote.co.kr/assets/shot-cost.jpg')).headers.get('content-type')).toBe('image/jpeg');
  });
  it('www 는 소개 페이지 주소로 이동', async () => {
    const r = await get('https://www.costnote.co.kr/?a=1');
    expect(r.status).toBe(301);
    expect(r.headers.get('location')).toBe('https://costnote.co.kr/?a=1');
  });
  it('app. 은 앱', async () => {
    const r = await get('https://app.costnote.co.kr/');
    expect(await r.text()).toContain('<title>코스트노트</title>');
    expect(r.headers.get('content-security-policy')).toContain("script-src 'self'");
  });
});
