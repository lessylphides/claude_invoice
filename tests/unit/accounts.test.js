// 회원 관리: 정지된 계정은 인식·결제 불가, 운영자가 준 추가 인식은 한도를 넘었을 때 1회씩 차감, 운영자 API
import { describe, it, expect } from 'vitest';
import { handleOcr } from '../../src/worker/ocr.js';
import { handleAdmin } from '../../src/worker/stats.js';
import { handleBilling, customerKeyFor } from '../../src/worker/billing.js';

const UID = '11111111-2222-3333-4444-555555555555';
const IMG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const RESULT = { documentType: '영수증', date: '2026-11-04', vendor: 'x', paymentHint: 'card', items: [], total: 0 };

function memKV() {
  const m = new Map();
  return { m, get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), put: async (k, v) => void m.set(k, v), list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) };
}

function fake({ usage, email = 'shop@x.com', rpc = {} }) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ path: new URL(u).pathname, body: init.body ? JSON.parse(init.body) : null });
    const j = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (u.endsWith('/auth/v1/user')) return j({ id: UID, email });
    if (u.endsWith('/rpc/ocr_usage_now')) return j(usage);
    if (u.endsWith('/rpc/record_ocr_use')) return new Response(null, { status: 204 });
    if (u.endsWith('/rpc/use_bonus')) return j(usage.account.bonus - 1);
    for (const [name, out] of Object.entries(rpc)) if (u.endsWith(`/rpc/${name}`)) return j(out);
    if (u.includes('api.anthropic.com'))
      return j({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: JSON.stringify(RESULT) }] });
    throw new Error(`unexpected ${u}`);
  };
  return { fetchImpl, calls, paths: () => calls.map((c) => c.path) };
}
const ocrReq = () => new Request('https://app.costnote.co.kr/api/ocr', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ images: [IMG], categories: ['기타'] }) });
const env = (over = {}) => ({ ANTHROPIC_API_KEY: 'sk', BILLING: memKV(), BILLING_MODE: 'live', TOSS_SECRET_KEY: 'sk', OWNER_EMAILS: 'boss@x.com', ...over });
const acct = (a) => ({ day: 0, month: 0, total: 0, period: 0, account: { suspended: false, reason: null, bonus: 0, ...a } });

describe('계정 정지', () => {
  it('정지된 계정은 영수증 인식을 막고 사유를 알려 줌 (Claude 를 부르지 않음)', async () => {
    const f = fake({ usage: acct({ suspended: true, reason: '결제 분쟁' }) });
    const res = await handleOcr(ocrReq(), env(), { fetchImpl: f.fetchImpl });
    expect(res.status).toBe(403);
    expect((await res.json()).error.message).toContain('결제 분쟁');
    expect(f.paths()).not.toContain('/v1/messages');
  });

  it('정지된 계정은 결제(구독 시작)도 막음', async () => {
    const f = fake({ usage: acct({ suspended: true }) });
    const req = new Request('https://app.costnote.co.kr/api/billing/subscribe', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ plan: 'basic', authKey: 'a', customerKey: customerKeyFor(UID) }) });
    expect((await handleBilling(req, env(), { fetchImpl: f.fetchImpl })).status).toBe(403);
  });
});

describe('추가 인식', () => {
  it('무료 체험 20장을 다 써도 추가 인식이 남아 있으면 인식하고 1회 차감', async () => {
    const f = fake({ usage: { ...acct({ bonus: 5 }), total: 20 } });
    const res = await handleOcr(ocrReq(), env(), { fetchImpl: f.fetchImpl });
    expect(res.status).toBe(200);
    expect((await res.json()).usage.account.bonus).toBe(4);
    expect(f.paths()).toContain('/rest/v1/rpc/use_bonus');
  });
  it('한도 안이면 추가 인식은 그대로 둠', async () => {
    const f = fake({ usage: { ...acct({ bonus: 5 }), total: 3 } });
    expect((await handleOcr(ocrReq(), env(), { fetchImpl: f.fetchImpl })).status).toBe(200);
    expect(f.paths()).not.toContain('/rest/v1/rpc/use_bonus');
  });
  it('추가 인식도 없으면 막음', async () => {
    const f = fake({ usage: { ...acct({ bonus: 0 }), total: 20 } });
    expect((await handleOcr(ocrReq(), env(), { fetchImpl: f.fetchImpl })).status).toBe(429);
  });
});

describe('운영자 회원 관리 API', () => {
  const list = [{ id: UID, email: 'shop@x.com', created_at: '2026-11-01', suspended: false, bonus: 0 }];
  const req = (path, body) => new Request(`https://app.costnote.co.kr${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer t' }, body: body ? JSON.stringify(body) : undefined });

  it('운영자가 아니면 403', async () => {
    const f = fake({ usage: acct({}), email: 'shop@x.com', rpc: { admin_users: list } });
    expect((await handleAdmin(req('/api/admin/users'), env(), { fetchImpl: f.fetchImpl })).status).toBe(403);
  });

  it('회원 목록에 요금제를 붙여 줌, 추가 인식·정지는 Supabase 운영자 함수로', async () => {
    const e = env();
    await e.BILLING.put(`sub:${UID}`, JSON.stringify({ uid: UID, plan: 'basic', status: 'active', periodEnd: Date.now() + 1e9 }));
    const f = fake({ usage: acct({}), email: 'boss@x.com', rpc: { admin_users: list, admin_set_account: { bonus: 30, suspended: true, reason: '테스트' } } });
    const r = await handleAdmin(req('/api/admin/users?q=shop'), e, { fetchImpl: f.fetchImpl });
    const body = await r.json();
    expect(body.users[0].plan).toMatchObject({ id: 'basic', name: '기본' });
    expect(f.calls.find((c) => c.path.endsWith('admin_users')).body).toEqual({ q: 'shop', lim: 50 });

    const s = await handleAdmin(req(`/api/admin/users/${UID}`, { addBonus: 30, suspended: true, reason: '테스트' }), e, { fetchImpl: f.fetchImpl });
    expect(s.status).toBe(200);
    expect(f.calls.find((c) => c.path.endsWith('admin_set_account')).body).toEqual({ target: UID, add_bonus: 30, set_suspended: true, reason: '테스트' });
    expect((await handleAdmin(req(`/api/admin/users/${UID}`, { addBonus: 99999 }), e, { fetchImpl: f.fetchImpl })).status).toBe(400);
  });
});
