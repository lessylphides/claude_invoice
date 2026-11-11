// 레벨업 선물: 서버가 서버 장부로 레벨을 다시 계산, 같은 레벨은 한 번만, 하루 10장까지, 인식에서 선물부터 씀
import { describe, it, expect } from 'vitest';
import { handleLevel, applyClaim, DAILY_GIFT_CAP, MONTHLY_GIFT_CAP } from '../../src/worker/levels.js';
import { handleOcr } from '../../src/worker/ocr.js';

const UID = '11111111-2222-3333-4444-555555555555';
const NOW = Date.UTC(2026, 10, 11, 3); // 2026-11-11 12:00 KST
const IMG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

function memKV() {
  const m = new Map();
  return { m, get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), put: async (k, v) => void m.set(k, v), list: async () => ({ keys: [], list_complete: true }) };
}
/** 영수증 n건(서로 다른 날짜·거래처)이 있는 장부 → 포인트 10n */
const ledgerWith = (n) => ({
  purchases: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, date: '2026-10-01', vendor: `가게${i}`, createdAt: Date.UTC(2026, 9, 1) + i * 86400000 * 2, items: [{ amount: 1000 + i }] })),
});

function fake({ ledger = {}, usage = { day: 0, month: 0, total: 20, period: 0, account: { suspended: false, bonus: 0 } } } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push(new URL(u).pathname + new URL(u).search);
    const j = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
    if (u.endsWith('/auth/v1/user')) return j({ id: UID, email: 'a@b.c' });
    if (u.includes('/rest/v1/ledgers?')) return j([{ data: ledger }]);
    if (u.endsWith('/rpc/ocr_usage_now')) return j(usage);
    if (u.endsWith('/rpc/record_ocr_use')) return new Response(null, { status: 204 });
    if (u.endsWith('/rpc/use_bonus')) return j(0);
    if (u.includes('api.anthropic.com'))
      return j({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: JSON.stringify({ documentType: '영수증', date: '2026-11-11', vendor: 'x', paymentHint: 'card', items: [], total: 0 }) }] });
    throw new Error(`unexpected ${u}`);
  };
  return { fetchImpl, calls };
}
const claim = (env, f, now = NOW) => handleLevel(new Request('https://app.costnote.co.kr/api/level/claim', { method: 'POST', headers: { authorization: 'Bearer t' } }), env, { fetchImpl: f.fetchImpl, now }).then((r) => r.json());

describe('레벨업 선물', () => {
  it('하루 한도: 한꺼번에 여러 레벨이 올라도 하루 10장까지, 나머지는 다음 날', () => {
    const today = '2026-11-11';
    const { rec, gifts } = applyClaim(null, 6, today, NOW); // Lv.2~6 선물 3+3+3+5+5
    expect(gifts.map((g) => g.level)).toEqual([2, 3, 4]); // 3+3+3=9, 다음 5장은 한도(10) 초과
    expect(rec).toMatchObject({ rewarded: 4, balance: 9, dayGranted: 9 });
    const next = applyClaim(rec, 6, '2026-11-12', NOW + 86400000);
    expect(next.gifts.map((g) => g.level)).toEqual([5, 6]);
    expect(next.rec.balance).toBe(9 + 10);
    expect(DAILY_GIFT_CAP).toBe(10);
  });

  it('한 달 한도 20장: 넘는 몫은 다음 달에', () => {
    expect(MONTHLY_GIFT_CAP).toBe(20);
    let rec = null;
    const got = [];
    for (let d = 1; d <= 30; d++) {
      const out = applyClaim(rec, 15, `2026-11-${String(d).padStart(2, '0')}`, NOW);
      rec = out.rec;
      got.push(...out.gifts);
    }
    expect(got.reduce((s, g) => s + g.amount, 0)).toBeLessThanOrEqual(20);
    expect(rec.monthGranted).toBe(19); // 3+3+3+5+5 = 19, 다음 5장은 다음 달
    const dec = applyClaim(rec, 15, '2026-12-01', NOW);
    expect(dec.gifts[0]).toEqual({ level: 7, amount: 5 });
  });

  it('선물 없는 레벨(21~24)은 지나가고 Lv.25에서 20장', () => {
    const { rec, gifts } = applyClaim({ rewarded: 20, balance: 0, granted: 0 }, 25, '2026-11-11', NOW);
    expect(gifts).toEqual([{ level: 25, amount: 20 }]);
    expect(rec).toMatchObject({ rewarded: 25, balance: 20 });
  });

  it('서버에 저장된 장부로 레벨을 계산하고, 같은 레벨 선물은 한 번만', async () => {
    const env = { BILLING: memKV() };
    const f = fake({ ledger: ledgerWith(3) }); // 30점 + 첫 영수증 미션 20 = 50점 → Lv.2
    const r1 = await claim(env, f);
    expect(r1).toMatchObject({ level: 2, gifts: [{ level: 2, amount: 3 }], balance: 3 });
    expect(f.calls.some((c) => c.startsWith(`/rest/v1/ledgers?select=data&user_id=eq.${UID}`))).toBe(true);
    const r2 = await claim(env, f);
    expect(r2.gifts).toEqual([]);
    expect(r2.balance).toBe(3);
  });

  it('장부에 기록이 없으면(레벨 1) 선물 없음 — 앱이 보낸 숫자는 받지 않음', async () => {
    const env = { BILLING: memKV() };
    expect((await claim(env, fake({ ledger: {} }))).gifts).toEqual([]);
  });

  it('무료 체험 중에는 선물이 쌓이기만 하고 쓰지 않음 (구독하면 바로 씀)', async () => {
    const env = { ANTHROPIC_API_KEY: 'sk', BILLING: memKV(), BILLING_MODE: 'live' };
    const r = await claim(env, fake({ ledger: ledgerWith(3) }));
    expect(r).toMatchObject({ balance: 3, usable: false });
    const req = new Request('https://app.costnote.co.kr/api/ocr', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ images: [IMG], categories: ['기타'] }) });
    const res = await handleOcr(req, env, { fetchImpl: fake().fetchImpl, now: NOW });
    expect(res.status).toBe(429);
    expect(JSON.parse(env.BILLING.m.get(`lvl:${UID}`)).balance).toBe(3);
  });

  it('영수증 인식: 한도를 다 써도 (구독 중이면) 선물부터 1장 씀', async () => {
    const env = { ANTHROPIC_API_KEY: 'sk', BILLING: memKV(), BILLING_MODE: 'test' };
    await claim(env, fake({ ledger: ledgerWith(3) })); // 선물 3장
    const f = fake({ usage: { day: 30, month: 30, total: 30, period: 0, account: { suspended: false, bonus: 0 } } }); // 하루 한도(30) 다 씀
    const req = new Request('https://app.costnote.co.kr/api/ocr', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ images: [IMG], categories: ['기타'] }) });
    const res = await handleOcr(req, env, { fetchImpl: f.fetchImpl, now: NOW });
    expect(res.status).toBe(200);
    expect((await res.json()).usage.account.bonus).toBe(2);
    expect(f.calls).not.toContain('/rest/v1/rpc/use_bonus'); // 운영자 추가 인식은 그대로
    expect(JSON.parse(env.BILLING.m.get(`lvl:${UID}`)).balance).toBe(2);
  });
});
