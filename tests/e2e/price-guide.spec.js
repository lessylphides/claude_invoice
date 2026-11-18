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

test('새 메뉴: 한 잔 양을 넣기 전에는 안내, 넣으면 추천 가격', async ({ page }) => {
  await page.route('**/api/level**', (r) => r.fulfill({ contentType: 'application/json', body: '{"gifts":[]}' }));
  await openApp(page, { data: data(), tab: 'cost' });
  await page.locator('[data-cost=add]').click();
  const s = page.locator('.sheet[aria-label="메뉴 추가"]');
  await s.locator('[data-add=item]').click(); // 품목 고르기 화면이 바로 열림
  await page.locator('.sheet[aria-label="매입 품목 선택"]').getByText('아부나흐700ML').click();
  await expect(s.locator('.price-guide')).toContainText('한 잔에 쓰는 양');
  await s.locator('input[data-f=use]').fill('30');
  await expect(s.locator('.price-guide [data-fill-glass]').first()).toContainText('최소 가격');
});

test('새 메뉴: 이름 → 분류 → 재료 순서, 위스키를 고르면 한 잔 양(30ml)이 미리 채워지고 추천 가격이 바로 나옴', async ({ page }) => {
  await page.route('**/api/level**', (r) => r.fulfill({ contentType: 'application/json', body: '{"gifts":[]}' }));
  await openApp(page, { data: data(), tab: 'cost' });
  await page.locator('[data-cost=add]').click();
  const s = page.locator('.sheet[aria-label="메뉴 추가"]');
  // 화면 순서: 이름 → 분류 → 재료 → 잔 원가 → 잔 판매가 → 보틀
  const order = await s.evaluate((el) => ['input[name=name]', '.cat-pick', '.ings', '.total-bar', 'input[name=price]', '.bottle-open'].map((q) => el.querySelector(q).getBoundingClientRect().top));
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  await expect(s.locator('input[name=price]')).toHaveAttribute('placeholder', /예:/);
  await s.locator('.cat-pick label', { hasText: '위스키' }).click();
  await s.locator('[data-add=item]').click();
  await page.locator('.sheet[aria-label="매입 품목 선택"]').getByText('발베니700ML').click();
  await expect(s.locator('input[data-f=use]')).toHaveValue('30');
  await expect(s.locator('.pour-note')).toContainText('30ml');
  await expect(s.locator('.price-guide [data-fill-glass]').first()).toContainText('최소 가격');
});

test('메뉴 수정: 열면 잔 원가·판매가가 바로 보이게 내려가 있음', async ({ page }) => {
  await page.route('**/api/level**', (r) => r.fulfill({ contentType: 'application/json', body: '{"gifts":[]}' }));
  await page.setViewportSize({ width: 390, height: 640 });
  await openApp(page, { data: data(), tab: 'cost' });
  await page.locator('[data-cost-open="a"]').click();
  await sheet(page).getByRole('button', { name: /수정/ }).first().click();
  const s = page.locator('.sheet[aria-label="메뉴 수정"]');
  await expect(s.locator('input[name=price]')).toBeInViewport();
});
