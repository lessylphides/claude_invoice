// 서버 운영 통계: 영수증 인식마다 실제 AI 비용을 기록하고, 운영자 화면(/api/admin)에 모아 보여 줌
// 기록은 서버 저장소(Durable Object)에만 남고, 사진·인식 내용은 기록하지 않음 (횟수·토큰·비용만)
import { db, billingMode, kstDate, isOwner, refundPayment } from './billing.js';
import { sendMail, refundMail } from './mail.js';
import { PLANS } from '../lib/plans.js';
import { ACC_FIELDS } from '../lib/ocrAccuracy.js';
import { json, fail, authUser } from './common.js';
import { listBackups, readBackup, runBackup } from './backup.js';

/** 모델별 가격 (미국 달러, 100만 토큰당 입력/출력) — Anthropic 공식 가격표 */
const PRICES = {
  'claude-opus-5-5': [4, 20],
  'claude-opus-5': [5, 25],
  'claude-opus-4-8': [5, 25],
  'claude-sonnet-5-5': [2, 10],
  'claude-sonnet-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-fable-5-1': [10, 50],
};

/** 응답 사용량(usage)으로 이번 호출 비용(달러) 계산. 캐시 쓰기 1.25배, 캐시 읽기 0.1배 */
export function costUsd(model, usage = {}) {
  const [inP, outP] = PRICES[model] ?? PRICES['claude-opus-5-5'];
  const input = usage.input_tokens ?? 0;
  const cw = usage.cache_creation_input_tokens ?? 0;
  const cr = usage.cache_read_input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  return (input * inP + cw * inP * 1.25 + cr * inP * 0.1 + output * outP) / 1e6;
}

/** 통계 한 건을 더함 (Durable Object 안에서 순서대로 처리되어 동시에 와도 빠지지 않음) */
export function applyOcrStat(day, month, s) {
  day.count += s.ok ? 1 : 0;
  day.failed += s.ok ? 0 : 1;
  day.input += s.input;
  day.output += s.output;
  day.cost += s.cost;
  day.models[s.model] = (day.models[s.model] || 0) + 1;
  if (s.ok) month.users[s.uid] = (month.users[s.uid] || 0) + 1;
  month.count += s.ok ? 1 : 0;
  month.cost += s.cost;
}
export const emptyDay = () => ({ count: 0, failed: 0, input: 0, output: 0, cost: 0, models: {} });
export const emptyMonth = () => ({ count: 0, cost: 0, users: {} });

/**
 * 인식 한 번(성공이든 실패든 Claude 를 부른 경우)을 기록. 실패해도 인식 결과에는 영향 없음
 * @param {{uid: string, model: string, usage: object, ok: boolean, now?: number}} s
 */
export async function recordOcrStat(env, { uid, model, usage, ok, now = Date.now() }) {
  const d = db(env);
  if (!d) return;
  const date = kstDate(now);
  const stat = {
    uid,
    model: model || 'unknown',
    ok,
    input: (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0),
    output: usage?.output_tokens ?? 0,
    cost: costUsd(model, usage),
  };
  if (env.BILLING_DO) {
    await env.BILLING_DO.get(env.BILLING_DO.idFromName('billing')).addOcrStat(date, date.slice(0, 7), stat);
    return;
  }
  // 테스트(메모리 저장소)용
  const dk = `stat:day:${date}`;
  const mk = `stat:month:${date.slice(0, 7)}`;
  const day = (await d.get(dk)) ?? emptyDay();
  const month = (await d.get(mk)) ?? emptyMonth();
  applyOcrStat(day, month, stat);
  await d.put(dk, day);
  await d.put(mk, month);
}

/** 정확도 통계 한 건 더하기: {모델: {receipts, untouched, ...}} */
export function applyAccStat(day, model, edits) {
  const m = (day[model] ||= Object.fromEntries(ACC_FIELDS.map((k) => [k, 0])));
  for (const k of ACC_FIELDS) m[k] += edits[k] || 0;
}

/** 받은 숫자 검사 (0~200 정수만, 그 밖은 버림) */
export function cleanEdits(body) {
  if (!body || typeof body !== 'object') return null;
  const out = {};
  for (const k of ACC_FIELDS) {
    const v = Number(body[k] ?? 0);
    if (!Number.isInteger(v) || v < 0 || v > 200) return null;
    out[k] = v;
  }
  return out.receipts === 1 ? out : null;
}

/** POST /api/ocr/feedback — 인식 결과를 얼마나 고쳤는지 (숫자만) */
export async function handleOcrFeedback(request, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (request.method !== 'POST') return fail(405, 'method', 'POST 만 받습니다.');
  const a = await authUser(request, fetchImpl);
  if (a.error) return a.error;
  const edits = cleanEdits(await request.json().catch(() => null));
  if (!edits) return fail(400, 'bad_request', '형식이 올바르지 않아요.');
  const model = env.OCR_MODEL || 'claude-opus-5-5';
  const date = kstDate(now);
  if (env.BILLING_DO) await env.BILLING_DO.get(env.BILLING_DO.idFromName('billing')).addAccStat(date, model, edits);
  else {
    const d = db(env);
    if (!d) return json(200, { ok: false });
    const k = `stat:acc:${date}`;
    const day = (await d.get(k)) ?? {};
    applyAccStat(day, model, edits);
    await d.put(k, day);
  }
  return json(200, { ok: true });
}

async function listAll(d, prefix) {
  const out = [];
  let after = null;
  do {
    const page = await d.list(prefix, after);
    out.push(...page.keys);
    after = page.next;
  } while (after);
  return out;
}

/** 이번 달 사용자별 인식 횟수를 구간으로 */
function distribution(users) {
  const counts = Object.values(users);
  const buckets = [
    ['1~20장', 1, 20],
    ['21~50장', 21, 50],
    ['51~120장', 51, 120],
    ['121~250장', 121, 250],
    ['251장 이상', 251, Infinity],
  ].map(([label, lo, hi]) => ({ label, users: counts.filter((c) => c >= lo && c <= hi).length }));
  const sorted = [...counts].sort((a, b) => a - b);
  return {
    users: counts.length,
    avg: counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : 0,
    median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
    max: sorted.at(-1) ?? 0,
    buckets,
  };
}

/** 운영자 화면 숫자 모으기 */
export async function adminStats(env, { now = Date.now(), fx = Number(env.USD_KRW) || 1450 } = {}) {
  const d = db(env);
  const today = kstDate(now);
  const month = today.slice(0, 7);
  const since30 = kstDate(now - 29 * 86400000);

  // 영수증 인식: 최근 30일 날짜별
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const date = kstDate(now - i * 86400000);
    days.push({ date, ...((d && (await d.get(`stat:day:${date}`))) || emptyDay()) });
  }
  const sum = (k) => days.reduce((a, x) => a + x[k], 0);
  const ok30 = sum('count');
  const cost30 = sum('cost');
  const models = {};
  for (const x of days) for (const [m, n] of Object.entries(x.models)) models[m] = (models[m] || 0) + n;
  const thisMonth = (d && (await d.get(`stat:month:${month}`))) || emptyMonth();

  // 인식 정확도: 최근 30일 모델별 합계
  const accuracy = {};
  for (const x of days) {
    const acc = (d && (await d.get(`stat:acc:${x.date}`))) || {};
    for (const [model, v] of Object.entries(acc)) applyAccStat(accuracy, model, v);
  }

  // 구독
  const subs = d ? await Promise.all((await listAll(d, 'sub:')).map((k) => d.get(k))) : [];
  const byPlan = Object.fromEntries(Object.keys(PLANS).map((id) => [id, 0]));
  let mrr = 0;
  let canceling = 0;
  let pastDue = 0;
  let paid30 = 0;
  const payments = [];
  for (const s of subs) {
    if (!s) continue;
    const live = (s.status === 'active' || s.status === 'past_due') && now < s.periodEnd + 3 * 86400000;
    if (live && PLANS[s.plan]) {
      byPlan[s.plan]++;
      if (!s.cancelAtPeriodEnd) mrr += PLANS[s.nextPlan || s.plan].price;
      if (s.cancelAtPeriodEnd) canceling++;
      if (s.status === 'past_due') pastDue++;
    }
    for (const p of s.payments || []) {
      if (p.at >= now - 30 * 86400000) paid30 += p.amount - (p.canceled || 0);
      payments.push({ uid: s.uid, email: s.email, amount: p.amount, canceled: p.canceled || 0, orderName: p.orderName, at: p.at, paymentKey: p.paymentKey ?? null, receipt: p.receipt ?? null, card: s.card ?? null, subStatus: s.status, mode: s.mode ?? 'test' });
    }
  }
  payments.sort((a, b) => b.at - a.at);

  return {
    mode: billingMode(env),
    fx,
    model: env.OCR_MODEL || 'claude-opus-5-5',
    ocr: {
      days: days.map(({ date, count, failed, cost }) => ({ date, count, failed, costKrw: Math.round(cost * fx) })),
      count30: ok30,
      failed30: sum('failed'),
      costKrw30: Math.round(cost30 * fx),
      perReceiptKrw: ok30 ? Math.round((cost30 * fx) / ok30) : null,
      avgInput: ok30 + sum('failed') ? Math.round(sum('input') / (ok30 + sum('failed'))) : null,
      avgOutput: ok30 + sum('failed') ? Math.round(sum('output') / (ok30 + sum('failed'))) : null,
      models,
      since: since30,
      month: { key: month, count: thisMonth.count, costKrw: Math.round(thisMonth.cost * fx), ...distribution(thisMonth.users) },
      accuracy,
    },
    billing: {
      paying: Object.values(byPlan).reduce((a, b) => a + b, 0),
      byPlan,
      mrr,
      canceling,
      pastDue,
      paid30,
      payments: payments.slice(0, 20),
    },
  };
}

/** 회원 목록 (Supabase 운영자 함수) + 요금제 정보(서버 저장소) */
async function adminUsers(env, sb, q, now) {
  const r = await sb('/rest/v1/rpc/admin_users', { method: 'POST', body: JSON.stringify({ q: String(q).slice(0, 100), lim: 50 }) });
  if (!r.ok) {
    console.error('[admin] admin_users', r.status, await r.text().catch(() => ''));
    return fail(502, 'admin_users', '회원 목록을 불러오지 못했어요. Supabase 에서 accounts.sql 을 실행했는지 확인해 주세요.');
  }
  const users = (await r.json()) ?? [];
  const d = db(env);
  for (const u of users) {
    const s = d ? await d.get(`sub:${u.id}`) : null;
    const live = s && (s.status === 'active' || s.status === 'past_due') && now < s.periodEnd + 3 * 86400000;
    u.plan = live ? { id: s.plan, name: PLANS[s.plan]?.name ?? s.plan, status: s.status, cancelAtPeriodEnd: !!s.cancelAtPeriodEnd, periodEnd: s.periodEnd } : null;
  }
  return json(200, { users });
}

/** 회원 한 명: 추가 인식 주기·정지/해제 */
async function adminSetAccount(sb, id, body) {
  const add = Math.trunc(Number(body.addBonus) || 0);
  if (Math.abs(add) > 10000) return fail(400, 'bad_request', '한 번에 10,000회까지만 줄 수 있어요.');
  const payload = { target: id, add_bonus: add, set_suspended: typeof body.suspended === 'boolean' ? body.suspended : null, reason: body.reason ? String(body.reason).slice(0, 200) : null };
  const r = await sb('/rest/v1/rpc/admin_set_account', { method: 'POST', body: JSON.stringify(payload) });
  if (!r.ok) {
    console.error('[admin] admin_set_account', r.status, await r.text().catch(() => ''));
    return fail(502, 'admin_set', '바꾸지 못했어요. Supabase 에서 accounts.sql 을 실행했는지 확인해 주세요.');
  }
  return json(200, { account: await r.json() });
}

/** GET /api/admin, /api/admin/backup?date=YYYY-MM-DD — 운영자(OWNER_EMAILS)만 */
export async function handleAdmin(request, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const url = new URL(request.url);
  const backupNow = url.pathname === '/api/admin/backup-now';
  const refund = url.pathname === '/api/admin/refund';
  const userAction = url.pathname.match(/^\/api\/admin\/users\/([0-9a-f-]{36})$/);
  const wantPost = backupNow || refund || !!userAction;
  if (request.method !== (wantPost ? 'POST' : 'GET')) return fail(405, 'method', '허용되지 않은 요청이에요.');
  const a = await authUser(request, fetchImpl);
  if (a.error) return a.error;
  if (!isOwner(env, a.user.email)) return fail(403, 'forbidden', '운영자만 볼 수 있어요.');
  if (url.pathname === '/api/admin/users') return adminUsers(env, a.sb, url.searchParams.get('q') || '', now);
  if (userAction) return adminSetAccount(a.sb, userAction[1], await request.json().catch(() => ({})));
  if (refund) {
    const body = await request.json().catch(() => ({}));
    const r = await refundPayment(env, body, { fetchImpl, now });
    if (!r.ok) return fail(r.status, 'refund_failed', r.message);
    // 손님에게 환불 안내 메일 (못 보내도 환불은 끝난 것)
    if (r.email) await sendMail(env, fetchImpl, { to: r.email, ...refundMail({ orderName: r.orderName, refunded: r.amount, total: r.total, ended: r.ended }) }).catch(() => {});
    return json(200, r);
  }
  if (backupNow) {
    const r = await runBackup(env, { fetchImpl, now }).catch((e) => ({ ok: false, error: String(e) }));
    if (r.skipped) return fail(503, 'not_configured', '백업 비밀 값(BACKUP_SECRET)이 서버에 없어요.');
    if (!r.ok) return fail(502, 'backup_failed', `백업하지 못했어요 (${r.status ?? r.error}). Supabase 의 backup.sql 실행과 Cloudflare 의 BACKUP_SECRET 값이 같은지 확인해 주세요.`);
    return json(200, r);
  }
  if (url.pathname === '/api/admin/backup') {
    const date = url.searchParams.get('date') || '';
    const data = await readBackup(env, date).catch((e) => (console.error('[admin] backup', String(e)), null));
    if (!data) return fail(404, 'not_found', '그 날짜의 백업이 없어요.');
    return new Response(JSON.stringify(data), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="costnote-backup-${date}.json"`,
        'cache-control': 'no-store',
      },
    });
  }
  // 가입자 수는 Supabase 의 운영자 전용 함수(admin_stats)로 (서버에 관리자 키를 두지 않음)
  let users = null;
  const r = await a.sb('/rest/v1/rpc/admin_stats', { method: 'POST', body: '{}' }).catch(() => null);
  if (r?.ok) users = await r.json().catch(() => null);
  else console.error('[admin] admin_stats', r?.status);
  const backups = await listBackups(env).catch(() => []);
  return json(200, { ...(await adminStats(env, { now })), users, backups });
}
