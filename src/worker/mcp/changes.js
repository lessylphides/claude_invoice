// 클로드가 바꾼 기록 (서버 저장소에 사장님별로 최근 50건) + 앱에서 되돌리기
// GET /api/ai-changes        → 기록 목록 (앱 로그인 필요)
// POST /api/ai-changes/undo  → {id} 하나 되돌리기 (장부를 서버에서 고침 → 앱이 새 장부를 받아 감)
import { json, fail, authUser } from '../common.js';
import { db } from '../billing.js';
import { updateLedger, LedgerError } from './ledger.js';
import { undoChange } from './tools.js';

const KEY = (uid) => `ai:${uid}`;
const MAX = 50;

export async function readChanges(env, uid) {
  return (await db(env)?.get(KEY(uid))) || [];
}

/** 새 기록을 앞에 붙임 */
export async function logChanges(env, uid, changes, tool) {
  if (!changes?.length) return;
  const d = db(env);
  if (!d) return;
  const list = [...changes.map((c) => ({ ...c, tool })), ...((await d.get(KEY(uid))) || [])].slice(0, MAX);
  await d.put(KEY(uid), list);
}

export async function handleAiChanges(request, env, { fetchImpl = fetch } = {}) {
  const a = await authUser(request, fetchImpl);
  if (a.error) return a.error;
  const uid = a.user.id;
  if (!db(env)) return fail(503, 'not_configured', '아직 준비되지 않았어요.');
  const path = new URL(request.url).pathname;

  if (path === '/api/ai-changes' && request.method === 'GET') return json(200, { changes: await readChanges(env, uid) });

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
