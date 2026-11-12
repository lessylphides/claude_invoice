// 가입 경로 꼬리표 (광고 링크의 ?ref=ig1 같은 것): 영문·숫자·_- 1~20자만
export const REF_RE = /^[A-Za-z0-9_-]{1,20}$/;
export const cleanRef = (v) => (typeof v === 'string' && REF_RE.test(v.trim()) ? v.trim().toLowerCase() : null);
export const REF_COOKIE = 'cn_ref';
export const REF_DAYS = 30;

const KEY = 'costnote:ref';

/** 앱을 열 때: 주소의 ?ref= 또는 소개 페이지가 남긴 쿠키에서 꼬리표를 읽어 기기에 기억 (처음 것만) */
export function captureRef(loc = globalThis.location, doc = globalThis.document, ls = globalThis.localStorage) {
  try {
    if (ls.getItem(KEY)) return ls.getItem(KEY);
    const fromUrl = cleanRef(new URLSearchParams(loc?.search || '').get('ref'));
    const fromCookie = cleanRef((doc?.cookie || '').match(new RegExp(`(?:^|;\\s*)${REF_COOKIE}=([^;]+)`))?.[1]);
    const ref = fromUrl || fromCookie;
    if (ref) ls.setItem(KEY, ref);
    return ref;
  } catch {
    return null;
  }
}

export function storedRef(ls = globalThis.localStorage) {
  try {
    return cleanRef(ls.getItem(KEY));
  } catch {
    return null;
  }
}

/** 로그인 뒤 한 번: 서버에 '이 계정의 가입 경로' 기록 요청 (꼬리표는 서버가 계정 정보에서 직접 읽음) */
export async function reportRef(user, token, fetchImpl = fetch, ls = globalThis.localStorage) {
  if (!user?.id || !cleanRef(user.user_metadata?.ref) || !token) return false;
  const sent = `costnote:ref-sent:${user.id}`;
  try {
    if (ls.getItem(sent)) return false;
    const r = await fetchImpl('./api/ref', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    if (r.ok) ls.setItem(sent, '1');
    return r.ok;
  } catch {
    return false;
  }
}
