// 원가 변동 알림: 이번 매입으로 원가가 바뀐 메뉴와 추천 판매가
import { describe, it, expect } from 'vitest';
import { buildItemIndex } from '../../src/lib/itemIndex.js';
import { costImpact, suggestPrice } from '../../src/lib/costImpact.js';

const item = (name, unitPrice, extra = {}) => ({ id: `${name}${unitPrice}`, name, category: '유제품·계란', qty: 1, unit: '', unitPrice, discount: 0, amount: unitPrice, packSize: 1000, packUnit: 'ml', ...extra });
const buy = (id, date, items) => ({ id, date, vendor: '우유대리점', createdAt: Date.parse(date), items });

const menus = [
  { id: 'latte', name: '카페라떼', category: '커피', price: 5000, ingredients: [{ type: 'item', itemName: '우유 1L', use: 200 }, { type: 'manual', name: '원두', cost: 700 }] },
  { id: 'ame', name: '아메리카노', category: '커피', price: 4500, ingredients: [{ type: 'manual', name: '원두', cost: 700 }] },
  { id: 'milk', name: '우유 한 잔', category: '음료', price: 2000, ingredients: [{ type: 'item', itemName: '우유1L', use: 250 }] },
];
const opts = (itemNames, minMargin = null) => ({ itemNames, target: 30, minMarginOf: () => minMargin });

describe('원가 변동', () => {
  const old = [buy('p1', '2026-11-01', [item('우유 1L', 2500)])];
  const before = buildItemIndex(old);

  it('우유값이 오르면 우유를 쓰는 메뉴만, 재료 가격 변화와 함께', () => {
    const after = buildItemIndex([...old, buy('p2', '2026-11-08', [item('우유 1L', 2800)])]);
    const r = costImpact(menus, before, after, opts(['우유 1L']));
    expect(r.items).toEqual([expect.objectContaining({ name: '우유 1L', from: 2500, to: 2800 })]);
    expect(r.items[0].pct).toBeCloseTo(12);
    expect(r.menus.map((m) => m.id)).toEqual(['milk', 'latte']); // 새로 목표를 넘은 메뉴가 먼저
    const milk = r.menus[0];
    // 우유 한 잔: 원가 625 → 700, 원가율 31.25% → 35% (목표 30% 를 이미 넘음 → 계속 넘음)
    expect(milk.before.cost).toBeCloseTo(625);
    expect(milk.after.cost).toBeCloseTo(700);
    expect(milk.stillOver).toBe(true);
    expect(milk.suggest).toBe(2400); // 700 / 0.3 = 2333 → 100원 단위 올림
    const latte = r.menus[1];
    expect(latte.delta).toBeCloseTo(60);
    expect(latte.newlyOver).toBe(false);
    expect(latte.suggest).toBeNull();
    expect(r.up).toBe(2);
  });

  it('목표를 새로 넘으면 newlyOver, 최소 마진을 정했으면 더 싼 쪽을 추천', () => {
    const cheap = [buy('p1', '2026-11-01', [item('우유 1L', 2000)])];
    const b = buildItemIndex(cheap);
    const a = buildItemIndex([...cheap, buy('p2', '2026-11-08', [item('우유 1L', 2600)])]);
    const r = costImpact(menus, b, a, opts(['우유 1L'], 1500));
    const milk = r.menus.find((m) => m.id === 'milk');
    expect(milk.before.status).toBe('rate'); // 500/2000 = 25%
    expect(milk.newlyOver).toBe(true); // 650/2000 = 32.5% 이고 마진 1350 < 최소 1500 → 둘 다 못 채움
    expect(milk.suggest).toBe(2200); // 목표 기준 2167→2200, 마진 기준 2150→2200
    // 최소 마진이 1200 이면 마진 1350 으로 합격 → 알림 대상 아님
    expect(costImpact(menus, b, a, opts(['우유 1L'], 1200)).menus.find((m) => m.id === 'milk').after.status).toBe('margin');
    expect(suggestPrice({ cost: 650, missing: 0 }, 30, 1200)).toBe(1900); // 마진 기준 650+1200=1850 → 1900 (목표 원가율 기준 2200 보다 쌈)
  });

  it('예전 날짜 영수증을 넣으면(최근 단가가 그대로) 바뀐 메뉴 없음', () => {
    const after = buildItemIndex([...old, buy('p0', '2026-10-01', [item('우유 1L', 3000)])]);
    expect(costImpact(menus, before, after, opts(['우유 1L'])).menus).toEqual([]);
  });

  it('메뉴에 안 쓰는 품목만 샀으면 없음', () => {
    const after = buildItemIndex([...old, buy('p2', '2026-11-08', [item('설탕', 3000)])]);
    expect(costImpact(menus, before, after, opts(['설탕']))).toMatchObject({ items: [], menus: [] });
  });

  it('값이 내리면 down, 목표 안으로 돌아오면 recovered', () => {
    const exp = [buy('p1', '2026-11-01', [item('우유 1L', 3000)])];
    const r = costImpact(menus, buildItemIndex(exp), buildItemIndex([...exp, buy('p2', '2026-11-08', [item('우유 1L', 2200)])]), opts(['우유 1L']));
    expect(r.down).toBe(2);
    expect(r.menus.find((m) => m.id === 'milk')).toMatchObject({ recovered: true });
  });
});
