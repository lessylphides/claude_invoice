// 클로드 연결: 사장님 장부 한 줄 읽기·쓰기 (Supabase 함수 mcp_ledger_get / mcp_ledger_put, supabase/mcp.sql)
// 쓰기는 앱과 같은 규칙: 마지막으로 읽은 번호(rev)일 때만 덮어씀. 그 사이 앱에서 바뀌었으면 다시 읽어서 한 번 더 시도
import { SUPABASE_URL, SUPABASE_KEY } from '../../config.js';
import { migrate } from '../../lib/model.js';

export class LedgerError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function rpc(env, fetchImpl, name, body) {
  if (!env.BACKUP_SECRET) throw new LedgerError('not_configured', '코스트노트 서버 설정이 아직 끝나지 않았어요.');
  const res = await fetchImpl(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ secret: env.BACKUP_SECRET, ...body }),
  });
  const text = await res.text();
  if (!res.ok) {
    if (/suspended/.test(text)) throw new LedgerError('suspended', '이용이 정지된 계정이에요.');
    console.error('[mcp] rpc', name, res.status, text.slice(0, 200));
    throw new LedgerError('server', '장부를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  return text ? JSON.parse(text) : null;
}

/** @returns {Promise<{rev: number, data: object}>} 장부가 없으면 빈 장부(rev 0) */
export async function readLedger(env, uid, fetchImpl = fetch) {
  const row = await rpc(env, fetchImpl, 'mcp_ledger_get', { uid });
  if (!row) return { rev: 0, data: migrate(null) };
  return { rev: Number(row.rev) || 0, data: migrate(row.data, { trusted: true }) };
}

/**
 * 장부를 고침: change(data) 가 data 를 직접 바꾸고 결과를 돌려줌. 그 사이 다른 곳에서 바뀌면 다시 읽어서 최대 3번
 * @param {(data: object) => any} change 바꿀 게 없거나 할 수 없으면 LedgerError 를 던짐
 */
export async function updateLedger(env, uid, change, fetchImpl = fetch) {
  for (let i = 0; i < 3; i++) {
    const { rev, data } = await readLedger(env, uid, fetchImpl);
    if (!rev) throw new LedgerError('empty', '아직 서버에 저장된 장부가 없어요. 코스트노트 앱에서 로그인해 장부를 한 번 저장해 주세요.');
    const result = await change(data);
    const next = await rpc(env, fetchImpl, 'mcp_ledger_put', { uid, payload: data, expected: rev });
    if (next != null) return { rev: Number(next), result };
  }
  throw new LedgerError('busy', '앱에서 장부를 저장하는 중이라 반영하지 못했어요. 잠시 후 다시 시도해 주세요.');
}
