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
  await expect(sheet(page).locator('.stats').first()).toContainText('잔 판매가18,000원');
  await expect(sheet(page).locator('.stats').first()).toContainText('잔 원가1,705원');
  await expect(sec).toContainText('보틀 원가39,790원');
  await expect(sec.locator('h3')).toHaveCount(0); // '보틀 판매' 제목 없음 (바로 아래 '보틀 판매가'와 중복)
  await expect(sec).not.toContainText('코스트코'); // 매입처·날짜는 재료별 원가에만
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

test('보틀로 안 파는 메뉴(커피)는 보틀 칸·추천이 숨겨져 있고, [+ 보틀로도 판매]로 펼침 · 사용량 칸은 비어 있음', async ({ page }) => {
  const d = data();
  d.menuCategories = ['위스키', '커피'];
  d.purchases.push(purchase('q', '2026-10-29', '커피상인', [item('바닐라시럽 1kg', '기타', 11400, { packSize: 1000, packUnit: 'g' })]));
  d.menus.push({ id: 'latte', name: '바닐라라떼', price: 6000, category: '커피', ingredients: [{ id: 'v', type: 'item', itemName: '바닐라시럽 1kg', use: 12 }] });
  await openApp(page, { data: d, tab: 'cost' });
  await page.locator('.menu-card', { hasText: '바닐라라떼' }).click();
  await sheet(page).locator('[data-edit]').click();
  const form = page.locator('.menu-editor');
  await expect(form.locator('.bottle-price')).toBeHidden();
  await expect(form.locator('.bottle-info')).toBeHidden(); // '보틀 기준… 1병 ≈ 잔' 추천 없음
  // 사용량 칸에 30 같은 예시 숫자를 미리 보여 주지 않음 (진짜 값으로 착각)
  expect(await form.locator('[data-f=use]').evaluateAll((els) => els.map((e) => e.getAttribute('placeholder')))).toEqual([null]);
  await form.locator('.bottle-open').click();
  await expect(form.locator('.bottle-price')).toBeVisible();
  await expect(form.locator('.bottle-info')).toBeVisible();
});

test('보틀 최소 마진이 있는 분류(위스키)나 보틀 판매가가 있는 메뉴는 보틀 칸이 바로 보임', async ({ page }) => {
  await openApp(page, { data: data(), tab: 'cost' });
  await page.locator('.menu-card', { hasText: '몽키숄더' }).click();
  await sheet(page).locator('[data-edit]').click();
  await expect(page.locator('.menu-editor .bottle-price')).toBeVisible();
  await expect(page.locator('.menu-editor .bottle-open')).toBeHidden();
});
