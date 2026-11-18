// 품목 이름 고치기: 매입 기록·메뉴 재료·묶음의 같은 이름을 한 번에
import { describe, it, expect } from 'vitest';
import { renameItemInData, renameCounts } from '../../src/lib/itemRename.js';
import { buildItemIndex } from '../../src/lib/itemIndex.js';

const item = (name, unitPrice = 85580) => ({ id: name + unitPrice, name, category: '주류·음료', qty: 1, unit: '', unitPrice, discount: 0, amount: unitPrice, packSize: 700, packUnit: 'ml' });
const data = () => ({
  purchases: [
    { id: 'p1', date: '2026-11-06', vendor: 'A', createdAt: 1, items: [item('(93)RF벨로막10Y', 80000), item('레몬', 900)] },
    { id: 'p2', date: '2026-11-18', vendor: 'A', createdAt: 2, items: [item('(93)RF벤로막10Y', 85580)] },
  ],
  menus: [{ id: 'm', name: '벤로막 10', price: 18000, ingredients: [{ id: 'g', type: 'item', itemName: '(93)RF벨로막10Y', use: 30 }] }],
  // 저장할 때 '같은 품목'이라고 답해서 고친 이름이 오타 이름 아래로 묶인 상태
  itemLinks: { [`(93)rf벤로막10y`]: '(93)RF벨로막10Y' },
  itemNotSame: [],
});

describe('품목 이름 고치기', () => {
  it('오타 이름을 쓰는 매입·메뉴·묶음을 모두 새 이름으로, 묶음은 정리', () => {
    const d = data();
    d.itemLinks = { [Object.keys(d.itemLinks)[0].replace('(93)rf벤로막10y', '(93)rf벤로막10y')]: '(93)RF벨로막10Y' };
    expect(renameCounts(d, '(93)RF벨로막10Y')).toEqual({ purchases: 1, menus: 1 });
    const r = renameItemInData(d, '(93)RF벨로막10Y', '(93)RF벤로막10Y');
    expect(r).toEqual({ purchases: 1, items: 1, menus: 1 });
    expect(d.purchases[0].items[0].name).toBe('(93)RF벤로막10Y');
    expect(d.purchases[0].items[1].name).toBe('레몬');
    expect(d.menus[0].ingredients[0].itemName).toBe('(93)RF벤로막10Y');
    expect(d.itemLinks).toEqual({}); // 벤로막 → 벤로막 은 자기 자신이라 사라짐
    const idx = buildItemIndex(d.purchases, d.itemLinks);
    expect(idx.history('(93)RF벤로막10Y').map((h) => h.price)).toEqual([85580, 80000]);
    expect(idx.pickList().find((x) => x.name.includes('로막')).name).toBe('(93)RF벤로막10Y');
  });
  it('이름이 같거나 비어 있으면 아무것도 안 바꿈', () => {
    const d = data();
    expect(renameItemInData(d, '레몬', ' 레몬 ')).toEqual({ purchases: 0, items: 0, menus: 0 });
    expect(renameItemInData(d, '레몬', '')).toEqual({ purchases: 0, items: 0, menus: 0 });
  });
});
