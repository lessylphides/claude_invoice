// 데이터 모델: 형식 정리(sanitize), 계산 규칙, 저장 형식 버전 관리(migrate)
// DOM 을 쓰지 않는 순수 함수만 둡니다 → 단위 테스트로 검증합니다.
//
// purchase = {
//   id, date: 'YYYY-MM-DD', vendor,
//   payType: 'tax' | 'card' | '',   // 세금계산서 / 카드 / 미지정
//   taxIssued: boolean,              // 세금계산서 발행 받았는지 (payType 이 tax 일 때만 의미)
//   items: [{ id, name, category, qty, unit,
//             unitPrice,             // 할인 전 정가 단가
//             discount,              // 이 품목에 붙은 쿠폰·할인 금액 (양수)
//             amount,                // 실제 지불 금액 = qty×unitPrice - discount
//             packSize, packUnit }], // 수량 1개의 용량, 예: 700 'ml' / 7 '개'. 원가 계산에 사용
//   memo, createdAt
// }
// menu = { id, name, price(판매가), createdAt,
//          ingredients: [ { id, type:'item', itemName, packSize, unit, use }   // 매입 품목: 1개(packSize) 중 use 만큼
//                       | { id, type:'manual', name, cost } ] }              // 영수증에 없는 재료: 1잔당 원가
// costTarget = { history: [{ value, at:'YYYY-MM-DD', note? }] }  마지막 항목이 현재 목표 원가율

import { isYmd, todayStr, uid } from './format.js';

export const DATA_VERSION = 2;

export const DEFAULT_CATEGORIES = ['채소·과일', '육류', '수산물', '곡물·가공식품', '유제품·계란', '양념·소스', '주류·음료', '포장·소모품', '공산품·비품', '기타'];

// 용량 단위: 마시는 것은 ml, 무게는 g, 조각·낱개로 나눠 쓰는 것(케이크 7조각)은 개, 묶음 속 병(맥주 24병)은 병
export const PACK_UNITS = ['ml', 'g', '개', '병'];

export const DEFAULT_TARGET = 25;

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const nonNeg = (v) => Math.max(0, toNum(v));
const str = (v) => String(v ?? '').trim();

/** 수량×정가-할인 (수량이나 단가가 없으면 null: 금액을 직접 적은 경우) */
export function itemAmount(qty, unitPrice, discount = 0) {
  const gross = toNum(qty) * toNum(unitPrice);
  return gross ? Math.round(gross - nonNeg(discount)) : null;
}

/** 할인을 반영한 1개당 실제 단가 */
export function netUnitPrice(i) {
  const qty = toNum(i.qty);
  const amount = toNum(i.amount);
  if (qty) return Math.round(amount / qty);
  return amount || toNum(i.unitPrice);
}

export const purchaseTotal = (p) => p.items.reduce((s, i) => s + toNum(i.amount), 0);

/** 품목 이름에서 용량 추정: '몽키숄더700ML' → 700 ml, '휘핑크림 2L' → 2000 ml, '블루베리510G' → 510 g */
export function guessPack(name) {
  // 단위 뒤에 다른 글자가 붙으면 단위가 아님(예: 5Lemon). 단, 묶음 표시 X(330MLX24)는 허용
  const all = [...String(name ?? '').matchAll(/(\d+(?:\.\d+)?)\s*(ml|l|kg|g)(?![a-wyz])/gi)];
  if (!all.length) return null;
  const [, n, u] = all.at(-1);
  const v = Number(n);
  const unit = u.toLowerCase();
  if (!v) return null;
  if (unit === 'l') return { packSize: v * 1000, packUnit: 'ml' };
  if (unit === 'kg') return { packSize: v * 1000, packUnit: 'g' };
  return { packSize: v, packUnit: unit };
}

export function sanitizeItem(i = {}) {
  const qty = toNum(i.qty);
  const unitPrice = toNum(i.unitPrice);
  const discount = Math.round(nonNeg(i.discount));
  let amount = toNum(i.amount);
  if (!amount) amount = itemAmount(qty, unitPrice, discount) ?? 0;
  const packSize = nonNeg(i.packSize);
  return {
    id: i.id || uid(),
    name: str(i.name) || '(품목명 없음)',
    category: str(i.category) || '기타',
    qty,
    unit: str(i.unit),
    unitPrice,
    discount,
    amount: Math.round(amount),
    packSize,
    packUnit: packSize ? str(i.packUnit) : '',
  };
}

export function sanitizePurchase(p = {}) {
  const payType = p.payType === 'tax' || p.payType === 'card' ? p.payType : '';
  return {
    id: p.id || uid(),
    date: isYmd(p.date) ? p.date : todayStr(),
    vendor: str(p.vendor) || '(거래처 미상)',
    payType,
    taxIssued: payType === 'tax' && !!p.taxIssued,
    items: (Array.isArray(p.items) ? p.items : []).map(sanitizeItem),
    memo: String(p.memo ?? ''),
    createdAt: toNum(p.createdAt) || Date.now(),
  };
}

export function sanitizeIngredient(g = {}) {
  if (g.type === 'manual') return { id: g.id || uid(), type: 'manual', name: str(g.name) || '기타 재료', cost: nonNeg(g.cost) };
  return { id: g.id || uid(), type: 'item', itemName: str(g.itemName), packSize: nonNeg(g.packSize), unit: str(g.unit), use: nonNeg(g.use) };
}

export function sanitizeMenu(m = {}) {
  return {
    id: m.id || uid(),
    name: str(m.name) || '(이름 없음)',
    price: Math.round(nonNeg(m.price)),
    ingredients: (Array.isArray(m.ingredients) ? m.ingredients : []).map(sanitizeIngredient).filter((g) => g.type === 'manual' || g.itemName),
    createdAt: toNum(m.createdAt) || Date.now(),
  };
}

const validTarget = (v) => Number.isFinite(v) && v > 0 && v < 100;

export function sanitizeCostTarget(ct) {
  const history = (Array.isArray(ct?.history) ? ct.history : [])
    .map((h) => ({ value: Math.round(toNum(h?.value) * 10) / 10, at: isYmd(h?.at) ? h.at : todayStr(), ...(h?.note ? { note: String(h.note) } : {}) }))
    .filter((h) => validTarget(h.value));
  return { history: history.length ? history : [{ value: DEFAULT_TARGET, at: todayStr(), note: '기본값' }] };
}

export function sanitizeCategories(list) {
  const clean = [...new Set((Array.isArray(list) ? list : []).map(str).filter(Boolean))];
  if (!clean.length) return DEFAULT_CATEGORIES.slice();
  if (!clean.includes('기타')) clean.push('기타');
  return clean;
}

/**
 * 저장된(또는 백업 파일의) 데이터를 현재 형식으로 맞춤.
 * - v1(버전 표시 없음): 원가 데이터·용량 필드가 없을 수 있음 → 기본값 채움
 * 앞으로 형식이 바뀌면 여기에 단계별 변환을 추가합니다.
 */
export function migrate(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  return {
    version: DATA_VERSION,
    purchases: (Array.isArray(d.purchases) ? d.purchases : []).map(sanitizePurchase),
    categories: sanitizeCategories(d.categories),
    menus: (Array.isArray(d.menus) ? d.menus : []).map(sanitizeMenu),
    costTarget: sanitizeCostTarget(d.costTarget),
  };
}

/** 목표 원가율 값 검사 (사용자 입력) */
export function parseTarget(value) {
  const v = Math.round(Number(value) * 10) / 10;
  if (!validTarget(v)) throw new Error('목표 원가율은 0보다 크고 100보다 작아야 합니다.');
  return v;
}
