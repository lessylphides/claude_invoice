import { describe, it, expect } from 'vitest';
import { applyCategoryEdit, groupRowsByCategory, filterMenus } from '../../src/lib/menuCategories.js';

const before = ['커피', '위스키', '칵테일'];
const menus = [
  { id: 'a', category: '커피' },
  { id: 'b', category: '위스키' },
  { id: 'c', category: '칵테일' },
  { id: 'd', category: '' },
];

describe('메뉴 분류 편집', () => {
  it('순서 바꾸기·추가', () => {
    const r = applyCategoryEdit(menus, [{ orig: '위스키', name: '위스키' }, { orig: '커피', name: '커피' }, { orig: '칵테일', name: '칵테일' }, { orig: null, name: '맥주' }], before);
    expect(r.categories).toEqual(['위스키', '커피', '칵테일', '맥주']);
    expect(r.menus).toEqual(menus);
    expect(r.moved).toBe(0);
  });
  it('이름을 바꾸면 그 분류의 메뉴도 따라감', () => {
    const r = applyCategoryEdit(menus, [{ orig: '커피', name: '에스프레소 ' }, { orig: '위스키', name: '위스키' }, { orig: '칵테일', name: '칵테일' }], before);
    expect(r.categories).toEqual(['에스프레소', '위스키', '칵테일']);
    expect(r.menus.find((m) => m.id === 'a').category).toBe('에스프레소');
  });
  it('지우면 그 분류의 메뉴는 미분류로 (메뉴는 남음)', () => {
    const r = applyCategoryEdit(menus, [{ orig: '커피', name: '커피' }, { orig: '칵테일', name: '칵테일' }], before);
    expect(r.categories).toEqual(['커피', '칵테일']);
    expect(r.menus.find((m) => m.id === 'b').category).toBe('');
    expect(r.moved).toBe(1);
    expect(r.menus).toHaveLength(4);
  });
  it('빈 이름·중복·예약어는 빼고, 같은 이름으로 바꾸면 합쳐짐', () => {
    const r = applyCategoryEdit(menus, [{ orig: '커피', name: '칵테일' }, { orig: '위스키', name: '' }, { orig: '칵테일', name: '칵테일' }, { orig: null, name: '전체' }], before);
    expect(r.categories).toEqual(['칵테일']);
    expect(r.menus.map((m) => m.category)).toEqual(['칵테일', '', '칵테일', '']);
  });
});

describe('분류별 묶기·거르기', () => {
  const rows = [{ m: { id: 'x', category: '칵테일' } }, { m: { id: 'y', category: '' } }, { m: { id: 'z', category: '커피' } }, { m: { id: 'w', category: '없어진분류' } }];
  it('분류 순서대로, 빈 분류는 빼고, 미분류는 맨 뒤', () => {
    const g = groupRowsByCategory(rows, before);
    expect(g.map((x) => [x.name, x.rows.map((r) => r.m.id)])).toEqual([
      ['커피', ['z']],
      ['칵테일', ['x']],
      ['미분류', ['y', 'w']],
    ]);
  });
  it('필터', () => {
    const ms = rows.map((r) => r.m);
    expect(filterMenus(ms, '전체', before)).toHaveLength(4);
    expect(filterMenus(ms, '커피', before).map((m) => m.id)).toEqual(['z']);
    expect(filterMenus(ms, '미분류', before).map((m) => m.id)).toEqual(['y', 'w']);
  });
});

describe('분류 편집과 최소 마진 기록', () => {
  const margins = { 커피: [{ value: 3000, at: '2026-11-01' }], 위스키: [{ value: 12000, at: '2026-11-01' }] };
  it('이름을 바꾸면 기록도 따라가고, 지운 분류의 기록은 버림', () => {
    const r = applyCategoryEdit([], [{ orig: '위스키', name: '싱글몰트' }, { orig: '칵테일', name: '칵테일' }], ['커피', '위스키', '칵테일'], margins);
    expect(r.margins).toEqual({ 싱글몰트: [{ value: 12000, at: '2026-11-01' }] });
  });
});
