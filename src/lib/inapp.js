// 앱 안 브라우저(인스타그램·페이스북·네이버·카카오톡 등) 알아보기 + 밖(사파리·크롬)으로 여는 방법
// 앱 안 브라우저는 사파리·크롬과 저장 공간이 따로라서, 홈 화면에 앱으로 설치할 수 없고
// 메일 앱에서 연 링크와 로그인 상태가 이어지지 않음 → 밖에서 열도록 권함 (억지로 옮기지는 않음)

const APPS = [
  ['instagram', /Instagram/i, '인스타그램'],
  ['threads', /Barcelona/i, '스레드'],
  ['facebook', /FBAN|FBAV|FB_IAB/i, '페이스북'],
  ['kakao', /KAKAOTALK/i, '카카오톡'],
  ['naver', /NAVER\(inapp|NAVER\/|whale.*inapp/i, '네이버'],
  ['line', /\bLine\//i, '라인'],
  ['band', /BAND\//i, '밴드'],
  ['daum', /DaumApps/i, '다음'],
];

/** @returns {{app:string, name:string, os:'ios'|'android'|'other'} | null} */
export function inAppOf(ua = '') {
  for (const [app, re, name] of APPS) if (re.test(ua)) return { app, name, os: /iPhone|iPad|iPod/i.test(ua) ? 'ios' : /Android/i.test(ua) ? 'android' : 'other' };
  return null;
}

/** 버튼 하나로 밖에서 여는 주소 (안 되면 null → 메뉴 안내) */
export function escapeUrl(info, url) {
  if (!info) return null;
  if (info.app === 'kakao') return `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`;
  if (info.app === 'line') return url + (url.includes('?') ? '&' : '?') + 'openExternalBrowser=1';
  if (info.os === 'android') {
    const u = new URL(url);
    return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
  }
  return null;
}

/** 메뉴로 여는 방법 안내 글 */
export function escapeHint(info) {
  const browser = info?.os === 'android' ? '크롬' : 'Safari';
  if (info?.app === 'instagram' || info?.app === 'threads' || info?.app === 'facebook') return `오른쪽 위 ⋯ 를 누르고 <b>외부 브라우저에서 열기</b>를 눌러 주세요.`;
  if (info?.app === 'naver') return `아래(또는 위) ⋯ 메뉴에서 <b>다른 브라우저로 열기</b>를 눌러 주세요.`;
  return `⋯ 메뉴에서 <b>${browser}로 열기</b>(외부 브라우저)를 눌러 주세요.`;
}
