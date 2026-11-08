// 서버: 요금제 구독 (/api/billing...) + 매일 정기결제 (scheduled)
//
// - 카드 등록은 토스페이먼츠 결제창에서 → 앱이 받은 authKey 로 서버가 빌링키를 발급받아 저장
// - 빌링키·결제 내역은 Cloudflare KV(BILLING)에만 저장 (휴대폰·Supabase 에는 두지 않음)
// - 토스 시크릿 키는 Cloudflare 비밀 값 TOSS_SECRET_KEY 에만 있음
// - BILLING_MODE: off(결제 기능 숨김) | test(시험 결제, 구독자만 요금제 한도) | live(실제 결제, 무료 체험·요금제 한도)
import { PLANS, TRIAL, planOf, addMonth } from '../lib/plans.js';
import { json, fail, authUser, usageNow } from './common.js';

const TOSS_API = 'https://api.tosspayments.com/v1';
const GRACE_MS = 3 * 24 * 60 * 60 * 1000; // 결제 실패 뒤 요금제를 계속 쓸 수 있는 기간
const MAX_FAILS = 3; // 매일 다시 시도, 3번 실패하면 구독 종료
const KEEP_PAYMENTS = 24;

export const billingMode = (env) => (env.BILLING_MODE === 'live' || env.BILLING_MODE === 'test' ? env.BILLING_MODE : 'off');
export const customerKeyFor = (uid) => `cn_${uid}`;
const subKey = (uid) => `sub:${uid}`;

/** 한국 날짜 'YYYY-MM-DD' */
export const kstDate = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);

const isOwner = (env, email) =>
  !!email &&
  String(env.OWNER_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());

export async function getSub(env, uid) {
  if (!env.BILLING || !uid) return null;
  return (await env.BILLING.get(subKey(uid), 'json')) ?? null;
}
const putSub = (env, sub) => env.BILLING.put(subKey(sub.uid), JSON.stringify(sub));

/** 지금 요금제를 쓸 수 있는 구독인지 */
function liveSub(sub, now) {
  if (!sub || !planOf(sub.plan)) return false;
  if (sub.status === 'active') return now < sub.periodEnd;
  if (sub.status === 'past_due') return now < sub.periodEnd + GRACE_MS;
  return false;
}

/**
 * 이 사용자의 영수증 인식 한도
 * @returns {{kind: 'plan'|'trial'|'owner'|'legacy', plan?: string, day: number, month: number|null, total?: number, since?: string}}
 */
export function entitlement(env, user, sub, now = Date.now()) {
  if (liveSub(sub, now)) {
    const p = PLANS[sub.plan];
    return { kind: 'plan', plan: p.id, day: p.day, month: p.month, since: kstDate(sub.periodStart) };
  }
  if (billingMode(env) !== 'live' || isOwner(env, user.email))
    // 결제 시작 전(또는 운영자): 예전처럼 계정별 하루·한 달(달력 기준) 한도
    return { kind: billingMode(env) === 'live' ? 'owner' : 'legacy', day: Number(env.OCR_DAILY_LIMIT) || 30, month: Number(env.OCR_MONTHLY_LIMIT) || 300 };
  return { kind: 'trial', day: TRIAL.day, month: null, total: TRIAL.total };
}

/** 한도를 넘었으면 {code, message} */
export function overLimit(ent, usage) {
  if (ent.kind === 'trial' && usage.total >= ent.total)
    return {
      code: 'trial_used',
      message: `무료 체험 ${ent.total}장을 다 썼어요. ⚙ 설정 → 요금제에서 구독하면 계속 쓸 수 있어요. 직접 입력은 계속 쓸 수 있어요.`,
    };
  if (usage.day >= ent.day)
    return { code: 'daily_limit', message: `오늘 영수증 인식(${ent.day}회)을 다 썼어요. 내일 다시 쓸 수 있어요. 지금은 직접 입력해 주세요.` };
  const used = ent.kind === 'plan' ? usage.period : usage.month;
  if (ent.month != null && used >= ent.month)
    return ent.kind === 'plan'
      ? {
          code: 'monthly_limit',
          message: `이번 결제 기간의 영수증 인식(${ent.month}회)을 다 썼어요. ⚙ 설정 → 요금제에서 더 높은 요금제로 바꾸면 바로 더 쓸 수 있어요. 직접 입력은 계속 쓸 수 있어요.`,
        }
      : { code: 'monthly_limit', message: `이번 달 영수증 인식(${ent.month}회)을 다 썼어요. 지금은 직접 입력해 주세요.` };
  return null;
}

// ── 토스페이먼츠 API ──────────────────────────────────────────

async function toss(env, fetchImpl, path, body, idempotencyKey) {
  const headers = {
    authorization: `Basic ${btoa(`${env.TOSS_SECRET_KEY}:`)}`,
    'content-type': 'application/json',
  };
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  let res;
  try {
    res = await fetchImpl(`${TOSS_API}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (e) {
    console.error('[billing] toss network', path, String(e));
    return { ok: false, status: 0, data: { code: 'NETWORK', message: '결제 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.' } };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) console.error('[billing] toss', path, res.status, data?.code, data?.message);
  return { ok: res.ok, status: res.status, data };
}

const newOrderId = (now) => `cn-${now.toString(36)}-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;

/** 빌링키로 결제. 성공하면 {ok, payment}, 실패하면 {ok:false, code, message} */
async function charge(env, fetchImpl, sub, { amount, orderName, kind }, now) {
  const orderId = newOrderId(now);
  const r = await toss(
    env,
    fetchImpl,
    `/billing/${encodeURIComponent(sub.billingKey)}`,
    { customerKey: sub.customerKey, amount, orderId, orderName, customerEmail: sub.email || undefined },
    orderId,
  );
  if (r.ok && r.data?.status === 'DONE')
    return {
      ok: true,
      payment: { orderId, paymentKey: r.data.paymentKey, amount, orderName, kind, at: now, receipt: r.data.receipt?.url ?? null },
    };
  return { ok: false, code: r.data?.code || 'CHARGE_FAILED', message: r.data?.message || '결제에 실패했어요.' };
}

const addPayment = (sub, payment) => {
  sub.payments = [payment, ...(sub.payments || [])].slice(0, KEEP_PAYMENTS);
};

// ── 앱에 보여 줄 상태 ─────────────────────────────────────────

function publicSub(sub, now) {
  if (!sub) return null;
  return {
    plan: sub.plan,
    status: liveSub(sub, now) ? sub.status : sub.status === 'closed' ? 'closed' : 'ended',
    periodStart: sub.periodStart,
    periodEnd: sub.periodEnd,
    cancelAtPeriodEnd: !!sub.cancelAtPeriodEnd,
    nextPlan: sub.nextPlan ?? null,
    card: sub.card ?? null,
    lastError: sub.status === 'past_due' ? sub.lastError ?? null : null,
    payments: (sub.payments || []).slice(0, 6).map(({ amount, orderName, at, receipt }) => ({ amount, orderName, at, receipt })),
  };
}

async function statusBody(env, user, sb, sub, now) {
  const ent = entitlement(env, user, sub, now);
  const usage = await usageNow(sb, ent.since ?? null);
  return {
    mode: billingMode(env),
    customerKey: customerKeyFor(user.id),
    subscription: publicSub(sub, now),
    entitlement: ent,
    usage,
  };
}

// ── /api/billing 요청 처리 ────────────────────────────────────

/**
 * @param {Request} request
 * @param {object} env  BILLING(KV), TOSS_SECRET_KEY, BILLING_MODE, OWNER_EMAILS, OCR_DAILY_LIMIT, OCR_MONTHLY_LIMIT
 * @param {{fetchImpl?: typeof fetch, now?: number}} deps
 */
export async function handleBilling(request, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const url = new URL(request.url);
  const action = url.pathname.replace(/^\/api\/billing\/?/, '') || 'status';

  const a = await authUser(request, fetchImpl);
  if (a.error) return a.error;
  const { user, sb } = a;
  if (!user.id) return fail(401, 'login', '로그인이 만료됐어요. 다시 로그인해 주세요.');
  if (!env.BILLING) return fail(503, 'not_configured', '결제 기능이 아직 준비되지 않았어요.');

  let sub = await getSub(env, user.id);
  const ok = async () => json(200, await statusBody(env, user, sb, sub, now));

  if (action === 'status') {
    if (request.method !== 'GET') return fail(405, 'method', 'GET 만 받습니다.');
    return ok();
  }
  if (request.method !== 'POST') return fail(405, 'method', 'POST 만 받습니다.');
  let body = {};
  try {
    body = await request.json();
  } catch {}

  // 탈퇴 직전: 구독을 끝내고 빌링키를 지움 (결제 내역은 법정 보관을 위해 남김)
  if (action === 'close') {
    if (sub) {
      sub = { ...sub, status: 'closed', billingKey: null, cancelAtPeriodEnd: true, nextPlan: null, closedAt: now };
      await putSub(env, sub);
    }
    return json(200, { closed: true });
  }

  if (billingMode(env) === 'off') return fail(503, 'billing_off', '결제 기능은 준비 중이에요.');
  if (!env.TOSS_SECRET_KEY) return fail(503, 'not_configured', '결제 서버 설정이 아직 끝나지 않았어요. (관리자: 토스 시크릿 키 확인)');

  const active = liveSub(sub, now);

  if (action === 'subscribe') {
    // 결제창에서 카드 등록을 마치고 돌아온 경우: authKey → 빌링키 발급 → (새 구독이면) 첫 결제
    const plan = planOf(body.plan);
    if (!active && !plan) return fail(400, 'bad_plan', '요금제를 다시 골라 주세요.');
    if (typeof body.authKey !== 'string' || !body.authKey) return fail(400, 'bad_request', '카드 등록 정보가 없어요. 다시 시도해 주세요.');
    if (body.customerKey !== customerKeyFor(user.id)) return fail(400, 'bad_request', '카드 등록 정보가 이 계정과 맞지 않아요. 다시 시도해 주세요.');

    const issued = await toss(env, fetchImpl, '/billing/authorizations/issue', { authKey: body.authKey, customerKey: body.customerKey });
    if (!issued.ok || !issued.data?.billingKey)
      return fail(402, 'card_failed', `카드를 등록하지 못했어요. ${issued.data?.message || '다시 시도해 주세요.'}`);
    const card = {
      company: issued.data.cardCompany ?? issued.data.card?.issuerCode ?? null,
      number: issued.data.cardNumber ?? issued.data.card?.number ?? null,
    };

    if (active) {
      // 이미 구독 중이면 카드만 바꿈. 결제가 밀려 있으면 바로 다시 결제
      sub = { ...sub, billingKey: issued.data.billingKey, card, email: user.email };
      if (sub.status === 'past_due') {
        const p = PLANS[sub.nextPlan || sub.plan];
        const r = await charge(env, fetchImpl, sub, { amount: p.price, orderName: `코스트노트 ${p.name} 요금제 (1개월)`, kind: 'renew' }, now);
        if (r.ok) {
          addPayment(sub, r.payment);
          Object.assign(sub, { plan: p.id, nextPlan: null, status: 'active', periodStart: now, periodEnd: addMonth(now), failCount: 0, lastError: null });
        } else {
          sub.lastError = r.message;
        }
      }
      await putSub(env, sub);
      return ok();
    }

    const fresh = {
      uid: user.id,
      email: user.email,
      customerKey: body.customerKey,
      billingKey: issued.data.billingKey,
      card,
      plan: plan.id,
      payments: sub?.payments ?? [],
      createdAt: sub?.createdAt ?? now,
    };
    const r = await charge(env, fetchImpl, fresh, { amount: plan.price, orderName: `코스트노트 ${plan.name} 요금제 (1개월)`, kind: 'new' }, now);
    if (!r.ok) return fail(402, 'charge_failed', `결제하지 못했어요. ${r.message}`);
    addPayment(fresh, r.payment);
    sub = { ...fresh, status: 'active', periodStart: now, periodEnd: addMonth(now), cancelAtPeriodEnd: false, nextPlan: null, failCount: 0, lastError: null };
    await putSub(env, sub);
    return ok();
  }

  if (!active) return fail(409, 'no_subscription', '구독 중인 요금제가 없어요.');

  if (action === 'change') {
    const target = planOf(body.plan);
    if (!target) return fail(400, 'bad_plan', '요금제를 다시 골라 주세요.');
    const cur = PLANS[sub.plan];
    if (target.id === cur.id) {
      sub = { ...sub, nextPlan: null, cancelAtPeriodEnd: false };
    } else if (target.price > cur.price) {
      // 올리기: 바로 적용, 이번 기간은 차액만 결제 (결제일 그대로)
      if (sub.status !== 'active') return fail(409, 'past_due', '지난 결제가 밀려 있어요. 카드를 다시 등록해 주세요.');
      const r = await charge(
        env,
        fetchImpl,
        sub,
        { amount: target.price - cur.price, orderName: `코스트노트 ${cur.name}→${target.name} 요금제 변경 차액`, kind: 'upgrade' },
        now,
      );
      if (!r.ok) return fail(402, 'charge_failed', `결제하지 못했어요. ${r.message}`);
      sub = { ...sub, plan: target.id, nextPlan: null, cancelAtPeriodEnd: false };
      addPayment(sub, r.payment);
    } else {
      // 내리기: 다음 결제일부터
      sub = { ...sub, nextPlan: target.id, cancelAtPeriodEnd: false };
    }
    await putSub(env, sub);
    return ok();
  }

  if (action === 'cancel') {
    sub = { ...sub, cancelAtPeriodEnd: true, nextPlan: null };
    await putSub(env, sub);
    return ok();
  }
  if (action === 'resume') {
    sub = { ...sub, cancelAtPeriodEnd: false };
    await putSub(env, sub);
    return ok();
  }
  return fail(404, 'not_found', '없는 요청이에요.');
}

// ── 매일 정기결제 (Cloudflare Cron) ────────────────────────────

/** 결제일이 지난 구독을 결제·종료. 처리 결과 개수를 돌려줌 (로그용) */
export async function runRenewals(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const out = { renewed: 0, failed: 0, ended: 0 };
  if (!env.BILLING || billingMode(env) === 'off' || !env.TOSS_SECRET_KEY) return out;
  let cursor;
  do {
    const page = await env.BILLING.list({ prefix: 'sub:', cursor });
    for (const { name } of page.keys) {
      const sub = await env.BILLING.get(name, 'json');
      if (!sub || (sub.status !== 'active' && sub.status !== 'past_due') || now < sub.periodEnd) continue;

      if (sub.cancelAtPeriodEnd || !sub.billingKey) {
        Object.assign(sub, { status: 'ended', billingKey: null, endedAt: now });
        out.ended++;
      } else {
        const p = PLANS[sub.nextPlan || sub.plan] ?? PLANS.basic;
        const r = await charge(env, fetchImpl, sub, { amount: p.price, orderName: `코스트노트 ${p.name} 요금제 (1개월)`, kind: 'renew' }, now);
        if (r.ok) {
          addPayment(sub, r.payment);
          // 제때 결제되면 결제일 유지, 밀렸다가 결제되면 오늘부터 새 기간
          const start = sub.status === 'active' ? sub.periodEnd : now;
          Object.assign(sub, { plan: p.id, nextPlan: null, status: 'active', periodStart: start, periodEnd: addMonth(start), failCount: 0, lastError: null });
          out.renewed++;
        } else {
          sub.failCount = (sub.failCount || 0) + 1;
          sub.lastError = r.message;
          if (sub.failCount >= MAX_FAILS) {
            Object.assign(sub, { status: 'ended', billingKey: null, endedAt: now });
            out.ended++;
          } else {
            sub.status = 'past_due';
            out.failed++;
          }
        }
      }
      await env.BILLING.put(name, JSON.stringify(sub));
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}
