// 서버: 레벨업 선물 (/api/level, /api/level/claim)
// 앱이 "레벨이 올랐다"고 알려 오면, 서버가 서버에 저장된 장부로 레벨을 다시 계산해 선물(추가 인식)을 줌
// - 같은 레벨 선물은 한 번만, 하루에 최대 DAILY_GIFT_CAP 장까지 (백업 불러오기 등으로 한꺼번에 오른 경우 다음 날 이어서)
// - 선물은 서버 저장소(Durable Object)에만 기록, 영수증 인식 한도를 다 쓴 뒤에 1장씩 씀
import { computeLevel, rewardFor, levelName } from '../lib/levels.js';
import { json, fail, authUser } from './common.js';
import { db, kstDate } from './billing.js';

export const DAILY_GIFT_CAP = 10;
const key = (uid) => `lvl:${uid}`;
export const emptyLevelRec = () => ({ rewarded: 1, balance: 0, granted: 0, day: null, dayGranted: 0, history: [] });

/**
 * 선물 계산 (순수 함수: 저장소 안에서 그대로 실행). 레벨을 하나씩 올리며 하루 한도 안에서만 줌
 * @returns {{rec, gifts: Array<{level, amount}>}}
 */
export function applyClaim(rec, level, today, now) {
  const r = { ...emptyLevelRec(), ...(rec || {}) };
  if (r.day !== today) Object.assign(r, { day: today, dayGranted: 0 });
  const gifts = [];
  while (r.rewarded < level) {
    const n = r.rewarded + 1;
    const amount = rewardFor(n);
    if (r.dayGranted + amount > DAILY_GIFT_CAP && r.dayGranted > 0) break; // 오늘 몫을 넘으면 내일
    r.rewarded = n;
    if (!amount) continue; // 선물 없는 레벨
    r.balance += amount;
    r.granted += amount;
    r.dayGranted += amount;
    gifts.push({ level: n, amount });
    r.history = [{ level: n, amount, at: now }, ...r.history].slice(0, 30);
  }
  return { rec: r, gifts };
}

/** 선물 1장 쓰기 (남아 있을 때만). 썼으면 true */
export function applyUse(rec) {
  const r = { ...emptyLevelRec(), ...(rec || {}) };
  if (r.balance <= 0) return { rec: r, used: false };
  r.balance -= 1;
  return { rec: r, used: true };
}

const stub = (env) => env.BILLING_DO.get(env.BILLING_DO.idFromName('billing'));

export async function getLevelRec(env, uid) {
  const d = db(env);
  if (!d || !uid) return emptyLevelRec();
  return { ...emptyLevelRec(), ...((await d.get(key(uid))) || {}) };
}

/** 영수증 인식에서 선물 1장 쓰기 */
export async function useGift(env, uid) {
  if (env.BILLING_DO) return stub(env).useLevelGift(key(uid));
  const d = db(env);
  if (!d) return false;
  const { rec, used } = applyUse(await d.get(key(uid)));
  if (used) await d.put(key(uid), rec);
  return used;
}

async function claim(env, uid, level, now) {
  const today = kstDate(now);
  if (env.BILLING_DO) return stub(env).claimLevel(key(uid), level, today, now);
  const d = db(env);
  const out = applyClaim(await d.get(key(uid)), level, today, now);
  if (out.gifts.length) await d.put(key(uid), out.rec);
  return out;
}

const view = (rec, lv) => ({
  rewarded: rec.rewarded,
  balance: rec.balance,
  granted: rec.granted,
  history: rec.history,
  ...(lv ? { level: lv.level, name: lv.name, points: lv.points } : {}),
});

/** GET /api/level — 받은 선물 · POST /api/level/claim — 서버 장부로 레벨 확인 후 선물 */
export async function handleLevel(request, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const a = await authUser(request, fetchImpl);
  if (a.error) return a.error;
  const { user, sb } = a;
  if (!db(env)) return fail(503, 'not_configured', '레벨 선물 기능이 아직 준비되지 않았어요.');
  const path = new URL(request.url).pathname;

  if (path === '/api/level' && request.method === 'GET') return json(200, view(await getLevelRec(env, user.id)));
  if (path !== '/api/level/claim' || request.method !== 'POST') return fail(404, 'not_found', '없는 요청이에요.');

  // 서버에 저장된 장부로 다시 계산 (앱이 알려 준 숫자는 믿지 않음)
  const r = await sb(`/rest/v1/ledgers?select=data&user_id=eq.${encodeURIComponent(user.id)}`);
  if (!r.ok) return fail(503, 'ledger', '장부를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
  const row = (await r.json().catch(() => []))[0];
  const lv = computeLevel(row?.data || {}, now);
  const { rec, gifts } = await claim(env, user.id, lv.level, now);
  return json(200, { ...view(rec, lv), gifts, giftNames: gifts.map((g) => levelName(g.level)) });
}
