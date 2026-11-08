// 집계: 거래처별·항목별 묶음, 결제 구분별 합계, 같은 품목 합산, 가격 추이 점
import { normKey } from './format.js';
import { purchaseTotal } from './model.js';

/** 거래처별 묶음 (금액 큰 순): [{key, name, total, purchases, items:[{item, purchase}]}] */
export function groupByVendor(purchases) {
  const map = new Map();
  for (const p of purchases) {
    const k = normKey(p.vendor);
    let g = map.get(k);
    if (!g) map.set(k, (g = { key: k, name: p.vendor, total: 0, purchases: [], items: [] }));
    g.purchases.push(p);
    g.total += purchaseTotal(p);
    for (const item of p.items) g.items.push({ item, purchase: p });
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

/** 항목(분류)별 묶음 (금액 큰 순) */
export function groupByCategory(purchases) {
  const map = new Map();
  for (const p of purchases)
    for (const item of p.items) {
      const k = item.category || '기타';
      let g = map.get(k);
      if (!g) map.set(k, (g = { key: k, name: k, total: 0, items: [] }));
      g.total += Number(item.amount) || 0;
      g.items.push({ item, purchase: p });
    }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

/** 결제 구분별 합계 + 세금계산서 미발행 거래처 */
export function paySummary(purchases) {
  const s = { tax: 0, taxIssued: 0, taxPending: 0, card: 0, none: 0, pendingVendors: new Map() };
  for (const p of purchases) {
    const t = purchaseTotal(p);
    if (p.payType === 'tax') {
      s.tax += t;
      if (p.taxIssued) s.taxIssued += t;
      else {
        s.taxPending += t;
        const k = normKey(p.vendor);
        const v = s.pendingVendors.get(k) ?? { name: p.vendor, total: 0, dates: new Set() };
        v.total += t;
        v.dates.add(p.date);
        s.pendingVendors.set(k, v);
      }
    } else if (p.payType === 'card') s.card += t;
    else s.none += t;
  }
  return s;
}

/**
 * 같은 품목끼리 수량·금액·할인 합산 (금액 큰 순)
 * @param {(name:string)=>string} keyOf 같은 품목 판별 (기본: 이름 정규화, 묶기를 쓰면 store.index.key)
 */
export function aggregateItems(entries, keyOf = normKey) {
  const map = new Map();
  for (const { item, purchase } of entries) {
    const k = keyOf(item.name);
    const a = map.get(k) ?? { name: item.name, qty: 0, unit: item.unit, amount: 0, discount: 0, vendors: new Set(), count: 0 };
    a.qty += Number(item.qty) || 0;
    a.amount += Number(item.amount) || 0;
    a.discount += Number(item.discount) || 0;
    a.vendors.add(purchase.vendor);
    a.count++;
    map.set(k, a);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

/** 가격 추이 점 (오래된 순). 그래프는 할인 반영 실제 단가, 정가·할인은 표·툴팁용 */
export function pricePoints(index, name) {
  return index
    .history(name)
    .map((r) => ({
      date: r.date,
      price: r.price,
      listPrice: Number(r.item.unitPrice) || 0,
      discount: Number(r.item.discount) || 0,
      vendor: r.vendor,
      qty: Number(r.item.qty) || 0,
      unit: r.item.unit,
      amount: Number(r.item.amount) || 0,
      packSize: Number(r.item.packSize) || 0,
      packUnit: r.item.packUnit || '',
    }))
    .reverse();
}

/**
 * 용량이 다른 매입(1병 vs 1박스)이 섞여 있으면 가장 최근 매입의 용량 기준으로 단가를 환산
 * 환산한 점에는 origPrice(원래 단가)를 남김. 용량을 모르는 점은 그대로 둠
 * @returns {{points, base: {packSize, packUnit}|null}} base 가 null 이면 환산하지 않음
 */
export function normalizePoints(points) {
  const last = [...points].reverse().find((p) => p.packSize);
  if (!last) return { points, base: null };
  const mixed = points.some((p) => p.packSize && p.packUnit === last.packUnit && p.packSize !== last.packSize);
  if (!mixed) return { points, base: null };
  return {
    base: { packSize: last.packSize, packUnit: last.packUnit },
    points: points.map((p) =>
      p.packSize && p.packUnit === last.packUnit && p.packSize !== last.packSize
        ? { ...p, origPrice: p.price, price: (p.price * last.packSize) / p.packSize }
        : p,
    ),
  };
}

/** 가격 추이 요약: 최근·직전·평균·최저·최고 */
export function priceStats(points) {
  const prices = points.map((p) => p.price);
  const last = points.at(-1);
  const prev = points.at(-2);
  const diff = last && prev ? last.price - prev.price : 0;
  return {
    last,
    prev,
    diff,
    diffPct: prev?.price ? (diff / prev.price) * 100 : 0,
    avg: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0,
    min: prices.length ? Math.min(...prices) : null,
    max: prices.length ? Math.max(...prices) : null,
  };
}
