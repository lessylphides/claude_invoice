// 클로드가 바꾼 기록 (서버 저장소에 사장님별로 최근 50건) + 앱에서 되돌리기
// GET /api/ai-changes        → 기록 목록 (앱 로그인 필요)
// POST /api/ai-changes/undo  → {id} 하나 되돌리기 (장부를 서버에서 고침 → 앱이 새 장부를 받아 감)
// GET /api/claude/grants     → 연결된 클로드 목록
// POST /api/claude/revoke    → {id} 연결 하나 끊기, {all: true} 모두 끊기 (탈퇴할 때도)
import { json, fail, authUser } from '../common.js';
import { db } from '../billing.js';
import { updateLedger, LedgerError } from './ledger.js';
import { undoChange } from './tools.js';

const KEY = (uid) => `ai:${uid}`;
const MAX = 50;

export async function readChanges(env, uid) {
  return (await db(env)?.get(KEY(uid))) || [];
}

/** 새 기록을 앞에 붙임 (저장소에서 한 번에: 동시에 와도 빠지지 않음) */
export async function logChanges(env, uid, changes, tool) {
  if (!changes?.length) return;
  const items = changes.map((c) => ({ ...c, tool }));
  if (env.BILLING_DO) return env.BILLING_DO.get(env.BILLING_DO.idFromName('billing')).prepend(KEY(uid), items, MAX);
  const d = db(env);
  if (!d) return;
  await d.put(KEY(uid), [...items, ...((await d.get(KEY(uid))) || [])].slice(0, MAX));
}

/** 연결된 클로드 (OAuth 승인) 목록 */
async function grantsOf(env, uid) {
  const out = [];
  let cursor;
  do {
    const r = await env.OAUTH_PROVIDER.listUserGrants(uid, cursor ? { cursor } : {});
    out.push(...r.items);
    cursor = r.cursor;
  } while (cursor);
  return out;
}

/** 모든 연결 끊기 (탈퇴 등) */
export async function revokeAll(env, uid) {
  if (!env.OAUTH_PROVIDER) return 0;
  const gs = await grantsOf(env, uid);
  await Promise.all(gs.map((g) => env.OAUTH_PROVIDER.revokeGrant(g.id, uid)));
  return gs.length;
}

export async function handleAiChanges(request, env, { fetchImpl = fetch } = {}) {
  const a = await authUser(request, fetchImpl);
  if (a.error) return a.error;
  const uid = a.user.id;
  if (!db(env)) return fail(503, 'not_configured', '아직 준비되지 않았어요.');
  const path = new URL(request.url).pathname;

  if (path === '/api/ai-changes' && request.method === 'GET') return json(200, { changes: await readChanges(env, uid) });

  if (path === '/api/claude/grants' && request.method === 'GET') {
    if (!env.OAUTH_PROVIDER) return json(200, { grants: [] });
    const gs = await grantsOf(env, uid);
    return json(200, { grants: gs.map((g) => ({ id: g.id, createdAt: g.createdAt, expiresAt: g.expiresAt ?? null, client: g.metadata?.client ?? null })) });
  }
  if (path === '/api/claude/revoke' && request.method === 'POST') {
    const { id, all } = await request.json().catch(() => ({}));
    if (all) return json(200, { revoked: await revokeAll(env, uid) });
    if (!id || !env.OAUTH_PROVIDER) return fail(400, 'bad_input', '끊을 연결을 골라 주세요.');
    const mine = (await grantsOf(env, uid)).some((g) => g.id === id);
    if (!mine) return fail(404, 'not_found', '연결을 찾지 못했어요.');
    await env.OAUTH_PROVIDER.revokeGrant(id, uid);
    return json(200, { revoked: 1 });
  }

  if (path === '/api/ai-changes/undo' && request.method === 'POST') {
    const { id } = await request.json().catch(() => ({}));
    const list = await readChanges(env, uid);
    const ch = list.find((c) => c.id === id);
    if (!ch) return fail(404, 'not_found', '기록을 찾지 못했어요.');
    if (ch.undoneAt) return fail(409, 'already', '이미 되돌린 기록이에요.');
    try {
      const { result } = await updateLedger(env, uid, (data) => {
        const r = undoChange(data, ch);
        if (!r.ok) throw new LedgerError('cannot_undo', r.message);
        return r;
      }, fetchImpl);
      ch.undoneAt = Date.now();
      await db(env).put(KEY(uid), list);
      return json(200, { ok: true, message: result.message, changes: list });
    } catch (e) {
      if (e instanceof LedgerError) return fail(e.code === 'cannot_undo' ? 409 : 503, e.code, e.message);
      throw e;
    }
  }
  return fail(404, 'not_found', '없는 요청이에요.');
}
