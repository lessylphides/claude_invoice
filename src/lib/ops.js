// 운영비 · 투자 회수: 한 잔의 원가가 아닌 '가게를 유지하는 돈'을 마진으로 회수하는 계산
// - 고정비: 매달 나가는 돈 (월세·인건비·공과금…)
// - 투자 항목: 한 번에 쓴 큰돈을 회수 개월로 나눠 월 비용으로 (인테리어·장비·잔·집기). '계속' 항목은 매달 같은 금액 (잔 깨짐 보충)
// - 잔당 최소 마진 = (고정비 + 월 투자 회수) ÷ 한 달 예상 판매 잔 수
// - 월 매출을 넣으면: 그달 실제 남은 돈 = 매출 − 매입(투자 분류 제외) − 고정비, 누적으로 투자금 실제 회수율
import { uid, todayStr } from './format.js';

/** 투자(비품·시설)로 보는 매입 분류: 메뉴 재료 목록에는 나오지 않음 */
export const INVEST_CATEGORIES = ['비품·집기', '시설·장비'];
export const isInvestCategory = (c) => INVEST_CATEGORIES.includes(c);
/** 재료가 아닌 운영 지출로 보는 매입 분류 (광고비 등): 메뉴 재료 목록에 안 나오고, 그달 운영비로 셈 */
export const OPEX_CATEGORY = '광고·운영비';
export const isOpexCategory = (c) => c === OPEX_CATEGORY;
/** 메뉴 재료로 고르지 않는 매입 분류 */
export const isNonMaterialCategory = (c) => isInvestCategory(c) || isOpexCategory(c);
/** 분류별 기본 회수 개월 */
export const DEFAULT_MONTHS = { '비품·집기': 24, '시설·장비': 48 };

const money = (v) => Math.max(0, Math.round(Number(v) || 0));
const str = (v, max = 60) => String(v ?? '').trim().slice(0, max);
const isYm = (v) => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

export function emptyOps() {
  return { fixed: [], invests: [], monthlyGlasses: 0, sales: {}, salesMonths: {}, salesLinks: {}, dayStart: 6 };
}

export function sanitizeOps(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const list = (v) => (Array.isArray(v) ? v : []).filter((x) => x && typeof x === 'object');
  const sales = {};
  for (const [k, v] of Object.entries(o.sales && typeof o.sales === 'object' ? o.sales : {})) if (isYm(k) && money(v)) sales[k] = money(v);
  return {
    fixed: list(o.fixed)
      .map((f) => ({ id: str(f.id) || uid(), name: str(f.name), amount: money(f.amount) }))
      .filter((f) => f.name || f.amount),
    invests: list(o.invests)
      .map((i) => ({
        id: str(i.id) || uid(),
        name: str(i.name),
        amount: money(i.amount),
        months: Math.min(240, Math.max(1, Math.round(Number(i.months) || 12))),
        start: isYm(i.start) ? i.start : todayStr().slice(0, 7),
        ongoing: !!i.ongoing,
        monthly: money(i.monthly),
        from: str(i.from, 80), // 어느 매입 품목에서 왔는지 (purchaseId:itemId)
      }))
      .filter((i) => i.name || i.amount || i.monthly),
    monthlyGlasses: money(o.monthlyGlasses),
    sales,
    salesMonths: sanitizeSalesMonths(o.salesMonths),
    salesLinks: sanitizeLinks(o.salesLinks),
    dayStart: Number.isInteger(o.dayStart) && o.dayStart >= 0 && o.dayStart <= 12 ? o.dayStart : 6,
  };
}

/** 판매 파일에서 불러온 달별 결과 (메뉴별 수량 등). 최근 24달만 */
function sanitizeSalesMonths(raw) {
  const out = {};
  const src = raw && typeof raw === 'object' ? raw : {};
  for (const ym of Object.keys(src).filter(isYm).sort().slice(-24)) {
    const m = src[ym] && typeof src[ym] === 'object' ? src[ym] : {};
    const n = (v) => Math.round(Number(v) || 0);
    out[ym] = {
      sales: money(m.sales),
      naverTotal: money(m.naverTotal),
      etcTotal: money(m.etcTotal),
      qty: money(m.qty),
      at: str(m.at, 30),
      items: (Array.isArray(m.items) ? m.items : [])
        .filter((x) => x && typeof x === 'object' && str(x.key, 80))
        .slice(0, 400)
        .map((x) => ({ key: str(x.key, 80), name: str(x.name, 80), qty: money(x.qty), pos: money(x.pos), naver: money(x.naver), unitPrice: money(x.unitPrice), kind: x.kind === 'bottle' ? 'bottle' : 'glass' })),
      mismatch: (Array.isArray(m.mismatch) ? m.mismatch : [])
        .filter((x) => x && /^\d{4}-\d{2}-\d{2}$/.test(x.day))
        .slice(0, 62)
        .map((x) => ({ day: x.day, naver: n(x.naver), etc: n(x.etc), diff: n(x.diff) })),
    };
  }
  return out;
}

/** 판매 이름(정리한 이름) → 메뉴 id ('' = 메뉴 아님/연결 안 함) */
function sanitizeLinks(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw && typeof raw === 'object' ? raw : {}).slice(0, 2000)) if (str(k, 80)) out[str(k, 80)] = str(v, 60);
  return out;
}

/** 'YYYY-MM' 두 달 사이 개월 수 (같은 달이면 0) */
export const monthsBetween = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));

/** 이 달에 회수해야 하는 투자 금액 (회수 기간이 끝났거나 시작 전이면 0) */
export function investMonthly(inv, ym) {
  if (inv.ongoing) return inv.monthly;
  const n = monthsBetween(inv.start, ym);
  if (n < 0 || n >= inv.months) return 0;
  return Math.round(inv.amount / inv.months);
}

/** 계획상 회수 진행: 지난 개월 / 회수 개월 (계속 항목은 null) */
export function investPlanned(inv, ym) {
  if (inv.ongoing) return null;
  const done = Math.min(inv.months, Math.max(0, monthsBetween(inv.start, ym) + 1));
  return { done, months: inv.months, ratio: done / inv.months, finished: done >= inv.months };
}

/**
 * 이 달 운영 요약
 * @param {object} ops sanitizeOps 결과
 * @param {string} ym 'YYYY-MM'
 */
export function opsSummary(ops, ym) {
  const fixed = ops.fixed.reduce((s, f) => s + f.amount, 0);
  const invest = ops.invests.reduce((s, i) => s + investMonthly(i, ym), 0);
  const need = fixed + invest;
  const perGlass = ops.monthlyGlasses ? Math.ceil(need / ops.monthlyGlasses) : null;
  return { fixed, invest, need, perGlass };
}

/** 매입 합계 (투자·운영비 분류 품목은 빼고: 투자는 회수로, 운영비는 따로 셈) */
export function monthPurchaseCost(purchases, ym) {
  let sum = 0;
  for (const p of purchases) {
    if (!p.date?.startsWith(ym)) continue;
    for (const it of p.items) if (!isNonMaterialCategory(it.category)) sum += Number(it.amount) || 0;
  }
  return sum;
}

/** 그달 운영비 매입 합계 (광고비 등) */
export function monthOpexCost(purchases, ym) {
  let sum = 0;
  for (const p of purchases) {
    if (!p.date?.startsWith(ym)) continue;
    for (const it of p.items) if (isOpexCategory(it.category)) sum += Number(it.amount) || 0;
  }
  return sum;
}

/**
 * 월 매출을 넣은 달들의 실제 결과: 남은 돈 = 매출 − 매입(투자·운영비 분류 제외) − 고정비 − 그달 운영비 매입(광고비 등)
 * recovered: 투자 시작 이후 남은 돈(양수만)을 쌓은 것 → 투자 총액 대비 실제 회수율
 */
export function actualRecovery(ops, purchases) {
  const fixed = ops.fixed.reduce((s, f) => s + f.amount, 0);
  const months = Object.keys(ops.sales).sort();
  const rows = months.map((ym) => {
    const purchase = monthPurchaseCost(purchases, ym);
    const opex = monthOpexCost(purchases, ym);
    return { ym, sales: ops.sales[ym], purchase, fixed, opex, left: ops.sales[ym] - purchase - fixed - opex };
  });
  const total = ops.invests.filter((i) => !i.ongoing).reduce((s, i) => s + i.amount, 0);
  const first = ops.invests.filter((i) => !i.ongoing).map((i) => i.start).sort()[0];
  const recovered = rows.filter((r) => first && r.ym >= first).reduce((s, r) => s + Math.max(0, r.left), 0);
  return { rows, total, recovered: Math.min(recovered, total), ratio: total ? Math.min(1, recovered / total) : null };
}

/** 투자 항목 후보: 비품·시설로 분류한 매입 품목 중 아직 투자 항목으로 넣지 않은 것 (최근 순) */
export function investCandidates(purchases, ops) {
  const used = new Set(ops.invests.map((i) => i.from).filter(Boolean));
  const out = [];
  for (const p of purchases)
    for (const it of p.items) {
      const key = `${p.id}:${it.id}`;
      if (isInvestCategory(it.category) && Number(it.amount) > 0 && !used.has(key))
        out.push({ key, name: it.name, amount: Number(it.amount), category: it.category, date: p.date, vendor: p.vendor });
    }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
