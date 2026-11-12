// 운영자 환불: 토스 결제 취소 API 로 전액·일부 환불, 구독 종료, 손님 메일
import { describe, it, expect } from 'vitest';
import { refundPayment } from '../../src/worker/billing.js';
import { handleAdmin } from '../../src/worker/stats.js';

function memKV(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, JSON.stringify(v)]));
  return { m, get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), put: async (k, v) => void m.set(k, typeof v === 'string' ? v : JSON.stringify(v)), list: async () => ({ keys: [...m.keys()].map((name) => ({ name })), list_complete: true }) };
}
const sub = () => ({ uid: 'u1', email: 'shop@x.com', plan: 'lite', status: 'active', mode: 'live', billingKey: 'bk', periodStart: 0, periodEnd: 9e15, payments: [{ paymentKey: 'pk1', orderId: 'o1', amount: 4900, orderName: '코스트노트 라이트 요금제 (1개월)', at: 1 }] });
function fakeToss(ok = true) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null, headers: init?.headers });
    if (String(url).includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'owner', email: 'boss@x.com' }));
    if (String(url).includes('resend')) return new Response('{}');
    return new Response(JSON.stringify(ok ? { status: 'CANCELED' } : { code: 'NOT_CANCELABLE', message: '취소할 수 없는 결제' }), { status: ok ? 200 : 400 });
  };
  return { fetchImpl, calls };
}

describe('운영자 환불', () => {
  it('일부 환불 → 남은 금액만큼 더 환불 가능, 넘으면 거절, 전액이면 더 못 함', async () => {
    const kv = memKV({ 'sub:u1': sub() });
    const env = { BILLING: kv, TOSS_SECRET_KEY: 'live_sk_x' };
    const t = fakeToss();
    const r1 = await refundPayment(env, { uid: 'u1', paymentKey: 'pk1', amount: 2000, reason: '사용분 차감 환불' }, { fetchImpl: t.fetchImpl, now: 5 });
    expect(r1).toMatchObject({ ok: true, amount: 2000, left: 2900, ended: false });
    expect(t.calls[0].url).toBe('https://api.tosspayments.com/v1/payments/pk1/cancel');
    expect(t.calls[0].body).toEqual({ cancelReason: '사용분 차감 환불', cancelAmount: 2000 });
    expect((await refundPayment(env, { uid: 'u1', paymentKey: 'pk1', amount: 3000, reason: 'x' }, { fetchImpl: t.fetchImpl })).status).toBe(400);
    const r2 = await refundPayment(env, { uid: 'u1', paymentKey: 'pk1', reason: '나머지', endSub: true }, { fetchImpl: t.fetchImpl, now: 6 });
    expect(r2).toMatchObject({ ok: true, amount: 2900, left: 0, ended: true });
    const saved = JSON.parse(kv.m.get('sub:u1'));
    expect(saved).toMatchObject({ status: 'ended', billingKey: null });
    expect(saved.payments[0]).toMatchObject({ canceled: 4900 });
    expect(saved.payments[0].cancels).toHaveLength(2);
    expect((await refundPayment(env, { uid: 'u1', paymentKey: 'pk1', reason: 'x' }, { fetchImpl: t.fetchImpl })).status).toBe(409);
  });

  it('토스가 거절하면 기록을 바꾸지 않음', async () => {
    const kv = memKV({ 'sub:u1': sub() });
    const t = fakeToss(false);
    const r = await refundPayment({ BILLING: kv, TOSS_SECRET_KEY: 'k' }, { uid: 'u1', paymentKey: 'pk1', reason: 'x' }, { fetchImpl: t.fetchImpl });
    expect(r).toMatchObject({ ok: false, status: 502 });
    expect(r.message).toContain('취소할 수 없는 결제');
    expect(JSON.parse(kv.m.get('sub:u1')).payments[0].canceled).toBeUndefined();
  });

  it('API: 운영자만, 환불하면 손님에게 메일', async () => {
    const kv = memKV({ 'sub:u1': sub() });
    const env = { BILLING: kv, TOSS_SECRET_KEY: 'k', OWNER_EMAILS: 'boss@x.com', RESEND_API_KEY: 're' };
    const t = fakeToss();
    const req = (body) => new Request('https://app.costnote.co.kr/api/admin/refund', { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const res = await handleAdmin(req({ uid: 'u1', paymentKey: 'pk1', reason: '고객 요청', endSub: true }), env, { fetchImpl: t.fetchImpl, now: 7 });
    expect(res.status).toBe(200);
    const mail = t.calls.find((c) => c.url.includes('resend'));
    expect(mail.body.to).toEqual(['shop@x.com']);
    expect(mail.body.subject).toContain('환불');
    const notOwner = await handleAdmin(req({}), { ...env, OWNER_EMAILS: 'someone@else.com' }, { fetchImpl: t.fetchImpl });
    expect(notOwner.status).toBe(403);
  });
});
