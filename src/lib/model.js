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
// menu = { id, name, price(판매가), category(메뉴 분류, ''=미분류), createdAt,
//          ingredients: [ { id, type:'item', itemName, packSize, unit, use }   // 매입 품목: 1개(packSize) 중 use 만큼
//                       | { id, type:'manual', name, cost } ] }              // 영수증에 없는 재료: 1잔당 원가
// costTarget = { history: [{ value, at:'YYYY-MM-DD', note? }] }  마지막 항목이 현재 목표 원가율
// menuCategories = ['커피', '위스키', ...]  원가 탭의 메뉴 분류 (이 순서대로 보여줌)
// minMargins = { '위스키': [{ value: 12000, at:'YYYY-MM-DD' }, ...] }  분류별 최소 마진 금액(한 잔에 최소 남길 돈) 변경 기록.
//              마지막 항목이 현재 값, 0 이면 설정 안 함(원가율로만 판정)
// itemLinks = { 묶인이름키: '대표 이름' }, itemNotSame = ['키A|키B']  같은 품목 묶기 (lib/itemLinks.js)

import { isYmd, todayStr, uid } from './format.js';
import { sanitizeLinks, sanitizeNotSame } from './itemLinks.js';

export const DATA_VERSION = 5; // 3: 메뉴 분류, 4: 분류별 최소 마진(minMargins), 5: 같은 품목 묶기(itemLinks, itemNotSame)

export const DEFAULT_MENU_CATEGORIES = ['커피', '위스키', '칵테일', '맥주', '티', '디저트'];
export const UNCATEGORIZED = '미분류';
const RESERVED_MENU_CATEGORIES = ['전체', UNCATEGORIZED];

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
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []); // null 등 깨진 항목은 버림

/**
 * 날짜 정리: 올바른 날짜는 그대로, '2026-02-30' 처럼 모양은 맞는데 없는 날은 그달 마지막 날로
 * (그달 합계에 그대로 남도록), 알아볼 수 없으면 오늘.
 */
export function normalizeDate(s) {
  if (isYmd(s)) return s;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mo >= 1 && mo <= 12 && d >= 1) {
      const last = new Date(y, mo, 0).getDate();
      return `${m[1]}-${m[2]}-${String(Math.min(d, last)).padStart(2, '0')}`;
    }
  }
  return todayStr();
}

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

export function sanitizeItem(raw) {
  const i = obj(raw);
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

export function sanitizePurchase(raw) {
  const p = obj(raw);
  const payType = p.payType === 'tax' || p.payType === 'card' ? p.payType : '';
  return {
    id: p.id || uid(),
    date: normalizeDate(p.date),
    vendor: str(p.vendor) || '(거래처 미상)',
    payType,
    taxIssued: payType === 'tax' && !!p.taxIssued,
    items: list(p.items).map(sanitizeItem),
    memo: String(p.memo ?? ''),
    createdAt: toNum(p.createdAt) || Date.now(),
  };
}

export function sanitizeIngredient(raw) {
  const g = obj(raw);
  if (g.type === 'manual') return { id: g.id || uid(), type: 'manual', name: str(g.name) || '기타 재료', cost: nonNeg(g.cost) };
  return { id: g.id || uid(), type: 'item', itemName: str(g.itemName), packSize: nonNeg(g.packSize), unit: str(g.unit), use: nonNeg(g.use) };
}

export function sanitizeMenu(raw) {
  const m = obj(raw);
  return {
    id: m.id || uid(),
    name: str(m.name) || '(이름 없음)',
    price: Math.round(nonNeg(m.price)),
    category: RESERVED_MENU_CATEGORIES.includes(str(m.category)) ? '' : str(m.category),
    ingredients: list(m.ingredients).map(sanitizeIngredient).filter((g) => g.type === 'manual' || g.itemName),
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

/** 메뉴 분류 목록: 앞뒤 공백·빈 이름·중복·예약어(전체, 미분류) 제거. 비워 둘 수도 있음 */
export function sanitizeMenuCategories(names) {
  return [...new Set((Array.isArray(names) ? names : []).map(str).filter((n) => n && !RESERVED_MENU_CATEGORIES.includes(n)))];
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
 * @param {{trusted?: boolean}} opts trusted=true: 이 앱이 저장한 데이터 (현재 형식이면 빠르게 통과)
 */
export function migrate(raw, { trusted = false } = {}) {
  const d = raw && typeof raw === 'object' ? raw : {};
  // 이 앱이 직접 저장한 현재 형식이면 품목 하나하나를 다시 정리하지 않음 (시작을 빠르게).
  // 백업 파일처럼 밖에서 들어온 데이터(trusted=false)는 항상 전부 검사.
  if (
    trusted &&
    d.version === DATA_VERSION &&
    Array.isArray(d.purchases) &&
    Array.isArray(d.menus) &&
    Array.isArray(d.categories) &&
    Array.isArray(d.menuCategories) &&
    d.minMargins && typeof d.minMargins === 'object' &&
    d.itemLinks && typeof d.itemLinks === 'object' &&
    Array.isArray(d.itemNotSame) &&
    Array.isArray(d.costTarget?.history) &&
    d.costTarget.history.length
  )
    return d;
  const menus = list(d.menus).map(sanitizeMenu);
  // v2 이하: 메뉴 분류가 없으면 기본 분류로 시작. 메뉴에 적힌 분류가 목록에 없으면 목록 끝에 더함
  const menuCategories = sanitizeMenuCategories(Array.isArray(d.menuCategories) ? d.menuCategories : DEFAULT_MENU_CATEGORIES);
  for (const m of menus) if (m.category && !menuCategories.includes(m.category)) menuCategories.push(m.category);
  return {
    version: DATA_VERSION,
    purchases: list(d.purchases).map(sanitizePurchase),
    categories: sanitizeCategories(d.categories),
    menus,
    menuCategories,
    minMargins: sanitizeMinMargins(d.minMargins, menuCategories),
    itemLinks: sanitizeLinks(d.itemLinks),
    itemNotSame: sanitizeNotSame(d.itemNotSame),
    costTarget: sanitizeCostTarget(d.costTarget),
  };
}

/** 분류별 최소 마진 기록 정리: 있는 분류만, 0 이상 정수, 날짜 확인. 기록이 비면 그 분류는 뺌 */
export function sanitizeMinMargins(raw, categories) {
  const out = {};
  const src = raw && typeof raw === 'object' ? raw : {};
  for (const cat of categories) {
    const hist = (Array.isArray(src[cat]) ? src[cat] : [])
      .filter((h) => h && typeof h === 'object')
      .map((h) => ({ value: Math.round(nonNeg(h.value)), at: isYmd(h.at) ? h.at : todayStr() }));
    if (hist.length) out[cat] = hist;
  }
  return out;
}

/** 최소 마진 금액 입력 검사: 빈칸은 0(설정 안 함) */
export function parseMargin(value) {
  if (value === '' || value == null) return 0;
  const v = Math.round(Number(value));
  if (!Number.isFinite(v) || v < 0) throw new Error('최소 마진은 0원 이상이어야 합니다.');
  return v;
}

/** 목표 원가율 값 검사 (사용자 입력) */
export function parseTarget(value) {
  const v = Math.round(Number(value) * 10) / 10;
  if (!validTarget(v)) throw new Error('목표 원가율은 0보다 크고 100보다 작아야 합니다.');
  return v;
}

/**
 * 예전 저장소(localStorage)에 남은 데이터를 현재 데이터에 합침: 현재에 없는 영수증·메뉴(id 기준)만 더함.
 * 예전 버전 앱 창(예: 백그라운드에 있던 홈 화면 앱)이 옮긴 뒤에도 예전 저장소에 써 둔 내역을 잃지 않기 위함.
 * @returns {{data: object, added: number}}
 */
export function mergeLegacy(current, legacy) {
  const have = new Set(current.purchases.map((p) => p.id));
  const haveMenu = new Set(current.menus.map((m) => m.id));
  const newPurchases = legacy.purchases.filter((p) => !have.has(p.id));
  const newMenus = legacy.menus.filter((m) => !haveMenu.has(m.id));
  if (!newPurchases.length && !newMenus.length) return { data: current, added: 0 };
  return {
    data: { ...current, purchases: [...current.purchases, ...newPurchases], menus: [...current.menus, ...newMenus] },
    added: newPurchases.length + newMenus.length,
  };
}
