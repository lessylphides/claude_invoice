// 운영비 · 투자 회수: 월 회수액, 본전 매출, 실제 회수율, 투자 후보
import { describe, it, expect } from 'vitest';
import { averageCostRate, breakEven, monthCosts, exemptShareFromLedger, sanitizeOps, investMonthly, investPlanned, opsSummary, actualRecovery, investCandidates, monthPurchaseCost } from '../../src/lib/ops.js';
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
  it('한 달에 필요한 돈 (고정비 + 투자 회수)', () => {
    const s = opsSummary(ops(), '2026-11');
    expect(s).toMatchObject({ fixed: 6000000, invest: 625000 + 100000 + 83333 + 120000 });
    expect(s.need).toBe(6000000 + 928333);
    expect(sanitizeOps({ targetProfit: 5 })).not.toHaveProperty('targetProfit'); // 예전 값은 버림
    expect(s).not.toHaveProperty('perGlass'); // 잔 수 평균은 안 씀
    expect(sanitizeOps({ monthlyGlasses: 1500 }).monthlyGlasses).toBe(1500); // 예전 값은 보관
    expect(sanitizeOps({}).workDays).toBe(26);
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
  it('본전 매출: 재료비 + 부가세(남긴 부분 × 10/110 − 카드 공제) + 수수료 + 고정 지출을 메우는 매출', () => {
    const o = sanitizeOps({ fixed: [{ name: '월세', amount: 2500000 }, { name: '인건비', amount: 6487500 }], invests: [{ name: '잔', amount: 300000, months: 24, start: '2026-11' }], workDays: 25 });
    expect(o.fixed.map((f) => f.vat)).toEqual([true, false]); // 인건비는 부가세 공제 없음 (이름으로 짐작)
    expect(o).toMatchObject({ feeRate: 2, cardShare: 90, exemptShare: 0 });
    const s = opsSummary(o, '2026-11');
    expect(s).toMatchObject({ need: 9000000, vatBase: 2512500 });
    const be = breakEven(s, 25, o);
    expect(be).toMatchObject({ month: 13023540, day: 520942, fixed: 9000000 });
    expect(be.material + be.vat + be.fee + be.fixed).toBeGreaterThanOrEqual(be.month - 2);
    expect(be.material + be.vat + be.fee + be.fixed).toBeLessThanOrEqual(be.month);
    // 사장님 예시: 매출 1,000만, 재료 192만(19.2%), 임대료 135만(공제) → 부가세 611,818 (카드 공제·수수료 없이)
    expect(Math.round(monthCosts(10000000, { costRate: 19.2, need: 1350000, vatBase: 1350000, cardShare: 0, feeRate: 0 }).vat)).toBe(611818);
    // 면세 재료가 많으면 공제가 줄어 부가세가 늘어남
    expect(monthCosts(10000000, { costRate: 19.2, need: 0, vatBase: 0, exemptShare: 50 }).vat).toBeGreaterThan(monthCosts(10000000, { costRate: 19.2, need: 0, vatBase: 0 }).vat);
    expect(breakEven({ need: 0, vatBase: 0 }, 25)).toBeNull();
    expect(averageCostRate([20, 30, null, 25], 25)).toEqual({ rate: 25, from: 'menus', count: 3 });
    expect(averageCostRate([10, null], 28)).toEqual({ rate: 28, from: 'target', count: 1 }); // 메뉴가 적으면 목표 원가율
  });
  it('장부로 면세 재료 비율 짐작 (최근 3달, 비품·광고 빼고)', () => {
    const ps = [
      { id: 'a', date: '2026-10-05', items: [{ id: '1', name: '레몬', category: '채소·과일', amount: 30000 }, { id: '2', name: '진', category: '주류·음료', amount: 70000 }, { id: '3', name: '잔', category: '비품·집기', amount: 500000 }] },
      { id: 'b', date: '2026-06-01', items: [{ id: '4', name: '사과', category: '채소·과일', amount: 999999 }] },
    ];
    expect(exemptShareFromLedger(ps, '2026-11')).toBe(30);
    expect(exemptShareFromLedger([], '2026-11')).toBeNull();
  });
});
