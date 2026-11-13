// 문의하기: 운영자에게 정리된 메일(답장은 회원에게), 회원에게 접수 메일, 하루 5번까지
import { describe, it, expect } from 'vitest';
import { handleSupport } from '../../src/worker/support.js';
import { deviceLabel } from '../../src/lib/support.js';

function memKV() {
  const m = new Map();
  return {
    m,
    get: async (k, type) => (m.has(k) ? (type === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null),
    put: async (k, v) => void m.set(k, v),
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
}
const UID = '11111111-2222-3333-4444-555555555555';
const NOW = Date.UTC(2026, 10, 13, 6, 40);
function setup() {
  const mails = [];
  const fetchImpl = async (u, init) => {
    if (String(u).endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: UID, email: 'guest@b.c', created_at: '2026-11-12T00:00:00Z' }), { status: 200 });
    if (String(u).includes('api.resend.com')) return mails.push(JSON.parse(init.body)), new Response('{}', { status: 200 });
    throw new Error(String(u));
  };
  const env = { BILLING: memKV(), RESEND_API_KEY: 'k', OWNER_EMAILS: 'boss@x.com', BILLING_MODE: 'live' };
  const send = (body) => handleSupport(new Request('https://app.costnote.co.kr/api/support', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify(body) }), env, { fetchImpl, now: NOW });
  return { mails, send };
}
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

describe('문의하기', () => {
  it('운영자에게 정리된 형식 + 캡처 첨부 + 답장은 회원에게, 회원에게 접수 메일', async () => {
    const { mails, send } = setup();
    const r = await send({ kind: 'bug', text: '영수증을 찍었는데 인식에 실패했어요. 세 번 해도 같아요.', images: ['/9j/4AAQSkZJRg=='], meta: { device: iphone, standalone: true, screen: '390×844', version: 'index-AbC123', tab: '매입 탭' } });
    expect(r.status).toBe(200);
    expect(mails).toHaveLength(2);
    const [toOwner, ack] = mails;
    expect(toOwner.to).toEqual(['boss@x.com']);
    expect(toOwner.reply_to).toBe('guest@b.c');
    expect(toOwner.subject).toContain('[코스트노트 문의] 🐞 잘 안 돼요');
    expect(toOwner.text).toContain('■ 기기: iPhone · iOS 18.1 · 홈 화면 앱 · 화면 390×844');
    expect(toOwner.text).toContain('■ 회원: guest@b.c (가입 2026-11-12, 무료 체험)');
    expect(toOwner.text).toContain('■ 보낸 시각: 2026-11-13 15:40 (한국)');
    expect(toOwner.attachments).toEqual([{ filename: 'capture1.jpg', content: '/9j/4AAQSkZJRg==' }]);
    expect(ack.to).toEqual(['guest@b.c']);
    expect(ack.subject).toContain('문의를 받았어요');
  });
  it('너무 짧으면·사진이 이상하면 거절, 하루 5번까지', async () => {
    const { send } = setup();
    expect((await send({ kind: 'etc', text: '짧아요' })).status).toBe(400);
    expect((await (await send({ kind: 'etc', text: '사진 첨부 시험입니다 열 글자', images: ['<script>'] })).json()).error.code).toBe('bad_image');
    for (let i = 0; i < 5; i++) expect((await send({ kind: 'idea', text: '이런 기능이 있으면 좋겠어요 ' + i })).status).toBe(200);
    expect((await send({ kind: 'idea', text: '여섯 번째 문의입니다 열 글자' })).status).toBe(429);
  });
  it('기기 이름', () => {
    expect(deviceLabel(iphone)).toBe('iPhone · iOS 18.1');
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14; SM-S918N)')).toBe('Android 14 · SM-S918N');
  });
});
