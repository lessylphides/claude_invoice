// 잔 가격 정하기: 최소 가격(합격선)·가게 기준·목표 가격, 누르면 판매가에 들어가고 판정과 맞음
import { test, expect } from '@playwright/test';
import { openApp, purchase, item, sheet } from './helpers.js';

const data = () => ({
  version: 3,
  categories: ['주류·음료', '기타'],
  menuCategories: ['위스키', '칵테일'],
  costTarget: { history: [{ value: 25, at: '2026-11-01' }] },
  minMargins: { 위스키: [{ value: 16000, bottle: 0, at: '2026-11-01' }] },
  purchases: [
    purchase('p', '2026-10-28', '주류도매', [
      item('아부나흐700ML', '주류·음료', 222740, { packSize: 700, packUnit: 'ml' }), // 30ml = 9,546원
      item('발베니700ML', '주류·음료', 161047, { packSize: 700, packUnit: 'ml' }), // 30ml = 6,902원
      item('부커스750ML', '주류·음료', 161700, { packSize: 750, packUnit: 'ml' }), // 30ml = 6,468원
    ]),
  ],
  menus: [
    { id: 'a', name: '아부나흐', price: 33000, category: '위스키', ingredients: [{ id: 'g1', type: 'item', itemName: '아부나흐700ML', use: 30 }] },
    { id: 'b', name: '발베니', price: 26000, category: '위스키', ingredients: [{ id: 'g2', type: 'item', itemName: '발베니700ML', use: 30 }] },
    { id: 'c', name: '부커스', price: 25000, category: '위스키', ingredients: [{ id: 'g3', type: 'item', itemName: '부커스750ML', use: 30 }] },
  ],
});

test('메뉴 수정: 최소·가게 기준·목표 가격, 누르면 판매가에 들어감', async ({ page }) => {
  await page.route('**/api/level**', (r) => r.fulfill({ contentType: 'application/json', body: '{"gifts":[]}' }));
  const errors = await openApp(page, { data: data(), tab: 'cost' });
  await page.locator('[data-cost-open="a"]').click();
  await sheet(page).getByRole('button', { name: /수정/ }).first().click();
  const g = sheet(page).locator('.price-guide');
  await expect(g).toContainText('잔 원가 9,546원');
  await expect(g.locator('[data-fill-glass]')).toHaveCount(3);
  await expect(g.locator('[data-fill-glass]').nth(0)).toContainText('최소 가격26,000');
  await expect(g.locator('[data-fill-glass]').nth(2)).toContainText('목표 가격39,000');
  await expect(g).toContainText('같은 분류 메뉴 2개');
  await expect(g.locator('.pg-now')).toContainText('✓ 최소 가격 이상');
  await g.locator('[data-fill-glass="26000"]').click();
  await expect(sheet(page).locator('input[name=price]')).toHaveValue('26000');
  await expect(g.locator('[data-fill-glass="26000"]')).toHaveAttribute('aria-pressed', 'true');
  await sheet(page).locator('input[name=price]').fill('25000');
  await expect(g.locator('.pg-now')).toContainText('최소 가격보다 1,000원 낮아요');
  expect(errors).toEqual([]);
});
