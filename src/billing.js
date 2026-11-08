// 요금제 구독: 우리 서버(/api/billing) 호출 + 토스페이먼츠 카드 등록창
// 카드 정보는 토스페이먼츠 화면에만 입력하고, 이 앱과 우리 서버는 카드번호를 받지 않습니다.
import { auth } from './auth.js';
import { TOSS_CLIENT_KEY } from './config.js';

// 카드 등록창에서 돌아온 경우: 주소의 결과를 읽고 바로 지움 (새로고침해도 다시 처리하지 않게)
const RETURN_KEYS = ['billing', 'plan', 'authKey', 'customerKey', 'code', 'message', 'orderId'];
const q = new URLSearchParams(location.search);
let pendingReturn = q.get('billing')
  ? {
      result: q.get('billing'),
      plan: q.get('plan'),
      authKey: q.get('authKey'),
      customerKey: q.get('customerKey'),
      code: q.get('code'),
      message: q.get('message'),
    }
  : null;
if (pendingReturn) {
  RETURN_KEYS.forEach((k) => q.delete(k));
  history.replaceState(null, '', location.pathname + (q.size ? `?${q}` : '') + location.hash);
}

/** 카드 등록 결과를 한 번만 꺼냄 */
export function takeBillingReturn() {
  const r = pendingReturn;
  pendingReturn = null;
  return r;
}

async function api(path = '', body) {
  const token = await auth.accessToken();
  if (!token) throw new Error('로그인이 만료됐어요. 다시 로그인해 주세요.');
  let res;
  try {
    res = await fetch(`./api/billing${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('인터넷 연결을 확인해 주세요.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const err = new Error(data?.error?.message || `결제 서버에 연결하지 못했어요 (${res.status}). 잠시 후 다시 시도해 주세요.`);
    err.code = data?.error?.code;
    throw err;
  }
  return data;
}

export const billing = {
  /** {mode, customerKey, subscription, entitlement, usage} */
  status: () => api(),
  subscribe: (plan, authKey, customerKey) => api('/subscribe', { plan, authKey, customerKey }),
  change: (plan) => api('/change', { plan }),
  cancel: () => api('/cancel', {}),
  resume: () => api('/resume', {}),
  /** 탈퇴 직전: 구독을 끝내고 등록한 카드를 지움 */
  async close() {
    try {
      await api('/close', {});
    } catch (e) {
      if (e.code !== 'not_configured') throw e; // 결제 저장소가 없으면 지울 것도 없음
    }
  },
  /** 토스페이먼츠 카드 등록창으로 이동 (등록이 끝나면 이 앱 주소로 돌아옴) */
  async registerCard({ plan, customerKey, email }) {
    const { loadTossPayments } = await import('@tosspayments/tosspayments-sdk');
    const toss = await loadTossPayments(TOSS_CLIENT_KEY);
    const base = location.origin + location.pathname;
    await toss.payment({ customerKey }).requestBillingAuth({
      method: 'CARD',
      successUrl: `${base}?billing=success&plan=${encodeURIComponent(plan)}`,
      failUrl: `${base}?billing=fail`,
      customerEmail: email || undefined,
      windowTarget: 'self',
    });
  },
};
