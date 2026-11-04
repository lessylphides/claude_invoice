// 데이터 저장소 (기기 브라우저의 localStorage 에 저장)
//
// purchase = {
//   id, date: 'YYYY-MM-DD', vendor,
//   payType: 'tax' | 'card' | '',   // 세금계산서 / 카드 / 미지정
//   taxIssued: boolean,              // 세금계산서 발행 받았는지
//   items: [{ id, name, category, qty, unit,
//             unitPrice,   // 할인 전 정가 단가
//             discount,    // 이 품목에 붙은 쿠폰·할인 금액 (양수)
//             amount,      // 실제 지불 금액 = qty×unitPrice - discount
//             packSize, packUnit }],  // 1개(수량 1단위)의 용량, 예: 700 'ml' / 7 '조각'. 원가 계산에 사용
//   memo, createdAt
// }

import { normKey, todayStr, uid } from './format.js';

const DATA_KEY = 'maeip.data.v1';
const SETTINGS_KEY = 'maeip.settings.v1';

export const DEFAULT_CATEGORIES = [
  '채소·과일',
  '육류',
  '수산물',
  '곡물·가공식품',
  '유제품·계란',
  '양념·소스',
  '주류·음료',
  '포장·소모품',
  '공산품·비품',
  '기타',
];

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (정확도 우선, 기본)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (빠름·저렴)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (가장 저렴)' },
];

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    alert('저장에 실패했습니다. 브라우저 저장 공간 또는 개인정보 보호 모드를 확인하세요.');
    return false;
  }
}

function sanitizeItem(i) {
  const qty = Number(i.qty) || 0;
  const unitPrice = Number(i.unitPrice) || 0;
  const discount = Math.max(0, Math.round(Number(i.discount) || 0));
  let amount = Number(i.amount);
  if (!Number.isFinite(amount) || amount === 0) amount = qty * unitPrice - discount;
  return {
    id: i.id || uid(),
    name: String(i.name || '').trim() || '(품목명 없음)',
    category: String(i.category || '기타'),
    qty,
    unit: String(i.unit || '').trim(),
    unitPrice,
    discount,
    amount: Math.round(amount),
    packSize: Math.max(0, Number(i.packSize) || 0),
    packUnit: Number(i.packSize) ? String(i.packUnit || '').trim() : '',
  };
}

export const PACK_UNITS = ['ml', 'g', '개', '조각', '잔'];

/** 품목 이름에서 용량 추정: '몽키숄더700ML' → 700 ml, '휘핑크림 2L' → 2000 ml, '블루베리510G' → 510 g */
export function guessPack(name) {
  const all = [...String(name).matchAll(/(\d+(?:\.\d+)?)\s*(ml|l|kg|g)(?![a-z])/gi)];
  if (!all.length) return null;
  const [, n, u] = all.at(-1);
  const v = Number(n), unit = u.toLowerCase();
  if (unit === 'l') return { packSize: v * 1000, packUnit: 'ml' };
  if (unit === 'kg') return { packSize: v * 1000, packUnit: 'g' };
  return { packSize: v, packUnit: unit };
}

function sanitizePurchase(p) {
  return {
    id: p.id || uid(),
    date: String(p.date),
    vendor: String(p.vendor || '').trim() || '(거래처 미상)',
    payType: p.payType === 'tax' || p.payType === 'card' ? p.payType : '',
    taxIssued: p.payType === 'tax' ? !!p.taxIssued : false,
    items: (p.items || []).map(sanitizeItem),
    memo: String(p.memo || ''),
    createdAt: p.createdAt || Date.now(),
  };
}

let data = readJSON(DATA_KEY, null) || { purchases: [], categories: DEFAULT_CATEGORIES.slice() };
if (!Array.isArray(data.categories) || !data.categories.length) data.categories = DEFAULT_CATEGORIES.slice();
if (!Array.isArray(data.purchases)) data.purchases = [];
normalizeCostData(data);

// ── 원가 탭 데이터 ──
// menu = { id, name, price(판매가),
//          ingredients: [ { id, type:'item', itemName, packSize, unit, use }   // 매입 품목 연결: 1구매단위 = packSize unit 중 use 만큼 사용
//                       | { id, type:'manual', name, cost } ],               // 영수증에 없는 재료: 1잔당 원가 직접 입력
//          createdAt }
// costTarget = { history: [{ value, at:'YYYY-MM-DD', note }] }  마지막 항목이 현재 목표 원가율
function normalizeCostData(d) {
  if (!Array.isArray(d.menus)) d.menus = [];
  if (!d.costTarget || !Array.isArray(d.costTarget.history) || !d.costTarget.history.length)
    d.costTarget = { history: [{ value: 25, at: todayStr(), note: '기본값' }] };
}

function sanitizeMenu(m) {
  return {
    id: m.id || uid(),
    name: String(m.name || '').trim() || '(이름 없음)',
    price: Math.max(0, Math.round(Number(m.price) || 0)),
    ingredients: (m.ingredients || [])
      .map((g) =>
        g.type === 'manual'
          ? { id: g.id || uid(), type: 'manual', name: String(g.name || '').trim() || '기타 재료', cost: Math.max(0, Number(g.cost) || 0) }
          : {
              id: g.id || uid(),
              type: 'item',
              itemName: String(g.itemName || '').trim(),
              packSize: Math.max(0, Number(g.packSize) || 0),
              unit: String(g.unit || '').trim(),
              use: Math.max(0, Number(g.use) || 0),
            },
      )
      .filter((g) => (g.type === 'manual' ? true : g.itemName)),
    createdAt: m.createdAt || Date.now(),
  };
}

let settings = { apiKey: '', model: MODELS[0].id, ...readJSON(SETTINGS_KEY, {}) };

const listeners = new Set();
function commit() {
  writeJSON(DATA_KEY, data);
  listeners.forEach((fn) => fn());
}

export const store = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get purchases() {
    return data.purchases;
  },
  get categories() {
    return data.categories;
  },
  get settings() {
    return settings;
  },
  saveSettings(patch) {
    settings = { ...settings, ...patch };
    writeJSON(SETTINGS_KEY, settings);
  },
  get(id) {
    return data.purchases.find((p) => p.id === id);
  },
  upsert(p) {
    const clean = sanitizePurchase(p);
    const idx = data.purchases.findIndex((x) => x.id === clean.id);
    if (idx >= 0) data.purchases[idx] = clean;
    else data.purchases.push(clean);
    commit();
    return clean;
  },
  remove(id) {
    data.purchases = data.purchases.filter((p) => p.id !== id);
    commit();
  },
  /** 여러 영수증(같은 날·같은 거래처)의 결제 정보를 한 번에 바꿈 */
  setPayment(ids, patch) {
    for (const p of data.purchases) {
      if (!ids.includes(p.id)) continue;
      if ('payType' in patch) p.payType = patch.payType;
      if ('taxIssued' in patch) p.taxIssued = !!patch.taxIssued;
      if (p.payType !== 'tax') p.taxIssued = false;
    }
    commit();
  },
  setCategories(list) {
    const clean = [...new Set(list.map((s) => s.trim()).filter(Boolean))];
    data.categories = clean.length ? clean : DEFAULT_CATEGORIES.slice();
    if (!data.categories.includes('기타')) data.categories.push('기타');
    commit();
  },
  exportData() {
    return JSON.stringify({ app: 'maeip-calendar', version: 1, exportedAt: new Date().toISOString(), ...data }, null, 2);
  },
  importData(json) {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed.purchases)) throw new Error('올바른 백업 파일이 아닙니다.');
    data = {
      purchases: parsed.purchases.map(sanitizePurchase),
      categories: Array.isArray(parsed.categories) && parsed.categories.length ? parsed.categories : DEFAULT_CATEGORIES.slice(),
      menus: Array.isArray(parsed.menus) ? parsed.menus.map(sanitizeMenu) : [],
      costTarget: parsed.costTarget,
    };
    normalizeCostData(data);
    commit();
  },

  // ── 원가 ──
  get menus() {
    return data.menus;
  },
  getMenu(id) {
    return data.menus.find((m) => m.id === id);
  },
  upsertMenu(m) {
    const clean = sanitizeMenu(m);
    const idx = data.menus.findIndex((x) => x.id === clean.id);
    if (idx >= 0) data.menus[idx] = clean;
    else data.menus.push(clean);
    commit();
    return clean;
  },
  removeMenu(id) {
    data.menus = data.menus.filter((m) => m.id !== id);
    commit();
  },
  /** 현재 목표 원가율 {value, at, note} */
  get costTarget() {
    return data.costTarget.history.at(-1);
  },
  get costTargetHistory() {
    return data.costTarget.history;
  },
  setCostTarget(value) {
    const v = Math.round(Number(value) * 10) / 10;
    if (!(v > 0 && v < 100)) throw new Error('목표 원가율은 0보다 크고 100보다 작아야 합니다.');
    data.costTarget.history.push({ value: v, at: todayStr() });
    commit();
  },
  /** 같은 품목의 가장 최근 용량 기록 {packSize, packUnit} (없으면 null) */
  itemSpec(name) {
    const k = normKey(name);
    if (!k) return null;
    let best = null;
    for (const p of data.purchases)
      for (const i of p.items)
        if (i.packSize && normKey(i.name) === k && (!best || p.date > best.date || (p.date === best.date && p.createdAt > best.createdAt)))
          best = { date: p.date, createdAt: p.createdAt, packSize: i.packSize, packUnit: i.packUnit };
    return best && { packSize: best.packSize, packUnit: best.packUnit };
  },
  /** 매입된 적 있는 품목 이름 (최근 매입 순, 이름 기준 중복 제거) */
  itemNames() {
    const seen = new Map();
    [...data.purchases]
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
      .forEach((p) => p.items.forEach((i) => {
        const k = normKey(i.name);
        if (k && !seen.has(k)) seen.set(k, i.name);
      }));
    return [...seen.values()];
  },
  /** 지금까지 입력된 거래처 이름 (최근 사용 순) */
  vendorNames() {
    const seen = new Map();
    [...data.purchases].sort((a, b) => b.date.localeCompare(a.date)).forEach((p) => {
      const k = normKey(p.vendor);
      if (!seen.has(k)) seen.set(k, p.vendor);
    });
    return [...seen.values()];
  },
};

export const purchaseTotal = (p) => p.items.reduce((s, i) => s + (Number(i.amount) || 0), 0);

/** 할인을 반영한 실제 단가 */
export function netUnitPrice(i) {
  const qty = Number(i.qty) || 0;
  const amount = Number(i.amount) || 0;
  if (qty) return Math.round(amount / qty);
  return amount || Number(i.unitPrice) || 0;
}
