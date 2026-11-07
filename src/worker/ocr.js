// 서버: 영수증 인식 (/api/ocr)
// 앱 → 이 서버 → Claude API. Anthropic API 키는 Cloudflare 비밀 값(ANTHROPIC_API_KEY)에만 있고 휴대폰에는 없습니다.
// 1) Supabase 로그인 확인  2) 계정별 하루·한 달 사용량 확인  3) 사진 확인  4) Claude 호출  5) 성공한 인식만 사용량에 기록
import Anthropic from '@anthropic-ai/sdk';
import { validateOcrInput, buildOcrRequest, parseOcrResponse } from '../lib/ocrRequest.js';
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';

export const DEFAULTS = { model: 'claude-opus-5-5', daily: 30, monthly: 300 };

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fail = (status, code, message, extra = {}) => json(status, { error: { code, message, ...extra } });

/**
 * @param {Request} request
 * @param {{ANTHROPIC_API_KEY?: string, OCR_MODEL?: string, OCR_DAILY_LIMIT?: string, OCR_MONTHLY_LIMIT?: string}} env
 * @param {{fetchImpl?: typeof fetch}} deps 테스트에서 가짜 fetch 를 넣을 수 있게
 */
export async function handleOcr(request, env, { fetchImpl = fetch } = {}) {
  if (request.method !== 'POST') return fail(405, 'method', 'POST 만 받습니다.');
  if (!env.ANTHROPIC_API_KEY) return fail(503, 'not_configured', '영수증 인식 서버가 아직 준비되지 않았어요. 지금은 직접 입력해 주세요.');

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return fail(401, 'login', '로그인이 필요해요.');
  // 사용자 본인 권한으로만 Supabase 를 부름 (서버에 관리자 키를 두지 않음)
  const sb = (path, init = {}) =>
    fetchImpl(`${SUPABASE_URL}${path}`, {
      ...init,
      headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });

  // 1. 로그인 확인
  const userRes = await sb('/auth/v1/user');
  if (!userRes.ok) return fail(401, 'login', '로그인이 만료됐어요. 다시 로그인해 주세요.');

  // 2. 사용량 확인
  const limits = { day: Number(env.OCR_DAILY_LIMIT) || DEFAULTS.daily, month: Number(env.OCR_MONTHLY_LIMIT) || DEFAULTS.monthly };
  const usageRes = await sb('/rest/v1/rpc/ocr_usage_now', { method: 'POST', body: '{}' });
  if (!usageRes.ok) {
    console.error('[ocr] usage check', usageRes.status, await usageRes.text().catch(() => ''));
    return fail(503, 'usage', '사용량을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  const usage = await usageRes.json();
  if (usage.day >= limits.day)
    return fail(429, 'daily_limit', `오늘 영수증 인식(${limits.day}회)을 다 썼어요. 내일 다시 쓸 수 있어요. 지금은 직접 입력해 주세요.`, { usage, limits });
  if (usage.month >= limits.month)
    return fail(429, 'monthly_limit', `이번 달 영수증 인식(${limits.month}회)을 다 썼어요. 지금은 직접 입력해 주세요.`, { usage, limits });

  // 3. 사진 확인
  let input;
  try {
    input = validateOcrInput(await request.json());
  } catch (e) {
    return fail(400, 'bad_request', e instanceof SyntaxError ? '요청 형식이 올바르지 않습니다.' : e.message);
  }

  // 4. Claude 호출
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, fetch: fetchImpl });
  let res;
  try {
    res = await client.beta.messages.create(buildOcrRequest(input, { model: env.OCR_MODEL || DEFAULTS.model }));
  } catch (e) {
    console.error('[ocr] claude', e?.status, e?.message);
    if (e instanceof Anthropic.RateLimitError) return fail(503, 'busy', '요청이 많아요. 잠시 후 다시 시도해 주세요.');
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
      return fail(503, 'server_key', '영수증 인식 서버 설정에 문제가 있어요. 지금은 직접 입력해 주세요. (관리자: Anthropic API 키 확인)');
    if (e instanceof Anthropic.BadRequestError && /credit balance|usage limit/i.test(e.message))
      return fail(503, 'billing', '영수증 인식 서비스를 잠시 쓸 수 없어요. 지금은 직접 입력해 주세요. (관리자: Anthropic 크레딧·사용 한도 확인)');
    return fail(502, 'upstream', '영수증 인식 중 문제가 생겼어요. 잠시 후 다시 시도하거나 직접 입력해 주세요.');
  }
  let result;
  try {
    result = parseOcrResponse(res);
  } catch (e) {
    return fail(422, e.code || 'bad_result', e.message);
  }

  // 5. 성공한 인식만 기록 (기록에 실패해도 결과는 돌려줌)
  const rec = await sb('/rest/v1/rpc/record_ocr_use', { method: 'POST', body: '{}' }).catch((e) => ({ ok: false, status: String(e) }));
  if (!rec.ok) console.error('[ocr] record usage failed', rec.status);
  return json(200, { result, usage: { day: usage.day + 1, month: usage.month + 1 }, limits });
}
