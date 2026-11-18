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
  it('싼 메뉴: 원가율 가격이 더 낮으면 최소 = 목표', () => {
    expect(glassPriceGuide(3000, 25, 16000)).toEqual({ min: 12000, goal: 12000, minBy: 'rate' });
  });
  it('최소 마진이 없거나 일부 재료가 빠졌으면 원가율 기준만', () => {
    expect(glassPriceGuide(9546, 25, null)).toEqual({ min: 39000, goal: 39000, minBy: 'rate' });
    expect(glassPriceGuide(9546, 25, 16000, 1)).toEqual({ min: 39000, goal: 39000, minBy: 'rate' });
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
