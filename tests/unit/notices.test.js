// 공지사항: 누구나 읽기, 운영자만 쓰기·고치기·지우기
import { describe, it, expect } from 'vitest';
import { handleNotices } from '../../src/worker/notices.js';

function memKV() {
  const m = new Map();
  return {
    m,
    get: async (k, type) => (m.has(k) ? (type === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null),
    put: async (k, v) => void m.set(k, v),
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
}
const as = (email) => async (u) => {
  if (String(u).endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: '11111111-2222-3333-4444-555555555555', email }), { status: 200 });
  throw new Error(String(u));
};
const env = () => ({ BILLING: memKV(), OWNER_EMAILS: 'boss@x.com' });
const post = (e, body, email = 'boss@x.com', now = 1000) =>
  handleNotices(new Request('https://app.costnote.co.kr/api/admin/notices', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify(body) }), e, { fetchImpl: as(email), now });
const get = async (e) => (await (await handleNotices(new Request('https://app.costnote.co.kr/api/notices'), e)).json()).notices;

describe('공지사항', () => {
  it('운영자가 올리고 고치고 지우면, 누구나 최신순으로 읽음', async () => {
    const e = env();
    expect(await get(e)).toEqual([]);
    await post(e, { action: 'save', notice: { kind: 'feature', title: 'PDF 인식', body: '거래명세서 PDF도 돼요', important: false } }, 'boss@x.com', 1000);
    await post(e, { action: 'save', notice: { kind: 'notice', title: '요금 안내', body: '...', important: true } }, 'boss@x.com', 2000);
    let list = await get(e);
    expect(list.map((n) => n.title)).toEqual(['요금 안내', 'PDF 인식']);
    expect(list[0]).toMatchObject({ kind: 'notice', important: true, at: 2000 });
    await post(e, { action: 'save', notice: { id: list[1].id, kind: 'fix', title: 'PDF 인식 (고침)', body: 'x' } }, 'boss@x.com', 3000);
    list = await get(e);
    expect(list[1]).toMatchObject({ title: 'PDF 인식 (고침)', kind: 'fix', at: 1000, updatedAt: 3000 });
    await post(e, { action: 'delete', id: list[0].id });
    expect((await get(e)).map((n) => n.title)).toEqual(['PDF 인식 (고침)']);
  });
  it('운영자가 아니면 쓸 수 없고, 제목이 없으면 거절', async () => {
    const e = env();
    expect((await post(e, { action: 'save', notice: { kind: 'feature', title: 'x' } }, 'guest@b.c')).status).toBe(403);
    expect((await post(e, { action: 'save', notice: { kind: 'feature', title: '  ' } })).status).toBe(400);
  });
});
