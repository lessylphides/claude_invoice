// 공지사항: GET /api/notices (누구나), POST /api/admin/notices (운영자만: 쓰기·고치기·지우기)
// 서버 저장소(Durable Object)의 'notices' 한 곳에 최신순 목록으로 보관
import { json, fail, authUser } from './common.js';
import { db, isOwner } from './billing.js';
import { NOTICE_KINDS, NOTICE_MAX, cleanNotice } from '../lib/notices.js';

const KEY = 'notices';

export async function listNotices(env) {
  const d = db(env);
  return ((d && (await d.get(KEY))) || []).slice().sort((a, b) => b.at - a.at);
}

export async function handleNotices(request, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const url = new URL(request.url);
  if (url.pathname === '/api/notices') {
    if (request.method !== 'GET') return fail(405, 'method', 'GET 만 받습니다.');
    const notices = await listNotices(env);
    return new Response(JSON.stringify({ notices }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }
  // 운영자: 쓰기·고치기·지우기
  if (request.method !== 'POST') return fail(405, 'method', 'POST 만 받습니다.');
  const a = await authUser(request, fetchImpl);
  if (a.error) return a.error;
  if (!isOwner(env, a.user.email)) return fail(403, 'forbidden', '운영자만 쓸 수 있어요.');
  const d = db(env);
  if (!d) return fail(503, 'not_configured', '서버 저장소가 없어요.');
  const body = await request.json().catch(() => ({}));
  let list = await listNotices(env);
  if (body.action === 'delete') {
    list = list.filter((n) => n.id !== body.id);
  } else if (body.action === 'save') {
    const n = cleanNotice(body.notice);
    if (!n.title) return fail(400, 'no_title', '제목을 적어 주세요.');
    if (!NOTICE_KINDS[n.kind]) return fail(400, 'bad_kind', '종류를 골라 주세요.');
    const old = body.notice?.id ? list.find((x) => x.id === body.notice.id) : null;
    if (old) Object.assign(old, n, { updatedAt: now });
    else list.unshift({ id: `n${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: now, ...n });
    list = list.sort((x, y) => y.at - x.at).slice(0, NOTICE_MAX);
  } else return fail(400, 'bad_action', '알 수 없는 요청이에요.');
  await d.put(KEY, list);
  return json(200, { notices: list });
}
