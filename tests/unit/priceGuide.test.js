// 잔 가격 정하기: 최소 가격(합격선)·목표 가격·가게 기준 가격
import { describe, it, expect } from 'vitest';
import { glassPriceGuide, housePosition, housePrice, judgeMenu } from '../../src/lib/cost.js';

describe('잔 가격 정하기', () => {
  it('비싼 위스키: 최소는 마진 기준, 목표는 원가율 기준 (1,000원 올림)', () => {
    const g = glassPriceGuide(9546, 25, 16000);
    expect(g).toEqual({ min: 26000, goal: 39000, minBy: 'margin' });
    // 최소 가격이면 원가 탭 판정도 합격, 1,000원 내리면 ⚠
    expect(judgeMenu({ cost: 9546, rate: (9546 / 26000) * 100, missing: 0 }, 26000, 25, 16000).status).toBe('margin');
    expect(judgeMenu({ cost: 9546, rate: (9546 / 25000) * 100, missing: 0 }, 25000, 25, 16000).status).toBe('over');
  });
  it('싼 메뉴: 원가율로는 12,000원이어도 최소 마진 16,000원이 바닥 → 최소 = 목표 = 19,000원', () => {
    expect(glassPriceGuide(3000, 25, 16000)).toEqual({ min: 19000, goal: 19000, minBy: 'margin' });
    // 벤로막(원가 3,668): 15,000원은 원가율 24.5%여도 마진 11,332원이라 ⚠, 20,000원부터 ✓
    expect(glassPriceGuide(3668, 25, 16000)).toEqual({ min: 20000, goal: 20000, minBy: 'margin' });
    expect(judgeMenu({ cost: 3668, rate: (3668 / 15000) * 100, missing: 0 }, 15000, 25, 16000).status).toBe('over');
    expect(judgeMenu({ cost: 3668, rate: (3668 / 20000) * 100, missing: 0 }, 20000, 25, 16000).status).toBe('rate');
  });
  it('최소 마진을 올리면 추천도 바로 올라가고, 없애면 원가율만', () => {
    expect(glassPriceGuide(9546, 25, 16000).min).toBe(26000);
    expect(glassPriceGuide(9546, 25, 20000).min).toBe(30000);
    expect(glassPriceGuide(9546, 25, 30000)).toEqual({ min: 40000, goal: 40000, minBy: 'margin' }); // 마진 기준이 목표보다 높으면 목표도 같이
    expect(glassPriceGuide(3668, 25, null)).toEqual({ min: 15000, goal: 15000, minBy: 'rate' });
    expect(judgeMenu({ cost: 3668, rate: (3668 / 15000) * 100, missing: 0 }, 15000, 25, null).status).toBe('rate');
  });
  it('최소 마진이 없거나 일부 재료가 빠졌으면 원가율 기준만', () => {
    expect(glassPriceGuide(9546, 25, null)).toEqual({ min: 39000, goal: 39000, minBy: 'rate' });
    expect(glassPriceGuide(9546, 25, 16000, 1)).toEqual({ min: 39000, goal: 39000, minBy: 'rate' }); // 재료가 빠지면 두 기준 중 높은 값
    expect(glassPriceGuide(0, 25, 16000)).toBeNull();
  });
  it('가게 기준: 같은 분류 메뉴들이 최소~목표 사이 어디쯤 파는지(중간값)로 새 메뉴 가격', () => {
    const others = [
      { price: 33000, cost: 9546, missing: 0, minMargin: 16000 }, // 26,000~39,000 중 7/13
      { price: 28000, cost: 6902, missing: 0, minMargin: 16000 }, // 23,000~28,000 중 1
      { price: 27000, cost: 6468, missing: 0, minMargin: 16000 }, // 23,000~26,000 → 1.33
      { price: 0, cost: 5000, missing: 0, minMargin: 16000 }, // 판매가 없음 → 뺌
    ];
    const h = housePosition(others, 25);
    expect(h.count).toBe(3);
    expect(h.position).toBe(1);
    expect(housePrice({ min: 26000, goal: 39000 }, 0.5)).toBe(33000);
    expect(housePrice({ min: 26000, goal: 39000 }, 0)).toBe(26000);
    expect(housePosition(others.slice(0, 1), 25)).toBeNull();
  });
});

import { commonPour } from '../../src/lib/cost.js';
describe('한 잔 양 미리 채우기', () => {
  const ing = (use, unit = '') => ({ type: 'item', itemName: 'x', use, unit });
  it('같은 분류에서 가장 많이 쓰는 양 (2개 이상일 때만, 단위는 매입 기록에서)', () => {
    const menus = [
      { category: '위스키', ingredients: [ing(30)] },
      { category: '위스키', ingredients: [ing(30)] },
      { category: '위스키', ingredients: [ing(45)] },
      { category: '칵테일', ingredients: [ing(45, 'ml'), ing(45, 'ml')] },
    ];
    expect(commonPour(menus, '위스키', () => ({ packUnit: 'ml' }))).toEqual({ use: 30, unit: 'ml', count: 2 });
    expect(commonPour(menus, '칵테일')).toEqual({ use: 45, unit: 'ml', count: 2 });
    expect(commonPour(menus.slice(2, 3), '위스키')).toBeNull();
    expect(commonPour(menus, '')).toBeNull();
  });
});

import { commonPack } from '../../src/lib/cost.js';
describe('1개 용량 미리 채우기', () => {
  it('같은 분류에서 가장 많이 쓰는 용량 (메뉴에 적은 값, 없으면 매입 기록)', () => {
    const specs = { a: { packSize: 700, packUnit: 'ml' }, b: { packSize: 700, packUnit: 'ml' }, c: { packSize: 750, packUnit: 'ml' } };
    const menus = ['a', 'b', 'c'].map((n) => ({ category: '위스키', ingredients: [{ type: 'item', itemName: n, use: 30 }] }));
    expect(commonPack(menus, '위스키', (n) => specs[n])).toEqual({ packSize: 700, unit: 'ml', count: 2 });
    expect(commonPack(menus.slice(2), '위스키', (n) => specs[n])).toBeNull();
  });
});
