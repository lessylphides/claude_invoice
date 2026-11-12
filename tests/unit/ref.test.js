// 가입 경로(광고 링크 꼬리표): 소개 페이지 쿠키·방문 수, 가입 계정 기록, 운영 현황 집계
import { describe, it, expect } from 'vitest';
import { cleanRef, captureRef, reportRef } from '../../src/lib/ref.js';
import { withLandingRef, handleRef, refStats } from '../../src/worker/ref.js';

function memKV() {
  const m = new Map();
  return {
    m,
    get: async (k, type) => (m.has(k) ? (type === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null),
    put: async (k, v) => void m.set(k, v),
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
}
const mem = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m };
};
const NOW = Date.UTC(2026, 10, 12, 3);
const page = () => new Response('<html>', { headers: { 'content-type': 'text/html' } });

describe('꼬리표', () => {
  it('영문·숫자·_- 20자까지만, 소문자로', () => {
    expect(cleanRef('IG1')).toBe('ig1');
    expect(cleanRef('naver_blog-2')).toBe('naver_blog-2');
    expect(cleanRef('a b')).toBeNull();
    expect(cleanRef('<script>')).toBeNull();
    expect(cleanRef('x'.repeat(21))).toBeNull();
    expect(cleanRef(undefined)).toBeNull();
  });
});

describe('소개 페이지: 쿠키 + 방문 수', () => {
  it('처음 오면 쿠키를 남기고 방문 1, 다시 오면(쿠키 있음) 세지 않음', async () => {
    const env = { BILLING: memKV() };
    const r = await withLandingRef(new Request('https://costnote.co.kr/?ref=IG1'), page(), env, NOW);
    const c = r.headers.get('set-cookie');
    expect(c).toContain('cn_ref=ig1');
    expect(c).toContain('Domain=costnote.co.kr');
    expect(c).toContain('Max-Age=2592000');
    expect(c).not.toContain('HttpOnly'); // 앱 화면에서 읽어야 함
    expect(JSON.parse(env.BILLING.m.get('refvisit:ig1'))).toEqual({ total: 1, days: { '2026-11-12': 1 } });

    const again = await withLandingRef(new Request('https://costnote.co.kr/?ref=ig2', { headers: { cookie: 'cn_ref=ig1' } }), page(), env, NOW);
    expect(again.headers.get('set-cookie')).toBeNull(); // 처음 온 경로를 덮어쓰지 않음
    expect(env.BILLING.m.has('refvisit:ig2')).toBe(false);
  });
  it('앱 안 브라우저에서 밖으로 다시 연 것(nv=1)은 쿠키만 남기고 방문은 세지 않음', async () => {
    const env = { BILLING: memKV() };
    const r = await withLandingRef(new Request('https://costnote.co.kr/?ref=igad1&nv=1'), page(), env, NOW);
    expect(r.headers.get('set-cookie')).toContain('cn_ref=igad1');
    expect(env.BILLING.m.size).toBe(0);
  });
  it('꼬리표가 없거나 이상하면 그대로', async () => {
    const env = { BILLING: memKV() };
    for (const u of ['https://costnote.co.kr/', 'https://costnote.co.kr/?ref=%3Cx%3E']) {
      const r = await withLandingRef(new Request(u), page(), env, NOW);
      expect(r.headers.get('set-cookie')).toBeNull();
    }
    expect(env.BILLING.m.size).toBe(0);
  });
});

describe('가입 계정 기록', () => {
  const UID = '11111111-2222-3333-4444-555555555555';
  const fetchWith = (meta) => async (u) => {
    if (String(u).endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: UID, email: 'a@b.c', user_metadata: meta, created_at: '2026-11-12T00:00:00Z' }), { status: 200 });
    throw new Error(String(u));
  };
  const post = (env, meta, body) =>
    handleRef(new Request('https://app.costnote.co.kr/api/ref', { method: 'POST', headers: { authorization: 'Bearer t' }, body: body && JSON.stringify(body) }), env, { fetchImpl: fetchWith(meta), now: NOW });

  it('계정 정보의 꼬리표만 믿고, 한 번만 기록', async () => {
    const env = { BILLING: memKV() };
    expect(await (await post(env, { ref: 'ig1' }, { ref: 'hack' })).json()).toEqual({ ref: 'ig1' });
    expect(JSON.parse(env.BILLING.m.get(`refuser:${UID}`)).ref).toBe('ig1');
    await post(env, { ref: 'ig9' });
    expect(JSON.parse(env.BILLING.m.get(`refuser:${UID}`)).ref).toBe('ig1');
  });
  it('꼬리표 없는 계정은 기록 안 함, 로그인 없으면 401', async () => {
    const env = { BILLING: memKV() };
    expect(await (await post(env, {})).json()).toEqual({ ref: null });
    expect([...env.BILLING.m.keys()].some((k) => k.startsWith('refuser:'))).toBe(false);
    const r = await handleRef(new Request('https://app.costnote.co.kr/api/ref', { method: 'POST' }), env, { fetchImpl: fetchWith({}) });
    expect(r.status).toBe(401);
  });
});

describe('운영 현황 집계', () => {
  it('꼬리표별 방문 → 가입 → 구독', async () => {
    const kv = memKV();
    kv.m.set('refvisit:ig1', JSON.stringify({ total: 40, days: {} }));
    kv.m.set('refvisit:ig2', JSON.stringify({ total: 10, days: {} }));
    kv.m.set('refuser:u1', JSON.stringify({ ref: 'ig1' }));
    kv.m.set('refuser:u2', JSON.stringify({ ref: 'ig1' }));
    kv.m.set('refuser:u3', JSON.stringify({ ref: 'blog' }));
    const rows = await refStats({ BILLING: kv }, new Set(['u2']));
    expect(rows).toEqual([
      { ref: 'ig1', visits: 40, signups: 2, paying: 1 },
      { ref: 'blog', visits: 0, signups: 1, paying: 0 },
      { ref: 'ig2', visits: 10, signups: 0, paying: 0 },
    ]);
  });
});

describe('앱: 꼬리표 기억·보내기', () => {
  it('주소 ?ref 나 쿠키에서 읽고, 처음 것만 기억', () => {
    const ls = mem();
    expect(captureRef({ search: '' }, { cookie: 'a=1; cn_ref=ig2' }, ls)).toBe('ig2');
    expect(captureRef({ search: '?ref=ig3' }, { cookie: '' }, ls)).toBe('ig2');
    expect(captureRef({ search: '?ref=ig3' }, { cookie: '' }, mem())).toBe('ig3');
    expect(captureRef({ search: '' }, { cookie: '' }, mem())).toBeNull();
  });
  it('로그인한 계정마다 한 번 보냄', async () => {
    const ls = mem();
    let n = 0;
    const f = async () => (n++, new Response('{}', { status: 200 }));
    expect(await reportRef({ id: 'u1', user_metadata: {} }, null, f, ls)).toBe(false);
    expect(await reportRef({ id: 'u1', user_metadata: { ref: 'ig1' } }, 't', f, ls)).toBe(true);
    expect(await reportRef({ id: 'u1', user_metadata: { ref: 'ig1' } }, 't', f, ls)).toBe(false);
    expect(n).toBe(1);
  });
});

describe('새 가입 알림 메일', () => {
  const UID = '11111111-2222-3333-4444-555555555555';
  const run = async (env, { created, email = 'new@b.c', meta = {} }) => {
    const mails = [];
    const fetchImpl = async (u, init) => {
      if (String(u).endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: UID, email, user_metadata: meta, created_at: created }), { status: 200 });
      if (String(u).includes('api.resend.com')) return mails.push(JSON.parse(init.body)), new Response('{}', { status: 200 });
      throw new Error(String(u));
    };
    await handleRef(new Request('https://app.costnote.co.kr/api/ref', { method: 'POST', headers: { authorization: 'Bearer t' } }), env, { fetchImpl, now: NOW });
    return mails;
  };
  const base = () => ({ BILLING: memKV(), RESEND_API_KEY: 'k', OWNER_EMAILS: 'boss@x.com' });

  it('새로 가입한 회원이 처음 로그인하면 운영자에게 한 번만 메일 (가입 경로 포함)', async () => {
    const env = base();
    const m1 = await run(env, { created: new Date(NOW - 3600_000).toISOString(), meta: { ref: 'igad1' } });
    expect(m1).toHaveLength(1);
    expect(m1[0].to).toEqual(['boss@x.com']);
    expect(m1[0].subject).toContain('igad1');
    expect(m1[0].text).toContain('new@b.c');
    expect(await run(env, { created: new Date(NOW - 3600_000).toISOString() })).toHaveLength(0);
  });
  it('예전 회원·운영자 본인은 알리지 않음', async () => {
    expect(await run(base(), { created: '2026-10-01T00:00:00Z' })).toHaveLength(0);
    expect(await run(base(), { created: new Date(NOW).toISOString(), email: 'boss@x.com' })).toHaveLength(0);
  });
});
