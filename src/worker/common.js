// 서버 공통: JSON 응답, 로그인 확인, 사용량 조회
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';

export const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
export const fail = (status, code, message, extra = {}) => json(status, { error: { code, message, ...extra } });

/**
 * 요청의 로그인 토큰으로 Supabase 사용자를 확인.
 * 사용자 본인 권한으로만 Supabase 를 부름 (서버에 관리자 키를 두지 않음)
 * @returns {Promise<{user: {id: string, email: string}, sb: (path: string, init?: RequestInit) => Promise<Response>} | {error: Response}>}
 */
export async function authUser(request, fetchImpl) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: fail(401, 'login', '로그인이 필요해요.') };
  const sb = (path, init = {}) =>
    fetchImpl(`${SUPABASE_URL}${path}`, {
      ...init,
      headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
  const res = await sb('/auth/v1/user');
  if (!res.ok) return { error: fail(401, 'login', '로그인이 만료됐어요. 다시 로그인해 주세요.') };
  const u = await res.json().catch(() => ({}));
  return { user: { id: u.id ?? null, email: u.email ?? '' }, sb };
}

/** 오늘·이번 달·전체·결제 기간(since 부터) 인식 횟수 */
export async function usageNow(sb, since = null) {
  const res = await sb('/rest/v1/rpc/ocr_usage_now', { method: 'POST', body: JSON.stringify(since ? { since } : {}) });
  if (!res.ok) {
    console.error('[usage]', res.status, await res.text().catch(() => ''));
    return null;
  }
  const u = await res.json();
  // billing.sql 을 아직 실행하지 않은 경우: total·period 가 없음 → 이번 달 횟수로 대신 (한도를 넉넉하게 주지 않도록)
  return { day: u.day ?? 0, month: u.month ?? 0, total: u.total ?? u.month ?? 0, period: u.period ?? u.month ?? 0 };
}
