// 잔·보틀 판매가를 한 메뉴에서: 카드 두 줄, 보틀 최소 마진, 상세의 추천·참고 가격, 메뉴 편집기
import { test, expect } from '@playwright/test';
import { openApp, purchase, item, sheet, closeSheet } from './helpers.js';

const data = () => ({
  version: 5,
  categories: ['주류·음료', '기타'],
  menuCategories: ['위스키', '칵테일'],
  costTarget: { history: [{ value: 25, at: '2026-11-01' }] },
  purchases: [purchase('p', '2026-10-28', '코스트코', [item('몽키숄더700ML', '주류·음료', 39790, { packSize: 700, packUnit: 'ml' })])],
  menus: [{ id: 'ms', name: '몽키숄더', price: 18000, bottlePrice: 110000, category: '위스키', ingredients: [{ id: 'a', type: 'item', itemName: '몽키숄더700ML', use: 30 }] }],
});

test('잔은 합격, 보틀은 원가율 초과 → 보틀 최소 마진을 정하면 합격', async ({ page }) => {
  const errors = await openApp(page, { data: data(), tab: 'cost' });
  const card = page.locator('.menu-card', { hasText: '몽키숄더' });
  await expect(card.locator('.mc-sub')).toContainText('판매 18,000');
  await expect(card.locator('.mc-bottle')).toHaveText('⚠ 보틀 110,000 · 원가율 36.2% · 마진 70,210');
  await expect(card).toHaveClass(/over/);
  await expect(card.locator('.mc-rate')).not.toHaveClass(/over/); // 잔 원가율은 경고색 아님
  await expect(page.locator('.cost-summary')).toContainText('목표 초과 1개');

  // 상세: 추천 보틀가와 참고 가격
  await card.click();
  const sec = sheet(page).locator('.bottle-sec');
  await expect(sec).toContainText('1병 원가39,790원');
  await expect(sec).toContainText('1병 ≈ 23잔');
  await expect(sec.locator('.suggest').first()).toContainText('원가율 25% 기준: 159,200원 이상');
  await expect(sec.locator('.suggest.ref li')).toHaveText(['잔 합계 60%: 248,400원 (23잔 × 18,000 = 414,000)', '원가 × 2: 79,600원', '원가 × 2.5: 99,500원']);
  await closeSheet(page);

  // 보틀 최소 마진 70,000 → 합격
  await page.locator('[data-cost=margins]').click();
  const s = sheet(page);
  await s.locator('input[name="위스키::bottle"]').fill('70000');
  await s.locator('.margin-form button[type=submit]').click();
  await expect(page.locator('.toast').last()).toContainText('위스키 최소 마진을 저장했습니다');
  await expect(s.locator('.target-hist')).toContainText('위스키 잔 없음 · 보틀 70,000원');
  await closeSheet(page);
  await expect(card.locator('.mc-bottle')).toContainText('✔ 마진 기준');
  await expect(card).not.toHaveClass(/over/);
  await expect(page.locator('.cost-summary')).toContainText('모두 목표 이내 · 마진 기준 충족 1개');
  await expect(page.locator('.margin-line')).toContainText('위스키 -/보틀 70,000');
  expect(errors).toEqual([]);
});

test('메뉴 편집기: 보틀 판매가를 적으면 보틀 원가율, 비우면 보틀 줄이 사라짐', async ({ page }) => {
  await openApp(page, { data: data(), tab: 'cost' });
  await page.locator('.menu-card', { hasText: '몽키숄더' }).click();
  await sheet(page).locator('[data-edit]').click();
  const s = sheet(page);
  await expect(s.locator('.bottle-bar')).toBeVisible();
  await expect(s.locator('.bsum')).toContainText('39,790원 · 36.2%');
  await expect(s.locator('.bottle-info')).toContainText('1병 ≈ 23잔');
  // 참고 금액 버튼을 누르면 보틀 판매가 칸에 들어감
  await expect(s.locator('[data-fill-bottle]')).toHaveText(['잔 합계 60%248,400', '원가 × 279,600', '원가 × 2.599,500']);
  await expect(s.locator('.fill-hint')).toContainText('위스키 분류에 보틀 최소 마진을 정하면');
  await s.locator('[data-fill-bottle="99500"]').click();
  await expect(s.locator('input[name=bottlePrice]')).toHaveValue('99500');
  await expect(s.locator('[data-fill-bottle="99500"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(s.locator('[data-fill-bottle="99500"]')).toBeFocused();
  await expect(s.locator('.bsum')).toContainText('40.0%');
  await s.locator('input[name=bottlePrice]').fill('160000');
  await expect(s.locator('.bsum')).toContainText('24.9%');
  await s.locator('input[name=bottlePrice]').fill('');
  await expect(s.locator('.bottle-bar')).toBeHidden();
  await expect(s.locator('.bottle-info')).toBeVisible(); // 참고 가격은 계속 보임
  await s.locator('button[type=submit]').click();
  await expect(page.locator('.menu-card .mc-bottle')).toHaveCount(0);
});

test('잔은 마진 기준 합격이어도 보틀이 못 채우면 카드는 경고(초록 테두리 아님)', async ({ page }) => {
  const d = data();
  d.menus[0].price = 1800; // 잔 원가율 94.7% → 잔 최소 마진 0 이면 초과지만, 아래에서 잔 최소 마진 50원
  d.minMargins = { 위스키: [{ value: 50, bottle: 0, at: '2026-11-04' }] };
  await openApp(page, { data: d, tab: 'cost' });
  const card = page.locator('.menu-card', { hasText: '몽키숄더' });
  await expect(card.locator('.mc-badge')).toContainText('마진 기준 충족');
  await expect(card).toHaveClass(/over/);
  await expect(card).not.toHaveClass(/by-margin/);
});

test('보틀 최소 마진을 정했으면: 합격선 버튼이 맨 앞, 못 미치는 금액은 ⚠', async ({ page }) => {
  const d = data();
  d.minMargins = { 위스키: [{ value: 0, bottle: 150000, at: '2026-11-04' }] };
  await openApp(page, { data: d, tab: 'cost' });
  await page.locator('.menu-card', { hasText: '몽키숄더' }).click();
  await expect(sheet(page).locator('.bottle-sec .suggest.ref li').first()).toHaveText('최소 마진선: 189,800원');
  await sheet(page).locator('[data-edit]').click();
  const s = sheet(page);
  await expect(s.locator('[data-fill-bottle]')).toHaveText(['최소 마진선189,800', '잔 합계 60%248,400', '원가 × 2⚠ 79,600', '원가 × 2.5⚠ 99,500']);
  await expect(s.locator('.fill-hint')).toHaveCount(0);
  await s.locator('[data-fill-bottle="189800"]').click();
  await expect(s.locator('.bsum')).toContainText('21.0%마진 150,010원');
});
