// 품목 이름 오타 고치기: 영수증에서 고치면 다른 기록·메뉴 재료도 같이, 가격 추이에서도 고칠 수 있음
import { test, expect } from '@playwright/test';
import { openApp, purchase, item, sheet } from './helpers.js';

const OLD = '(93)RF벨로막10Y';
const NEW = '(93)RF벤로막10Y';
const data = () => ({
  categories: ['주류·음료', '기타'],
  purchases: [
    purchase('p1', '2026-11-02', '수입사', [item(OLD, '주류·음료', 80000, { packSize: 700, packUnit: 'ml' })]),
    purchase('p2', '2026-11-03', '수입사', [item(OLD, '주류·음료', 85580, { packSize: 700, packUnit: 'ml' })]),
  ],
  menus: [{ id: 'm', name: '벤로막 10년', category: '', price: 18000, ingredients: [{ id: 'g', type: 'item', itemName: OLD, use: 30 }] }],
});

test.beforeEach(async ({ page }) => {
  await page.route('**/api/level**', (r) => r.fulfill({ contentType: 'application/json', body: '{"gifts":[]}' }));
  await page.route('**/api/notices', (r) => r.fulfill({ contentType: 'application/json', body: '{"notices":[]}' }));
});

test('영수증에서 이름을 고치면 → 다른 기록·메뉴 재료도 같이 고칠지 묻고, 모두 고침', async ({ page }) => {
  const errors = await openApp(page, { data: data() });
  await page.locator('.cell[data-date="2026-11-03"]').click();
  await sheet(page).locator('[data-edit="p2"]').click();
  await sheet(page).locator('input[data-f=name]').first().fill(NEW);
  await sheet(page).locator('button[type=submit]').click();
  const ask = page.locator('.sheet[aria-label="품목 이름을 고쳤어요"]');
  await expect(ask).toContainText('다른 매입 기록 1건');
  await expect(ask).toContainText('메뉴 재료 1개');
  await ask.locator('[data-r=all]').click();
  await expect(page.locator('.toast').last()).toContainText('고쳤어요');
  await expect(page.locator('.sheet[aria-label="품목 이름을 고쳤어요"]')).toHaveCount(0);
  while (await page.locator('.sheet-wrap').count()) await page.locator('.sheet-wrap .close').last().click();
  await page.locator('.tabbar button').nth(1).click();
  await page.locator('[data-cost-open="m"]').click();
  await expect(sheet(page)).toContainText(NEW);
  await expect(sheet(page)).not.toContainText(OLD);
  expect(errors).toEqual([]);
});

test('이 영수증만 고르면 다른 기록·메뉴는 그대로', async ({ page }) => {
  await openApp(page, { data: data() });
  await page.locator('.cell[data-date="2026-11-03"]').click();
  await sheet(page).locator('[data-edit="p2"]').click();
  await sheet(page).locator('input[data-f=name]').first().fill('다른 위스키');
  await sheet(page).locator('button[type=submit]').click();
  await page.locator('.sheet[aria-label="품목 이름을 고쳤어요"] [data-r=one]').click();
  await expect(page.locator('.sheet[aria-label="품목 이름을 고쳤어요"]')).toHaveCount(0);
  while (await page.locator('.sheet-wrap').count()) await page.locator('.sheet-wrap .close').last().click();
  await page.locator('.tabbar button').nth(1).click();
  await page.locator('[data-cost-open="m"]').click();
  await expect(sheet(page)).toContainText(OLD);
});

test('가격 추이에서 이름 고치기: 이미 오타 이름으로 묶여 있어도 정리됨', async ({ page }) => {
  const d = data();
  d.purchases[1].items[0].name = NEW; // 고친 이름이 오타 이름 아래로 묶인 상태
  d.itemLinks = { '(93)rf벤로막10y': OLD };
  await openApp(page, { data: d });
  await page.locator('.cell[data-date="2026-11-02"]').click();
  await sheet(page).locator('[data-trend]').first().click();
  await expect(page.locator('.sheet-wrap').last()).toContainText('가격 추이');
  const answers = [NEW, true];
  page.on('dialog', (dlg) => dlg.accept(dlg.type() === 'prompt' ? String(answers[0]) : undefined));
  await sheet(page).locator('[data-rename]').click();
  await expect(page.locator('.sheet-wrap').last()).toContainText(`${NEW} 가격 추이`);
  while (await page.locator('.sheet-wrap').count()) await page.locator('.sheet-wrap .close').last().click();
  await page.locator('.tabbar button').nth(1).click();
  await page.locator('[data-cost-open="m"]').click();
  await expect(sheet(page)).toContainText(NEW);
  await expect(sheet(page)).not.toContainText(OLD);
});
