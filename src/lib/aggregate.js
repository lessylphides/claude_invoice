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

/** 같은 품목(이름 기준)끼리 수량·금액·할인 합산 (금액 큰 순) */
export function aggregateItems(entries) {
  const map = new Map();
  for (const { item, purchase } of entries) {
    const k = normKey(item.name);
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
    }))
    .reverse();
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
