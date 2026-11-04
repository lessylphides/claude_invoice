import { describe, it, expect } from 'vitest';
import { buildItemIndex } from '../../src/lib/itemIndex.js';
import { groupByVendor, groupByCategory, paySummary, aggregateItems, pricePoints, priceStats } from '../../src/lib/aggregate.js';
import { ingredientCost, menuCost, priceForTarget, priceForMargin, currentMinMargin, judgeMenu, summarizeMenus } from '../../src/lib/cost.js';

const it_ = (name, unitPrice, extra = {}) => {
  const qty = extra.qty ?? 1;
  const discount = extra.discount ?? 0;
  return { id: name + unitPrice, name, category: extra.category ?? '주류·음료', qty, unit: '', unitPrice, discount, amount: qty * unitPrice - discount, packSize: 0, packUnit: '', ...extra };
};
const p_ = (id, date, vendor, items, extra = {}) => ({ id, date, vendor, payType: '', taxIssued: false, createdAt: Date.parse(date), items, ...extra });

const purchases = [
  p_('p1', '2026-09-20', '코스트코', [it_('몽키숄더700ML', 45990, { packSize: 700, packUnit: 'ml' }), it_('바스크치즈케이크', 17990, { category: '디저트' })]),
  p_('p2', '2026-10-28', '(주)코스트코', [it_('몽키숄더 700ml', 49790, { discount: 10000 }), it_('바스크치즈케이크', 17990, { category: '디저트', packSize: 7, packUnit: '개' }), it_('쿠폰', 0, { amount: -3000, category: '기타' })], { payType: 'tax' }),
  p_('p3', '2026-10-28', '가락청과', [it_('양파', 25000, { category: '채소' })], { payType: 'tax', taxIssued: true }),
];
const index = buildItemIndex(purchases);

describe('품목 색인', () => {
  it('표기가 달라도 같은 품목으로 묶고 최근 순', () => {
    const h = index.history('몽키숄더700ML');
    expect(h.map((r) => r.date)).toEqual(['2026-10-28', '2026-09-20']);
    expect(h[0].price).toBe(39790); // 할인 반영
  });
  it('같은 날이면 나중에 입력한 것이 최근', () => {
    const idx = buildItemIndex([p_('a', '2026-10-01', 'x', [it_('A', 100)]), { ...p_('b', '2026-10-01', 'x', [it_('A', 200)]), createdAt: Date.parse('2026-10-01') + 1 }]);
    expect(idx.history('A')[0].price).toBe(200);
  });
  it('용량은 용량이 적힌 가장 최근 기록', () => {
    expect(index.spec('몽키숄더700ML')).toEqual({ packSize: 700, packUnit: 'ml' }); // 최근 건은 용량 없음 → 이전 건
    expect(index.spec('바스크치즈케이크')).toEqual({ packSize: 7, packUnit: '개' });
    expect(index.spec('양파')).toBeNull();
    expect(index.spec('없는 품목')).toBeNull();
  });
  it('고르기 목록: 품목당 하나, 0원 이하(쿠폰) 제외', () => {
    const names = index.pickList().map((i) => i.name);
    expect(names).toHaveLength(3);
    expect(names).not.toContain('쿠폰');
  });
});

describe('집계', () => {
  it('거래처별: (주) 표기 차이를 같은 거래처로 묶고, 처음 본 표기로 보여줌', () => {
    const g = groupByVendor(purchases);
    expect(g.map((x) => [x.name, x.total, x.purchases.length])).toEqual([
      ['코스트코', 63980 + 54780, 2],
      ['가락청과', 25000, 1],
    ]);
  });
  it('항목별 합계는 금액 큰 순', () => {
    const g = groupByCategory(purchases);
    expect(g[0].name).toBe('주류·음료');
    expect(g.find((x) => x.name === '기타').total).toBe(-3000);
  });
  it('결제 구분별 합계와 미발행 거래처', () => {
    const s = paySummary(purchases);
    expect(s).toMatchObject({ tax: 79780, taxIssued: 25000, taxPending: 54780, card: 0, none: 63980 });
    expect([...s.pendingVendors.values()].map((v) => v.name)).toEqual(['(주)코스트코']);
  });
  it('같은 품목 합산', () => {
    const entries = purchases.flatMap((p) => p.items.map((item) => ({ item, purchase: p })));
    const monkey = aggregateItems(entries).find((a) => a.name.startsWith('몽키'));
    expect(monkey).toMatchObject({ qty: 2, amount: 85780, discount: 10000, count: 2 });
  });
  it('가격 추이 점과 요약', () => {
    const pts = pricePoints(index, '몽키숄더700ML');
    expect(pts.map((p) => p.price)).toEqual([45990, 39790]);
    expect(pts[1]).toMatchObject({ listPrice: 49790, discount: 10000 });
    const s = priceStats(pts);
    expect(s).toMatchObject({ diff: -6200, min: 39790, max: 45990, avg: 42890 });
    expect(s.diffPct).toBeCloseTo(-13.48, 1);
    expect(priceStats([])).toMatchObject({ last: undefined, min: null, max: null, avg: 0 });
  });
});

describe('원가 계산', () => {
  it('매입 기록의 용량 사용, 직전 매입과 비교', () => {
    const r = ingredientCost({ type: 'item', itemName: '몽키숄더700ML', use: 30 }, index);
    expect(r.cost).toBeCloseTo((39790 * 30) / 700, 6);
    expect(r.prevCost).toBeCloseTo((45990 * 30) / 700, 6);
    expect(r).toMatchObject({ pack: 700, unit: 'ml' });
  });
  it('메뉴에 적은 용량이 우선', () => {
    expect(ingredientCost({ type: 'item', itemName: '바스크치즈케이크', use: 1, packSize: 14 }, index).cost).toBeCloseTo(17990 / 14, 6);
  });
  it('계산할 수 없는 이유', () => {
    expect(ingredientCost({ type: 'item', itemName: '없음', use: 1 }, index)).toMatchObject({ cost: null, reason: '매입 기록 없음' });
    expect(ingredientCost({ type: 'item', itemName: '양파', use: 1 }, index)).toMatchObject({ cost: null, reason: '1개 용량 미입력' });
    expect(ingredientCost({ type: 'item', itemName: '양파', use: 0, packSize: 10 }, index)).toMatchObject({ cost: null, reason: '사용량 미입력' });
  });
  it('메뉴 원가율: 계산 가능한 재료만 더하고 빠진 재료 수를 셈', () => {
    const m = { price: 9000, ingredients: [{ type: 'item', itemName: '바스크치즈케이크', use: 1 }, { type: 'manual', name: '라임', cost: 900 }, { type: 'item', itemName: '양파', use: 1 }] };
    const c = menuCost(m, index);
    expect(c.cost).toBeCloseTo(17990 / 7 + 900, 6);
    expect(c.missing).toBe(1);
    expect(c.rate).toBeCloseTo(((17990 / 7 + 900) / 9000) * 100, 6);
    expect(menuCost({ price: 0, ingredients: [] }, index).rate).toBeNull();
    // 계산할 수 있는 재료가 하나도 없으면 0% 가 아니라 '계산 불가'
    expect(menuCost({ price: 5000, ingredients: [{ type: 'item', itemName: '없음', use: 1 }] }, index).rate).toBeNull();
  });
  it('목표에 맞는 판매가 (100원 올림)', () => {
    expect(priceForTarget(2570, 25)).toBe(10300);
    expect(priceForTarget(2500, 25)).toBe(10000);
  });
  it('메뉴 요약: 원가율 높은 순(계산 불가는 맨 뒤), 초과 수, 평균은 다 계산된 메뉴만', () => {
    const menus = [
      { id: 'a', price: 12000, ingredients: [{ type: 'item', itemName: '몽키숄더700ML', use: 30 }] },
      { id: 'b', price: 8000, ingredients: [{ type: 'item', itemName: '바스크치즈케이크', use: 1 }] },
      { id: 'c', price: 5000, ingredients: [{ type: 'item', itemName: '없음', use: 1 }] },
    ];
    const s = summarizeMenus(menus, index, 25);
    expect(s.rows.map((r) => r.m.id)).toEqual(['b', 'a', 'c']);
    expect(s.over).toBe(1);
    expect(s.avg).toBeCloseTo((((17990 / 7) / 8000) * 100 + (((39790 * 30) / 700) / 12000) * 100) / 2, 6);
  });
});

describe('최소 마진', () => {
  const margins = { 위스키: [{ value: 10000, at: '2026-10-01' }, { value: 12000, at: '2026-11-04' }], 디저트: [{ value: 3000, at: '2026-10-01' }, { value: 0, at: '2026-11-04' }] };
  it('분류의 현재 값 (마지막 기록, 0 이면 설정 안 함)', () => {
    expect(currentMinMargin(margins, '위스키')).toBe(12000);
    expect(currentMinMargin(margins, '디저트')).toBeNull();
    expect(currentMinMargin(margins, '칵테일')).toBeNull();
    expect(currentMinMargin(margins, '')).toBeNull();
  });
  it('판정: 원가율 합격 / 마진 기준 합격 / 초과 / 계산 불가', () => {
    const c = (cost, rate, missing = 0) => ({ cost, rate, missing });
    expect(judgeMenu(c(1705, 9.5), 18000, 25, 12000)).toMatchObject({ status: 'rate', margin: 16295 });
    expect(judgeMenu(c(15000, 55.6), 27000, 25, 12000)).toMatchObject({ status: 'margin', margin: 12000 });
    expect(judgeMenu(c(15000, 57.7), 26000, 25, 12000)).toMatchObject({ status: 'over', margin: 11000 });
    expect(judgeMenu(c(15000, 55.6), 27000, 25, null).status).toBe('over'); // 최소 마진 없으면 원가율로만
    expect(judgeMenu(c(15000, 55.6, 1), 27000, 25, 12000).status).toBe('over'); // 재료가 빠졌으면 마진 판정 안 함
    expect(judgeMenu(c(0, null), 9000, 25, 12000).status).toBe('unknown');
  });
  it('추천 판매가', () => {
    expect(priceForMargin(15000, 12000)).toBe(27000);
    expect(priceForMargin(15050, 12000)).toBe(27100);
    expect(priceForTarget(15000, 25)).toBe(60000);
  });
  it('요약: ⚠ 수와 마진 기준 충족 수를 따로 셈', () => {
    const idx = buildItemIndex([p_('w', '2026-10-01', 'x', [it_('고급위스키700ML', 350000, { packSize: 700, packUnit: 'ml' })])]);
    const ing = [{ type: 'item', itemName: '고급위스키700ML', use: 30 }]; // 원가 15,000원
    const menus = [
      { id: 'a', price: 27000, category: '위스키', ingredients: ing }, // 마진 12,000 → 충족
      { id: 'b', price: 26000, category: '위스키', ingredients: ing }, // 마진 11,000 → ⚠
      { id: 'c', price: 27000, category: '칵테일', ingredients: ing }, // 칵테일은 최소 마진 없음 → ⚠
    ];
    const s = summarizeMenus(menus, idx, 25, margins);
    expect(s.rows.map((r) => [r.m.id, r.j.status])).toEqual([['b', 'over'], ['a', 'margin'], ['c', 'over']]);
    expect(s.over).toBe(2);
    expect(s.byMargin).toBe(1);
  });
});
