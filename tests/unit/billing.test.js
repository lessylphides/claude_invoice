// 서버 구독 결제(/api/billing): 카드 등록·첫 결제·요금제 변경·해지·정기결제·한도
import { describe, it, expect } from 'vitest';
import { handleBilling, runRenewals, entitlement, overLimit, customerKeyFor, kstDate } from '../../src/worker/billing.js';
import { handleOcr } from '../../src/worker/ocr.js';
import { addMonth, PLANS, TRIAL } from '../../src/lib/plans.js';

const UID = '11111111-2222-3333-4444-555555555555';
const NOW = Date.UTC(2026, 10, 10, 3, 0, 0); // 2026-11-10 12:00 KST

/** 메모리 KV */
function memKV() {
  const m = new Map();
  return {
    m,
    get: async (k, type) => (m.has(k) ? (type === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null),
    put: async (k, v) => void m.set(k, v),
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
}

/** 가짜 Supabase·토스. tossFail 로 실패시킬 경로 지정 */
function fakeFetch({ email = 'owner@example.com', usage = { day: 0, month: 0, total: 0, period: 0 }, tossFail = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init, body: init.body ? JSON.parse(init.body) : null });
    const j = (status, b) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (u.endsWith('/auth/v1/user')) return j(200, { id: UID, email });
    if (u.endsWith('/rpc/ocr_usage_now')) return j(200, usage);
    if (u.endsWith('/rpc/record_ocr_use')) return new Response(null, { status: 204 });
    if (u.startsWith('https://api.tosspayments.com/v1/')) {
      const path = u.slice('https://api.tosspayments.com/v1'.length);
      if (tossFail && path.startsWith(tossFail)) return j(400, { code: 'REJECT_CARD_COMPANY', message: '카드사에서 거절했어요.' });
      if (path === '/billing/authorizations/issue') return j(200, { billingKey: 'bk_1', cardCompany: '신한', cardNumber: '4330****1234' });
      if (path.startsWith('/billing/')) return j(200, { status: 'DONE', paymentKey: `pk_${calls.length}`, receipt: { url: 'https://r' } });
    }
    throw new Error(`unexpected ${u}`);
  };
  return { fetchImpl, calls, toss: () => calls.filter((c) => c.url.includes('tosspayments')) };
}

const env = (over = {}) => ({ BILLING: memKV(), TOSS_SECRET_KEY: 'test_sk_x', BILLING_MODE: 'test', OCR_DAILY_LIMIT: '30', OCR_MONTHLY_LIMIT: '300', ...over });
const call = async (e, f, action, body, now = NOW) => {
  const req = new Request(`https://app.costnote.co.kr/api/billing${action ? `/${action}` : ''}`, {
    method: action ? 'POST' : 'GET',
    headers: { authorization: 'Bearer jwt', 'content-type': 'application/json' },
    body: action ? JSON.stringify(body ?? {}) : undefined,
  });
  const res = await handleBilling(req, e, { fetchImpl: f.fetchImpl, now });
  return { status: res.status, body: await res.json() };
};
const subscribe = (e, f, plan = 'basic', now = NOW) => call(e, f, 'subscribe', { plan, authKey: 'ak_1', customerKey: customerKeyFor(UID) }, now);
const stored = async (e) => e.BILLING.get(`sub:${UID}`, 'json');

describe('구독 시작', () => {
  it('카드 등록 → 빌링키 발급 → 첫 결제 → 구독 저장, 시크릿 키는 Basic 인증으로만', async () => {
    const e = env();
    const f = fakeFetch();
    const r = await subscribe(e, f, 'basic');
    expect(r.status).toBe(200);
    expect(r.body.subscription).toMatchObject({ plan: 'basic', status: 'active', cancelAtPeriodEnd: false, card: { company: '신한', number: '4330****1234' } });
    expect(r.body.subscription.periodEnd).toBe(addMonth(NOW));
    expect(r.body.entitlement).toMatchObject({ kind: 'plan', plan: 'basic', day: 20, month: 120, since: '2026-11-10' });
    const [issue, pay] = f.toss();
    expect(issue.body).toEqual({ authKey: 'ak_1', customerKey: `cn_${UID}` });
    expect(pay.url).toBe('https://api.tosspayments.com/v1/billing/bk_1');
    expect(pay.body).toMatchObject({ customerKey: `cn_${UID}`, amount: 9900, orderName: '코스트노트 기본 요금제 (1개월)' });
    expect(pay.init.headers.authorization).toBe(`Basic ${btoa('test_sk_x:')}`);
    expect(pay.init.headers['idempotency-key']).toBe(pay.body.orderId);
    // 빌링키는 서버에만 (앱 응답에는 없음)
    expect(JSON.stringify(r.body)).not.toContain('bk_1');
    expect((await stored(e)).billingKey).toBe('bk_1');
  });

  it('다른 계정의 customerKey, 없는 요금제는 거절', async () => {
    const e = env();
    const f = fakeFetch();
    expect((await call(e, f, 'subscribe', { plan: 'basic', authKey: 'a', customerKey: 'cn_other' })).status).toBe(400);
    expect((await call(e, f, 'subscribe', { plan: 'gold', authKey: 'a', customerKey: customerKeyFor(UID) })).status).toBe(400);
    expect(f.toss()).toHaveLength(0);
  });

  it('첫 결제가 실패하면 구독을 만들지 않고 카드사 사유를 알려 줌', async () => {
    const e = env();
    const r = await subscribe(e, fakeFetch({ tossFail: '/billing/bk_1' }));
    expect(r.status).toBe(402);
    expect(r.body.error.message).toContain('카드사에서 거절했어요');
    expect(await stored(e)).toBeNull();
  });

  it('결제 기능 off 이거나 시크릿 키가 없으면 결제하지 않음', async () => {
    let f = fakeFetch();
    expect((await subscribe(env({ BILLING_MODE: 'off' }), f)).status).toBe(503);
    expect((await subscribe(env({ TOSS_SECRET_KEY: '' }), f)).status).toBe(503);
    expect(f.toss()).toHaveLength(0);
  });
});

describe('요금제 변경·해지', () => {
  it('올리기: 차액만 바로 결제하고 결제일은 그대로', async () => {
    const e = env();
    const f = fakeFetch();
    await subscribe(e, f, 'basic');
    const r = await call(e, f, 'change', { plan: 'pro' }, NOW + 86400000);
    expect(r.status).toBe(200);
    expect(r.body.subscription).toMatchObject({ plan: 'pro', periodEnd: addMonth(NOW) });
    expect(f.toss().at(-1).body).toMatchObject({ amount: 10000, orderName: '코스트노트 기본→프로 요금제 변경 차액' });
  });

  it('내리기: 결제 없이 다음 결제일부터', async () => {
    const e = env();
    const f = fakeFetch();
    await subscribe(e, f, 'pro');
    const n = f.toss().length;
    const r = await call(e, f, 'change', { plan: 'lite' });
    expect(r.body.subscription).toMatchObject({ plan: 'pro', nextPlan: 'lite' });
    expect(f.toss()).toHaveLength(n);
  });

  it('해지하면 기간 끝까지 쓰고, 해지 취소도 됨', async () => {
    const e = env();
    const f = fakeFetch();
    await subscribe(e, f);
    expect((await call(e, f, 'cancel')).body.subscription).toMatchObject({ status: 'active', cancelAtPeriodEnd: true });
    expect((await call(e, f, 'resume')).body.subscription).toMatchObject({ cancelAtPeriodEnd: false });
  });

  it('구독이 없으면 변경·해지 불가', async () => {
    expect((await call(env(), fakeFetch(), 'cancel')).status).toBe(409);
  });

  it('탈퇴 전 close: 빌링키를 지우고 더는 결제하지 않음', async () => {
    const e = env();
    const f = fakeFetch();
    await subscribe(e, f);
    expect((await call(e, f, 'close')).status).toBe(200);
    const s = await stored(e);
    expect(s).toMatchObject({ status: 'closed', billingKey: null });
    const n = f.toss().length;
    await runRenewals(e, { fetchImpl: f.fetchImpl, now: addMonth(NOW) + 1000 });
    expect(f.toss()).toHaveLength(n);
  });
});

describe('매일 정기결제', () => {
  it('결제일이 되면 다음 요금제(내린 요금제)로 결제하고 기간을 한 달 늘림', async () => {
    const e = env();
    const f = fakeFetch();
    await subscribe(e, f, 'pro');
    await call(e, f, 'change', { plan: 'lite' });
    // 결제일 전에는 아무것도 안 함
    expect(await runRenewals(e, { fetchImpl: f.fetchImpl, now: addMonth(NOW) - 1000 })).toEqual({ renewed: 0, failed: 0, ended: 0 });
    const due = addMonth(NOW) + 60000;
    expect(await runRenewals(e, { fetchImpl: f.fetchImpl, now: due })).toEqual({ renewed: 1, failed: 0, ended: 0 });
    const s = await stored(e);
    expect(s).toMatchObject({ plan: 'lite', nextPlan: null, status: 'active', periodStart: addMonth(NOW), periodEnd: addMonth(addMonth(NOW)) });
    expect(f.toss().at(-1).body).toMatchObject({ amount: 4900 });
  });

  it('해지한 구독은 결제하지 않고 끝냄', async () => {
    const e = env();
    const f = fakeFetch();
    await subscribe(e, f);
    await call(e, f, 'cancel');
    const n = f.toss().length;
    expect(await runRenewals(e, { fetchImpl: f.fetchImpl, now: addMonth(NOW) + 1 })).toMatchObject({ ended: 1 });
    expect(f.toss()).toHaveLength(n);
    expect(await stored(e)).toMatchObject({ status: 'ended', billingKey: null });
  });

  it('결제 실패: 3일 동안 다시 시도하며 그동안은 요금제 유지, 3번 실패하면 종료', async () => {
    const e = env();
    await subscribe(e, fakeFetch());
    const bad = fakeFetch({ tossFail: '/billing/bk_1' });
    const due = addMonth(NOW) + 1000;
    expect(await runRenewals(e, { fetchImpl: bad.fetchImpl, now: due })).toMatchObject({ failed: 1 });
    let s = await stored(e);
    expect(s).toMatchObject({ status: 'past_due', failCount: 1, lastError: '카드사에서 거절했어요.' });
    expect(entitlement(e, { email: 'a@b.c' }, s, due + 86400000).kind).toBe('plan');
    await runRenewals(e, { fetchImpl: bad.fetchImpl, now: due + 86400000 });
    await runRenewals(e, { fetchImpl: bad.fetchImpl, now: due + 2 * 86400000 });
    s = await stored(e);
    expect(s).toMatchObject({ status: 'ended', billingKey: null, failCount: 3 });
  });

  it('결제가 밀린 상태에서 카드를 다시 등록하면 바로 결제하고 오늘부터 새 기간', async () => {
    const e = env();
    await subscribe(e, fakeFetch());
    const due = addMonth(NOW) + 1000;
    await runRenewals(e, { fetchImpl: fakeFetch({ tossFail: '/billing/bk_1' }).fetchImpl, now: due });
    const f = fakeFetch();
    const r = await subscribe(e, f, 'basic', due + 3600000);
    expect(r.body.subscription).toMatchObject({ status: 'active', periodStart: due + 3600000 });
    expect(f.toss().map((c) => c.url.split('/v1')[1])).toEqual(['/billing/authorizations/issue', '/billing/bk_1']);
  });
});

describe('영수증 인식 한도', () => {
  const user = { id: UID, email: 'shop@example.com' };

  it('test 모드: 구독 안 한 사람은 예전 한도(30/300), 구독자는 요금제 한도', () => {
    const e = env();
    expect(entitlement(e, user, null, NOW)).toMatchObject({ kind: 'legacy', day: 30, month: 300 });
  });

  it('live 모드: 구독 안 한 사람은 무료 체험 20장, 운영자는 예전 한도', () => {
    const e = env({ BILLING_MODE: 'live', OWNER_EMAILS: 'Owner@Example.com' });
    expect(entitlement(e, user, null, NOW)).toMatchObject({ kind: 'trial', total: TRIAL.total });
    expect(entitlement(e, { email: 'owner@example.com' }, null, NOW).kind).toBe('owner');
    expect(overLimit({ kind: 'trial', day: 20, month: null, total: 20 }, { day: 0, month: 20, total: 20, period: 0 }).code).toBe('trial_used');
  });

  it('요금제 한도는 결제일부터 센 횟수로, 무제한은 하루 한도만', () => {
    const ent = { kind: 'plan', plan: 'basic', day: 20, month: 120 };
    expect(overLimit(ent, { day: 0, month: 500, total: 900, period: 119 })).toBeNull();
    expect(overLimit(ent, { day: 0, month: 0, total: 0, period: 120 }).code).toBe('monthly_limit');
    const unl = { kind: 'plan', plan: 'unlimited', day: PLANS.unlimited.day, month: null };
    expect(overLimit(unl, { day: 49, month: 9999, total: 9999, period: 9999 })).toBeNull();
    expect(overLimit(unl, { day: 50, month: 0, total: 0, period: 0 }).code).toBe('daily_limit');
  });

  it('인식 서버가 구독 정보를 보고 결제 기간 시작일부터 사용량을 물어봄', async () => {
    const e = env({ ANTHROPIC_API_KEY: 'sk' });
    await subscribe(e, fakeFetch(), 'lite');
    const f = fakeFetch({ usage: { day: 0, month: 0, total: 70, period: 50 } });
    const body = JSON.stringify({ images: ['iVBORw0KGgo='], categories: ['기타'] });
    const req = new Request('https://app.costnote.co.kr/api/ocr', { method: 'POST', headers: { authorization: 'Bearer jwt' }, body });
    const res = await handleOcr(req, e, { fetchImpl: f.fetchImpl, now: NOW + 1000 });
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe('monthly_limit');
    expect(JSON.parse(f.calls[1].init.body)).toEqual({ since: kstDate(NOW) });
  });
});

describe('날짜', () => {
  it('한 달 더하기는 달 끝을 넘지 않음', () => {
    expect(new Date(addMonth(Date.UTC(2027, 0, 31, 5))).toISOString()).toBe('2027-02-28T05:00:00.000Z');
    expect(new Date(addMonth(Date.UTC(2026, 11, 15, 5))).toISOString()).toBe('2027-01-15T05:00:00.000Z');
  });
  it('한국 날짜', () => {
    expect(kstDate(Date.UTC(2026, 10, 30, 16, 0))).toBe('2026-12-01');
  });
});

describe('구독 저장소', () => {
  /** Durable Object 흉내: 같은 저장소를 바로 읽고 씀 */
  function fakeDO() {
    const m = new Map();
    const stub = {
      read: async (k) => m.get(k) ?? null,
      write: async (k, v) => void m.set(k, structuredClone(v)),
      keys: async (prefix) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).sort(), next: null }),
    };
    return { m, idFromName: (n) => n, get: () => stub };
  }

  it('저장하면 바로 읽히고(카드사 코드는 이름으로), 예전 KV 에만 있던 구독은 옮겨 와서 정기결제도 됨', async () => {
    const BILLING_DO = fakeDO();
    const kv = memKV();
    const old = { uid: 'old', email: 'o@x', customerKey: 'cn_old', billingKey: 'bk_old', card: { company: '24', number: '1234' }, plan: 'lite', status: 'active', periodStart: NOW - 1, periodEnd: NOW, payments: [] };
    await kv.put('sub:old', JSON.stringify(old));
    const e = env({ BILLING: kv, BILLING_DO });

    const f = fakeFetch();
    const r = await subscribe(e, f, 'basic');
    expect(r.body.subscription.card.company).toBe('신한');
    expect((await call(e, f, '')).body.subscription).toMatchObject({ plan: 'basic', status: 'active' });

    const out = await runRenewals(e, { fetchImpl: f.fetchImpl, now: NOW + 1000 });
    expect(out.renewed).toBe(1); // 옮겨 온 예전 구독(결제일 지남)
    expect(BILLING_DO.m.get('sub:old')).toMatchObject({ plan: 'lite', periodStart: NOW });
    expect(f.toss().at(-1).url).toContain('/billing/bk_old');
  });
});

describe('실제 결제 전환', () => {
  it('실제 결제(live)에서는 시험 결제로 만든 구독을 없는 것으로 보고, 정기결제도 하지 않음', async () => {
    const { getSub, runRenewals } = await import('../../src/worker/billing.js');
    const store = new Map();
    const kv = { get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), put: async (k, v) => void store.set(k, v), list: async () => ({ keys: [...store.keys()].map((name) => ({ name })), list_complete: true }) };
    const old = { uid: 'u1', plan: 'lite', status: 'active', billingKey: 'test-bk', periodStart: 0, periodEnd: 1, payments: [] };
    store.set('sub:u1', JSON.stringify(old));
    expect(await getSub({ BILLING: kv, BILLING_MODE: 'test' }, 'u1')).toMatchObject({ plan: 'lite' });
    expect(await getSub({ BILLING: kv, BILLING_MODE: 'live' }, 'u1')).toBe(null);
    store.set('sub:u2', JSON.stringify({ ...old, uid: 'u2', mode: 'live' }));
    expect(await getSub({ BILLING: kv, BILLING_MODE: 'live' }, 'u2')).toMatchObject({ mode: 'live' });
    let charged = 0;
    const fetchImpl = async () => ((charged++), new Response('{}', { status: 500 }));
    await runRenewals({ BILLING: kv, BILLING_MODE: 'live', TOSS_SECRET_KEY: 'live_sk_x' }, { fetchImpl, now: 10 });
    expect(JSON.parse(store.get('sub:u1')).billingKey).toBe('test-bk'); // 시험 구독은 건드리지 않음
    expect(charged).toBeLessThanOrEqual(1); // 실제 구독(u2)만 결제 시도
  });
});
