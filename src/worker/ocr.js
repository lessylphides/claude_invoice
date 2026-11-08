// 서버: 영수증 인식 (/api/ocr)
// 앱 → 이 서버 → Claude API. Anthropic API 키는 Cloudflare 비밀 값(ANTHROPIC_API_KEY)에만 있고 휴대폰에는 없습니다.
// 1) Supabase 로그인 확인  2) 계정별 하루·한 달 사용량 확인  3) 사진 확인  4) Claude 호출  5) 성공한 인식만 사용량에 기록
import Anthropic from '@anthropic-ai/sdk';
import { validateOcrInput, buildOcrRequest, parseOcrResponse } from '../lib/ocrRequest.js';
import { fail, json, authUser, usageNow } from './common.js';
import { entitlement, overLimit, getSub } from './billing.js';

export const DEFAULTS = { model: 'claude-opus-5-5', daily: 30, monthly: 300 };

/**
 * @param {Request} request
 * @param {{ANTHROPIC_API_KEY?: string, OCR_MODEL?: string, OCR_DAILY_LIMIT?: string, OCR_MONTHLY_LIMIT?: string, BILLING?: KVNamespace, BILLING_MODE?: string}} env
 * @param {{fetchImpl?: typeof fetch, now?: number}} deps 테스트에서 가짜 fetch 를 넣을 수 있게
 */
export async function handleOcr(request, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (request.method !== 'POST') return fail(405, 'method', 'POST 만 받습니다.');
  if (!env.ANTHROPIC_API_KEY) return fail(503, 'not_configured', '영수증 인식 서버가 아직 준비되지 않았어요. 지금은 직접 입력해 주세요.');

  // 1. 로그인 확인
  const a = await authUser(request, fetchImpl);
  if (a.error) return a.error;
  const { user, sb } = a;

  // 2. 사용량 확인 (요금제·무료 체험에 따라 한도가 다름)
  const ent = entitlement(env, user, await getSub(env, user.id).catch(() => null), now);
  const usage = await usageNow(sb, ent.since ?? null);
  if (!usage) return fail(503, 'usage', '사용량을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
  const limits = { day: ent.day, month: ent.month, total: ent.total ?? null, kind: ent.kind, plan: ent.plan ?? null };
  const over = overLimit(ent, usage);
  if (over) return fail(429, over.code, over.message, { usage, limits });

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
  const after = { day: usage.day + 1, month: usage.month + 1, total: usage.total + 1, period: usage.period + 1 };
  return json(200, { result, usage: after, limits });
}
