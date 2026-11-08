// 장부 정기 백업(압축·암호화·보관·복구)과 정기결제 실패 메일
import { describe, it, expect } from 'vitest';
import { seal, unseal, runBackup, listBackups, readBackup } from '../../src/worker/backup.js';
import { runRenewals, customerKeyFor } from '../../src/worker/billing.js';
import { addMonth } from '../../src/lib/plans.js';

const NOW = Date.UTC(2026, 10, 10, 1, 7, 0); // 2026-11-10 10:07 KST

/** 메모리 KV (arrayBuffer·metadata·expirationTtl 지원) */
function memKV() {
  const m = new Map();
  return {
    m,
    async get(k, type) {
      if (!m.has(k)) return null;
      const { v } = m.get(k);
      if (type === 'json') return JSON.parse(v);
      if (type === 'arrayBuffer') return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
      return v;
    },
    async put(k, v, opts = {}) {
      m.set(k, { v, opts });
    },
    async list({ prefix }) {
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: m.get(name).opts?.metadata })), list_complete: true };
    },
  };
}

describe('장부 백업', () => {
  it('압축·암호화한 내용은 같은 비밀 값으로만 풀림', async () => {
    const obj = { ledgers: [{ user_id: 'u', data: { purchases: [{ vendor: '가락청과' }] } }] };
    const bytes = await seal('s3cret', obj);
    expect(new TextDecoder().decode(bytes)).not.toContain('가락청과');
    expect(await unseal('s3cret', bytes)).toEqual(obj);
    await expect(unseal('wrong', bytes)).rejects.toThrow();
  });

  it('매일 Supabase 에서 모든 장부를 받아 날짜별로 14일 보관, 운영자가 내려받을 수 있음', async () => {
    const env = { BACKUP_SECRET: 'k', BILLING: memKV() };
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
      return new Response(JSON.stringify([{ user_id: 'u1', rev: 3, data: { purchases: [] } }, { user_id: 'u2', rev: 1, data: {} }]), { status: 200 });
    };
    const r = await runBackup(env, { fetchImpl, now: NOW });
    expect(r).toMatchObject({ ok: true, date: '2026-11-10', users: 2 });
    expect(calls[0].url).toMatch(/\/rest\/v1\/rpc\/backup_ledgers$/);
    expect(calls[0].body).toEqual({ secret: 'k' });
    expect(calls[0].headers.authorization).toBeUndefined(); // 사용자 토큰·관리자 키 없이 비밀 값으로만
    expect(env.BILLING.m.get('backup:2026-11-10').opts.expirationTtl).toBe(14 * 86400);
    expect(await listBackups(env)).toEqual([expect.objectContaining({ date: '2026-11-10', users: 2 })]);
    const back = await readBackup(env, '2026-11-10');
    expect(back.ledgers.map((l) => l.user_id)).toEqual(['u1', 'u2']);
    expect(await readBackup(env, '../etc')).toBeNull();
  });

  it('비밀 값이 없으면 백업하지 않고, Supabase 오류는 실패로 알려 줌', async () => {
    expect(await runBackup({ BILLING: memKV() }, { fetchImpl: async () => null })).toEqual({ skipped: true });
    const r = await runBackup({ BACKUP_SECRET: 'k', BILLING: memKV() }, { fetchImpl: async () => new Response('forbidden', { status: 400 }) });
    expect(r).toEqual({ ok: false, status: 400 });
  });
});

describe('정기결제 실패 메일', () => {
  const UID = 'u-1';
  const sub = () => ({
    uid: UID, email: 'shop@example.com', customerKey: customerKeyFor(UID), billingKey: 'bk', plan: 'basic', status: 'active',
    periodStart: NOW - 30 * 86400000, periodEnd: NOW - 1000, cancelAtPeriodEnd: false, payments: [],
  });
  function fake() {
    const mails = [];
    const fetchImpl = async (url, init) => {
      const u = String(url);
      if (u.startsWith('https://api.resend.com/')) {
        mails.push({ ...JSON.parse(init.body), auth: init.headers.authorization });
        return new Response('{}', { status: 200 });
      }
      return new Response(JSON.stringify({ code: 'REJECT_CARD_COMPANY', message: '한도 초과' }), { status: 400 });
    };
    return { fetchImpl, mails };
  }

  it('실패하면 손님과 운영자에게 메일, 세 번째 실패면 구독 종료 메일', async () => {
    const kv = memKV();
    await kv.put(`sub:${UID}`, JSON.stringify(sub()));
    const env = { BILLING: { ...kv, get: (k, t) => kv.get(k, t === 'json' ? 'json' : t), put: (k, v) => kv.put(k, v) }, TOSS_SECRET_KEY: 'sk', BILLING_MODE: 'live', RESEND_API_KEY: 're_x', OWNER_EMAILS: 'boss@x.com' };
    const f = fake();
    await runRenewals(env, { fetchImpl: f.fetchImpl, now: NOW });
    expect(f.mails.map((m) => [m.to[0], m.subject])).toEqual([
      ['shop@example.com', '[코스트노트] 정기결제에 실패했어요'],
      ['boss@x.com', '[코스트노트 운영] 정기결제 실패 1건 · 종료 0건'],
    ]);
    expect(f.mails[0].from).toBe('코스트노트 <noreply@costnote.co.kr>');
    expect(f.mails[0].text).toContain('한도 초과');
    expect(f.mails[0].text).toContain('남은 시도: 2번');
    expect(f.mails[0].auth).toBe('Bearer re_x');

    await runRenewals(env, { fetchImpl: f.fetchImpl, now: NOW + 86400000 });
    await runRenewals(env, { fetchImpl: f.fetchImpl, now: NOW + 2 * 86400000 });
    expect(f.mails.filter((m) => m.to[0] === 'shop@example.com').at(-1).subject).toBe('[코스트노트] 결제가 되지 않아 구독이 끝났어요');
  });

  it('메일 키가 없어도 결제 처리는 그대로', async () => {
    const kv = memKV();
    await kv.put(`sub:${UID}`, JSON.stringify(sub()));
    const env = { BILLING: kv, TOSS_SECRET_KEY: 'sk', BILLING_MODE: 'live' };
    const f = fake();
    expect(await runRenewals(env, { fetchImpl: f.fetchImpl, now: NOW })).toEqual({ renewed: 0, failed: 1, ended: 0 });
    expect(f.mails).toEqual([]);
    expect(addMonth).toBeTypeOf('function');
  });
});
