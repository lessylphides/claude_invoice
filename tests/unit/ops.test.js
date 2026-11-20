// 운영비 · 투자 회수: 월 회수액, 잔당 최소 마진, 실제 회수율, 투자 후보
import { describe, it, expect } from 'vitest';
import { sanitizeOps, investMonthly, investPlanned, opsSummary, actualRecovery, investCandidates, monthPurchaseCost } from '../../src/lib/ops.js';
import { migrate } from '../../src/lib/model.js';
import { buildItemIndex } from '../../src/lib/itemIndex.js';

const ops = () =>
  sanitizeOps({
    fixed: [{ name: '월세', amount: 2500000 }, { name: '인건비', amount: 3000000 }, { name: '공과금', amount: 500000 }],
    invests: [
      { name: '인테리어', amount: 30000000, months: 48, start: '2025-11' },
      { name: '제빙기', amount: 6000000, months: 60, start: '2026-03' },
      { name: '잔·집기', amount: 2000000, months: 24, start: '2026-11' },
      { name: '잔 깨짐 보충', ongoing: true, monthly: 120000 },
    ],
    monthlyGlasses: 1500,
  });

describe('운영비 · 투자 회수', () => {
  it('월 회수액: 회수 기간 안에서만, 계속 항목은 매달', () => {
    const o = ops();
    expect(investMonthly(o.invests[0], '2026-11')).toBe(625000);
    expect(investMonthly(o.invests[0], '2029-11')).toBe(0); // 48개월 끝
    expect(investMonthly(o.invests[1], '2026-02')).toBe(0); // 시작 전
    expect(investMonthly(o.invests[3], '2030-01')).toBe(120000);
    expect(investPlanned(o.invests[0], '2026-10')).toMatchObject({ done: 12, months: 48, ratio: 0.25 });
  });
  it('한 달에 필요한 돈 ÷ 예상 판매 잔 수 = 잔당 최소 마진 (올림)', () => {
    const s = opsSummary(ops(), '2026-11');
    expect(s).toMatchObject({ fixed: 6000000, invest: 625000 + 100000 + 83333 + 120000 });
    expect(s.need).toBe(6000000 + 928333);
    expect(sanitizeOps({ targetProfit: 5 })).not.toHaveProperty('targetProfit'); // 예전 값은 버림
    expect(s.perGlass).toBe(Math.ceil(s.need / 1500)); // 4,619원
    expect(opsSummary(sanitizeOps({ fixed: [{ name: 'x', amount: 100 }] }), '2026-11').perGlass).toBeNull(); // 판매 잔 수 모름
  });
  it('월 매출을 넣으면 실제 남은 돈(매출 − 매입(투자 제외) − 고정비)으로 투자 회수율', () => {
    const o = sanitizeOps({ ...ops(), sales: { '2026-10': 20000000, '2026-11': 8000000 } });
    const purchases = [
      { id: 'p', date: '2026-10-05', items: [{ id: 'a', name: '위스키', category: '주류·음료', amount: 5000000 }, { id: 'b', name: '하이볼잔 24개', category: '비품·집기', amount: 300000 }] },
      { id: 'q', date: '2026-11-02', items: [{ id: 'c', name: '레몬', category: '채소·과일', amount: 2500000 }] },
    ];
    expect(monthPurchaseCost(purchases, '2026-10')).toBe(5000000); // 잔은 투자라서 뺌
    const r = actualRecovery(o, purchases);
    expect(r.rows.map((x) => x.left)).toEqual([20000000 - 5000000 - 6000000, 8000000 - 2500000 - 6000000]);
    expect(r.recovered).toBe(9000000); // 적자 달은 0
    expect(r.total).toBe(38000000);
    expect(r.ratio).toBeCloseTo(9000000 / 38000000);
  });
  it('투자 후보: 비품·시설 매입 중 아직 안 넣은 것, 넣으면 빠짐', () => {
    const purchases = [{ id: 'p', date: '2026-11-03', vendor: '주방몰', items: [{ id: 'a', name: '하이볼잔', category: '비품·집기', amount: 300000 }, { id: 'b', name: '레몬', category: '채소·과일', amount: 9000 }] }];
    expect(investCandidates(purchases, sanitizeOps({})).map((c) => c.key)).toEqual(['p:a']);
    expect(investCandidates(purchases, sanitizeOps({ invests: [{ name: '하이볼잔', amount: 300000, from: 'p:a' }] }))).toEqual([]);
  });
  it('장부를 불러오면 ops 가 생기고, 비품·시설 매입은 메뉴 재료 목록에 안 나옴', () => {
    const d = migrate({ version: 6, purchases: [{ id: 'p', date: '2026-11-03', vendor: 'v', items: [{ id: 'a', name: '하이볼잔', category: '비품·집기', qty: 1, unitPrice: 300000, amount: 300000 }, { id: 'b', name: '레몬', category: '채소·과일', qty: 1, unitPrice: 900, amount: 900 }] }], categories: ['채소·과일', '기타'] });
    expect(d.ops).toMatchObject({ fixed: [], invests: [], monthlyGlasses: 0 });
    expect(d.categories).toEqual(['채소·과일', '비품·집기', '시설·장비', '광고·운영비', '기타']);
    expect(buildItemIndex(d.purchases).pickList().map((x) => x.name)).toEqual(['레몬']);
  });
  it('광고비: 기타로 적힌 광고 매입은 광고·운영비로 옮기고, 재료가 아닌 그달 운영비로 셈', () => {
    const d = migrate({ version: 7, categories: ['주류·음료', '기타'], purchases: [
      { id: 'p', date: '2026-10-31', vendor: '네이버', items: [{ id: 'a', name: '네이버 플레이스 광고', category: '기타', qty: 1, unitPrice: 1309875, amount: 1309875 }] },
      { id: 'q', date: '2026-10-05', vendor: '도매', items: [{ id: 'b', name: '진', category: '주류·음료', qty: 1, unitPrice: 30000, amount: 30000 }, { id: 'c', name: '빨대', category: '기타', qty: 1, unitPrice: 5000, amount: 5000 }] },
    ] });
    expect(d.categories).toEqual(['주류·음료', '광고·운영비', '기타']);
    expect(d.purchases[0].items[0].category).toBe('광고·운영비');
    expect(d.purchases[1].items[1].category).toBe('기타'); // 광고 아닌 기타는 그대로
    expect(buildItemIndex(d.purchases).pickList().map((x) => x.name).sort()).toEqual(['빨대', '진']);
    expect(monthPurchaseCost(d.purchases, '2026-10')).toBe(35000);
    const r = actualRecovery(sanitizeOps({ fixed: [{ name: '월세', amount: 1000000 }], sales: { '2026-10': 3000000 } }), d.purchases);
    expect(r.rows[0]).toMatchObject({ purchase: 35000, opex: 1309875, left: 3000000 - 35000 - 1000000 - 1309875 });
    // 이미 v8 인 장부는 다시 옮기지 않음 (사장님이 기타로 되돌린 것 존중)
    const again = migrate({ ...d, purchases: [{ ...d.purchases[0], items: [{ ...d.purchases[0].items[0], category: '기타' }] }] });
    expect(again.purchases[0].items[0].category).toBe('기타');
  });
});
