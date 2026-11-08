// 원가 변동 알림: 매입을 저장하기 전과 후의 품목 색인을 비교해, 이번 매입으로 원가가 바뀐 메뉴를 찾음
// (매입 품목 재료는 '가장 최근 매입 단가'로 계산하므로, 새 영수증의 단가가 다르면 그 재료를 쓰는 메뉴 원가가 바뀜)
import { menuCost, judgeMenu, priceForTarget, priceForMargin } from './cost.js';

const pctChange = (from, to) => (from ? ((to - from) / from) * 100 : null);

/** 목표 원가율 또는 최소 마진 중 하나라도 맞추는 가장 싼 판매가 (100원 단위) */
export function suggestPrice(c, target, minMargin) {
  const byRate = priceForTarget(c.cost, target);
  const byMargin = minMargin != null && !c.missing ? priceForMargin(c.cost, minMargin) : Infinity;
  return Math.min(byRate, byMargin);
}

/**
 * @param {Array} menus 메뉴 목록
 * @param {object} before 저장 전 품목 색인
 * @param {object} after 저장 후 품목 색인
 * @param {{itemNames: string[], target: number, minMarginOf: (category: string) => number|null}} opts
 *   itemNames: 이번에 저장한 매입의 품목 이름들
 * @returns {{items: Array, menus: Array, up: number, down: number}}
 */
export function costImpact(menus, before, after, { itemNames, target, minMarginOf }) {
  const keys = new Set(itemNames.map((n) => after.key(n)).filter(Boolean));
  if (!keys.size) return { items: [], menus: [], up: 0, down: 0 };

  // 재료 단가 변화 (메뉴에 쓰이는 품목만)
  const items = [];
  const seen = new Set();
  const out = [];
  for (const m of menus) {
    const used = (m.ingredients || []).filter((g) => g.type !== 'manual' && keys.has(after.key(g.itemName)));
    if (!used.length) continue;
    for (const g of used) {
      const k = after.key(g.itemName);
      if (seen.has(k)) continue;
      seen.add(k);
      const [b] = before.history(g.itemName);
      const [a] = after.history(g.itemName);
      if (a && (!b || Math.abs(a.price - b.price) >= 1))
        items.push({ name: a.name, from: b?.price ?? null, to: a.price, pct: b ? pctChange(b.price, a.price) : null, vendor: a.vendor });
    }

    const c0 = menuCost(m, before);
    const c1 = menuCost(m, after);
    const delta = c1.cost - c0.cost;
    if (Math.abs(delta) < 1 && c0.missing === c1.missing) continue;
    const price = Number(m.price) || 0;
    const minMargin = minMarginOf(m.category);
    const j0 = judgeMenu(c0, price, target, minMargin);
    const j1 = judgeMenu(c1, price, target, minMargin);
    const suggest = j1.status === 'over' ? suggestPrice(c1, target, minMargin) : null;
    out.push({
      id: m.id,
      name: m.name,
      price,
      delta,
      before: { cost: c0.cost, rate: c0.rate, status: j0.status },
      after: { cost: c1.cost, rate: c1.rate, status: j1.status, missing: c1.missing },
      newlyOver: j1.status === 'over' && j0.status !== 'over',
      stillOver: j1.status === 'over' && j0.status === 'over',
      recovered: j0.status === 'over' && j1.status !== 'over',
      suggest,
      suggestRate: suggest ? (c1.cost / suggest) * 100 : null,
    });
  }
  // 새로 목표를 넘은 메뉴 → 계속 넘는 메뉴 → 많이 오른 순
  const rank = (x) => (x.newlyOver ? 0 : x.stillOver ? 1 : 2);
  out.sort((a, b) => rank(a) - rank(b) || b.delta - a.delta);
  return { items, menus: out, up: out.filter((x) => x.delta > 0).length, down: out.filter((x) => x.delta < 0).length };
}
