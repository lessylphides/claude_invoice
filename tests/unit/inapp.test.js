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
