// 앱 안 브라우저 알아보기 + 소개 페이지 안내 띠
import { describe, it, expect } from 'vitest';
import { inAppOf, escapeUrl } from '../../src/lib/inapp.js';
import { inAppBanner } from '../../src/worker/inappBanner.js';

const UA = {
  igIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0',
  igAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 Instagram 350.0.0.0 Android',
  kakao: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.0',
  naver: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 NAVER(inapp; search; 1000; 12.0.0)',
  safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

describe('앱 안 브라우저', () => {
  it('인스타·카카오톡·네이버는 알아보고 사파리는 아님', () => {
    expect(inAppOf(UA.igIos)).toMatchObject({ app: 'instagram', os: 'ios' });
    expect(inAppOf(UA.igAndroid)).toMatchObject({ app: 'instagram', os: 'android' });
    expect(inAppOf(UA.kakao).app).toBe('kakao');
    expect(inAppOf(UA.naver).app).toBe('naver');
    expect(inAppOf(UA.safari)).toBeNull();
  });
  it('밖에서 여는 주소: 카카오톡·안드로이드는 바로, 아이폰 인스타는 메뉴 안내', () => {
    const url = 'https://costnote.co.kr/?ref=igad1';
    expect(escapeUrl(inAppOf(UA.kakao), url)).toBe(`kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`);
    expect(escapeUrl(inAppOf(UA.igAndroid), url)).toMatch(/^intent:\/\/costnote\.co\.kr\/\?ref=igad1#Intent;scheme=https;package=com\.android\.chrome;/);
    expect(escapeUrl(inAppOf(UA.igIos), url)).toBeNull();
  });
  it('소개 페이지 안내 띠: 밖에서 다시 열 때 방문을 두 번 세지 않게 nv=1', () => {
    const req = (ua) => new Request('https://costnote.co.kr/?ref=igad1', { headers: { 'user-agent': ua } });
    expect(inAppBanner(req(UA.safari), new URL('https://costnote.co.kr/?ref=igad1'))).toBe('');
    const ig = inAppBanner(req(UA.igIos), new URL('https://costnote.co.kr/?ref=igad1'));
    expect(ig).toContain('외부 브라우저에서 열기');
    const k = inAppBanner(req(UA.kakao), new URL('https://costnote.co.kr/?ref=igad1'));
    expect(k).toContain('kakaotalk://web/openExternal?url=');
    expect(decodeURIComponent(k)).toContain('nv=1');
  });
});

import { adHero, withBanner } from '../../src/worker/inappBanner.js';
describe('광고로 온 사람 전용 첫 화면', () => {
  const page = () => new Response('<body><section class="hero" aria-labelledby="hero-title">\n<div>\n<h1 id="hero-title">원래 제목</h1><a href="x">지금 써 보기</a>\n</div>\n<div class="phones">그림</div></section></body>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
  const req = (u) => new Request(u, { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh)' } });
  it('igad 꼬리표면 광고와 같은 문구 + 큰 시작 버튼(꼬리표 그대로), 앱 화면 그림은 그대로', async () => {
    const u = 'https://costnote.co.kr/?ref=igad2';
    const html = await (await withBanner(req(u), new URL(u), page())).text();
    expect(html).toContain('얼마 받을지');
    expect(html).toContain('ref=igad2');
    expect(html).toContain('무료로 시작하기');
    expect(html).not.toContain('원래 제목');
    expect(html).toContain('<div class="phones">그림</div>');
    const h1 = await (await withBanner(req('https://costnote.co.kr/?ref=igad1'), new URL('https://costnote.co.kr/?ref=igad1'), page())).text();
    expect(h1).toContain('장부 정리 끝');
  });
  it('광고 꼬리표가 아니거나 이상한 값이면 원래 페이지', async () => {
    for (const u of ['https://costnote.co.kr/?ref=ig', 'https://costnote.co.kr/', 'https://costnote.co.kr/?ref=igad%22%3E%3Cscript%3E']) {
      const html = await (await withBanner(req(u), new URL(u), page())).text();
      expect(html).toContain('원래 제목');
    }
    expect(adHero('ig1')).toBe('');
  });
});

describe('광고로 온 사람은 앱 안 브라우저 띠 없이', () => {
  it('인스타 앱 안에서 igad 로 오면 띠 없음, 일반 링크면 띠', async () => {
    const page = () => new Response('<body><section class="hero">\n<div>\n<h1>원래</h1>\n</div>\n<div class="phones"></div></section></body>', { headers: { 'content-type': 'text/html' } });
    const ig = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Instagram 350.0';
    const r = (u) => new Request(u, { headers: { 'user-agent': ig } });
    const ad = await (await withBanner(r('https://costnote.co.kr/?ref=igad1'), new URL('https://costnote.co.kr/?ref=igad1'), page())).text();
    expect(ad).not.toContain('inapp-banner');
    expect(ad).toContain('무료로 시작하기');
    const plain = await (await withBanner(r('https://costnote.co.kr/?ref=ig'), new URL('https://costnote.co.kr/?ref=ig'), page())).text();
    expect(plain).toContain('inapp-banner');
  });
});
