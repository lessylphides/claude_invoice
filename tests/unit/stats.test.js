// 운영 통계: 인식별 AI 비용 기록, 운영자 화면 숫자, 운영자만 볼 수 있음
import { describe, it, expect } from 'vitest';
import { costUsd, recordOcrStat, adminStats, handleAdmin } from '../../src/worker/stats.js';
import { handleOcr } from '../../src/worker/ocr.js';

const NOW = Date.UTC(2026, 10, 10, 3, 0, 0); // 2026-11-10 12:00 KST

function memKV() {
  const m = new Map();
  return {
    m,
    get: async (k, type) => (m.has(k) ? (type === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null),
    put: async (k, v) => void m.set(k, v),
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
}
const usage = { input_tokens: 5000, output_tokens: 500 };

describe('AI 비용 계산', () => {
  it('모델별 가격 × 토큰, 캐시는 쓰기 1.25배·읽기 0.1배', () => {
    expect(costUsd('claude-opus-5-5', usage)).toBeCloseTo((5000 * 4 + 500 * 20) / 1e6);
    expect(costUsd('claude-sonnet-5-5', usage)).toBeCloseTo((5000 * 2 + 500 * 10) / 1e6);
    expect(costUsd('claude-opus-5-5', { cache_creation_input_tokens: 1000, cache_read_input_tokens: 1000 })).toBeCloseTo((1000 * 4 * 1.25 + 1000 * 4 * 0.1) / 1e6);
  });
});

describe('운영자 화면 숫자', () => {
  it('날짜별 인식·실패·비용, 사용자별 분포, 구독·매출을 모음', async () => {
    const env = { BILLING: memKV(), BILLING_MODE: 'test' };
    for (let i = 0; i < 3; i++) await recordOcrStat(env, { uid: 'a', model: 'claude-opus-5-5', usage, ok: true, now: NOW });
    await recordOcrStat(env, { uid: 'b', model: 'claude-opus-5-5', usage, ok: true, now: NOW - 86400000 });
    await recordOcrStat(env, { uid: 'b', model: 'claude-opus-5-5', usage, ok: false, now: NOW });
    await env.BILLING.put('sub:a', JSON.stringify({ uid: 'a', email: 'a@x', plan: 'basic', status: 'active', periodEnd: NOW + 1e9, payments: [{ amount: 9900, orderName: '기본', at: NOW - 1000 }] }));
    await env.BILLING.put('sub:b', JSON.stringify({ uid: 'b', email: 'b@x', plan: 'pro', status: 'active', cancelAtPeriodEnd: true, periodEnd: NOW + 1e9, payments: [] }));

    const s = await adminStats(env, { now: NOW, fx: 1450 });
    const one = ((5000 * 4 + 500 * 20) / 1e6) * 1450; // 한 번 부를 때 원화 비용
    expect(s.ocr.count30).toBe(4);
    expect(s.ocr.failed30).toBe(1);
    expect(s.ocr.days.at(-1)).toMatchObject({ date: '2026-11-10', count: 3, failed: 1 });
    expect(s.ocr.perReceiptKrw).toBe(Math.round((one * 5) / 4)); // 실패한 호출 비용도 1장당 원가에 포함
    expect(s.ocr.avgInput).toBe(5000);
    expect(s.ocr.month).toMatchObject({ key: '2026-11', count: 4, users: 2, max: 3 });
    expect(s.ocr.month.buckets[0]).toEqual({ label: '1~20장', users: 2 });
    expect(s.billing).toMatchObject({ paying: 2, byPlan: { basic: 1, pro: 1 }, mrr: 9900, canceling: 1, paid30: 9900 });
    expect(s.billing.payments[0]).toMatchObject({ email: 'a@x', amount: 9900 });
  });

  it('영수증 인식 서버가 성공·실패 모두 비용을 기록', async () => {
    const env = { ANTHROPIC_API_KEY: 'sk', BILLING: memKV() };
    const fetchImpl = async (url) => {
      const u = String(url);
      const j = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
      if (u.endsWith('/auth/v1/user')) return j({ id: 'u1', email: 'x@y' });
      if (u.endsWith('/rpc/ocr_usage_now')) return j({ day: 0, month: 0, total: 0, period: 0 });
      if (u.endsWith('/rpc/record_ocr_use')) return new Response(null, { status: 204 });
      return j({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_details: null, usage, content: [{ type: 'text', text: 'not json' }] });
    };
    const IMG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
    const req = new Request('https://app.costnote.co.kr/api/ocr', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ images: [IMG], categories: ['기타'] }) });
    const res = await handleOcr(req, env, { fetchImpl, now: NOW });
    expect(res.status).toBe(422); // 인식 결과를 못 읽음
    const day = await env.BILLING.get('stat:day:2026-11-10', 'json');
    expect(day).toMatchObject({ count: 0, failed: 1, input: 5000, output: 500 });
  });

  it('운영자 이메일이 아니면 403, 운영자면 가입자 숫자까지', async () => {
    const env = { BILLING: memKV(), OWNER_EMAILS: 'boss@x.com' };
    const mk = (email) => async (url) => {
      const u = String(url);
      const j = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
      if (u.endsWith('/auth/v1/user')) return j({ id: 'u', email });
      if (u.endsWith('/rpc/admin_stats')) return j({ total: 12, confirmed: 10 });
      throw new Error(u);
    };
    const req = () => new Request('https://app.costnote.co.kr/api/admin', { headers: { authorization: 'Bearer t' } });
    expect((await handleAdmin(req(), env, { fetchImpl: mk('other@x.com'), now: NOW })).status).toBe(403);
    const ok = await handleAdmin(req(), env, { fetchImpl: mk('Boss@X.com'), now: NOW });
    expect(ok.status).toBe(200);
    expect((await ok.json()).users).toEqual({ total: 12, confirmed: 10 });
  });
});
