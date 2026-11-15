// 가입 다음 날 사용 안내 메일: 20시간 뒤, 영수증 0~1장인 회원에게 한 번만
import { describe, it, expect } from 'vitest';
import { runNudges } from '../../src/worker/nudge.js';

function memKV() {
  const m = new Map();
  return {
    m,
    get: async (k, type) => (m.has(k) ? (type === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null),
    put: async (k, v) => void m.set(k, JSON.stringify(v)),
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
}
const NOW = Date.UTC(2026, 10, 16, 1);
const H = 3600 * 1000;
const purchases = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, date: '2026-11-15', vendor: 'v', items: [] }));

describe('다음 날 사용 안내', () => {
  it('영수증 0장·1장인 회원에게만 한 번, 활발한 회원·운영자·너무 이른/늦은 회원은 안 보냄', async () => {
    const kv = memKV();
    const join = (uid, email, ageH) => kv.m.set(`joined:${uid}`, JSON.stringify({ at: NOW - ageH * H, ref: null, email }));
    join('u0', 'zero@b.c', 25);
    join('u1', 'one@b.c', 30);
    join('u5', 'busy@b.c', 26);
    join('new', 'new@b.c', 3);
    join('old', 'old@b.c', 24 * 9);
    join('boss', 'boss@x.com', 25);
    const counts = { u0: 0, u1: 1, u5: 5 };
    const mails = [];
    const fetchImpl = async (u, init) => {
      const url = String(u);
      if (url.includes('/rpc/mcp_ledger_get')) return new Response(JSON.stringify({ rev: 1, data: { purchases: purchases(counts[JSON.parse(init.body).uid] ?? 0), menus: [] } }), { status: 200 });
      if (url.includes('api.resend.com')) return mails.push(JSON.parse(init.body)), new Response('{}', { status: 200 });
      throw new Error(url);
    };
    const env = { BILLING: kv, RESEND_API_KEY: 'k', BACKUP_SECRET: 's', OWNER_EMAILS: 'boss@x.com', SUPPORT_EMAIL: 'help@costnote.co.kr' };
    const r = await runNudges(env, { fetchImpl, now: NOW });
    expect(r).toMatchObject({ sent: 2, active: 1, waiting: 1 });
    expect(mails.map((m) => m.to[0]).sort()).toEqual(['one@b.c', 'zero@b.c']);
    const zero = mails.find((m) => m.to[0] === 'zero@b.c');
    expect(zero.subject).toContain('영수증 한 장만');
    expect(zero.reply_to).toBe('help@costnote.co.kr');
    expect(mails.find((m) => m.to[0] === 'one@b.c').subject).toContain('메뉴 하나만');
    // 다음 날 다시 돌려도 또 보내지 않음
    mails.length = 0;
    await runNudges(env, { fetchImpl, now: NOW + 24 * H });
    expect(mails.map((m) => m.to[0])).toEqual(['new@b.c']);
  });
});
