// 요금제 (앱 화면·서버가 함께 씀). 가격은 부가세 포함, 한 달 단위 자동결제.
// 소개 페이지(landing/index.html)와 환불정책(landing/refund.html)의 숫자도 같이 바꿔야 합니다.

export const PLANS = {
  lite: { id: 'lite', name: '라이트', price: 4900, month: 50, day: 10, hint: '하루 영수증 1~2장인 작은 가게' },
  basic: { id: 'basic', name: '기본', price: 9900, month: 120, day: 20, hint: '매일 영수증 3~4장인 가게' },
  pro: { id: 'pro', name: '프로', price: 19900, month: 250, day: 40, hint: '거래처가 많은 식당' },
  unlimited: { id: 'unlimited', name: '무제한', price: 29900, month: null, day: 50, hint: '영수증이 아주 많은 곳' },
};
export const PLAN_ORDER = ['lite', 'basic', 'pro', 'unlimited'];

/** 가입하면 한 번 주는 무료 인식 횟수, 무료 체험 중 하루 한도 */
export const TRIAL = { total: 20, day: 20 };

export const planOf = (id) => PLANS[id] ?? null;

/** 날짜(ms)에 한 달을 더함. 1월 31일 → 2월 28/29일처럼 달 끝을 넘지 않게 */
export function addMonth(ms) {
  const d = new Date(ms);
  const day = d.getUTCDate();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return t.getTime();
}
