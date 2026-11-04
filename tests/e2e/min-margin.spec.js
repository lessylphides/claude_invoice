// 분류별 최소 마진: 설정·변경 기록, 마진 기준 충족 판정, 추천 판매가 두 가지, 분류 이름 바꾸면 따라감
import { test, expect } from '@playwright/test';
import { openApp, purchase, item, sheet, closeSheet, waitSaved } from './helpers.js';

const data = () => ({
  version: 3,
  categories: ['주류·음료', '기타'],
  menuCategories: ['위스키', '칵테일', '디저트'],
  costTarget: { history: [{ value: 25, at: '2026-11-01' }] },
  purchases: [
    purchase('p', '2026-10-28', '주류도매', [
      item('고급위스키700ML', '주류·음료', 350000, { packSize: 700, packUnit: 'ml' }), // 30ml = 15,000원
      item('몽키숄더700ML', '주류·음료', 39790, { packSize: 700, packUnit: 'ml' }), // 30ml = 1,705원
    ]),
  ],
  menus: [
    { id: 'hi', name: '고급 싱글몰트', price: 27000, category: '위스키', ingredients: [{ id: 'a', type: 'item', itemName: '고급위스키700ML', use: 30 }] },
    { id: 'mid', name: '고급 싱글몰트 (싸게)', price: 26000, category: '위스키', ingredients: [{ id: 'b', type: 'item', itemName: '고급위스키700ML', use: 30 }] },
    { id: 'lo', name: '몽키숄더', price: 18000, category: '위스키', ingredients: [{ id: 'c', type: 'item', itemName: '몽키숄더700ML', use: 30 }] },
  ],
});

async function setMargins(page, values) {
  await page.locator('[data-cost=margins]').click();
  const s = sheet(page);
  for (const [cat, v] of Object.entries(values)) await s.locator(`.margin-form input[name="${cat}"]`).fill(String(v));
  await s.locator('.margin-form button[type=submit]').click();
}

test('최소 마진이 없으면 원가율로만 판정, 설정하면 마진 기준 충족으로 바뀐다', async ({ page }) => {
  const errors = await openApp(page, { data: data(), tab: 'cost' });
  await expect(page.locator('.margin-line')).toContainText('분류별 최소 마진: 설정 안 함');
  await expect(page.locator('.menu-card.over')).toHaveCount(2);
  await expect(page.locator('.cost-summary')).toContainText('목표 초과 2개');
  // 카드에 마진 금액
  await expect(page.locator('.menu-card', { hasText: '몽키숄더' }).locator('.mc-sub')).toContainText('마진 16,295');

  await setMargins(page, { 위스키: 12000 });
  await expect(page.locator('.toast').last()).toContainText('위스키 최소 마진을 저장했습니다');
  await expect(sheet(page).locator('.margin-list li').first().locator('.mdate')).toHaveText('2026.11.04 설정');
  await closeSheet(page);

  // 27,000원(마진 12,000)은 충족, 26,000원(마진 11,000)은 여전히 ⚠
  const hi = page.locator('.menu-card', { hasText: '고급 싱글몰트' }).filter({ hasNotText: '싸게' });
  await expect(hi).toHaveClass(/by-margin/);
  await expect(hi.locator('.mc-badge')).toHaveText('✔ 마진 기준 충족 (최소 12,000원)');
  await expect(page.locator('.menu-card.over')).toHaveCount(1);
  await expect(page.locator('.cost-summary')).toContainText('목표 초과 1개 · 마진 기준 충족 1개');
  await expect(page.locator('.margin-line')).toContainText('최소 마진: 위스키 12,000');

  // 분류를 고르면 그 분류의 값과 날짜
  await page.locator('[data-cost-filter="위스키"]').click();
  await expect(page.locator('.margin-line')).toContainText('위스키 최소 마진 12,000원 · 2026.11.04');
  await page.locator('[data-cost-filter="칵테일"]').click();
  await expect(page.locator('.margin-line')).toContainText('칵테일: 최소 마진 없음');
  expect(errors).toEqual([]);
});

test('메뉴 상세: 마진 기준 합격 안내 / 못 채우면 추천 판매가 두 가지', async ({ page }) => {
  await openApp(page, { data: data(), tab: 'cost' });
  await setMargins(page, { 위스키: 12000 });
  await closeSheet(page);

  await page.locator('.menu-card', { hasText: '고급 싱글몰트' }).filter({ hasNotText: '싸게' }).click();
  await expect(sheet(page).locator('.ok-notice')).toContainText('한 잔 마진 12,000원이 위스키 최소 마진 12,000원 이상이라 합격');
  await expect(sheet(page).locator('.stats .good')).toContainText('최소 12,000');
  await closeSheet(page);

  await page.locator('.menu-card', { hasText: '싸게' }).click();
  const notice = sheet(page).locator('.notice');
  await expect(notice).toContainText('최소 마진 12,000원도 못 채웁니다');
  await expect(notice.locator('.suggest li')).toHaveText(['원가율 25% 기준: 60,000원 이상', '최소 마진 12,000원 기준: 27,000원 이상']);
});

test('입력 화면: 분류를 바꾸면 그 분류의 최소 마진으로 바로 판정', async ({ page }) => {
  await openApp(page, { data: data(), tab: 'cost' });
  await setMargins(page, { 위스키: 12000, 칵테일: 20000 });
  await closeSheet(page);
  await page.locator('.menu-card', { hasText: '고급 싱글몰트' }).filter({ hasNotText: '싸게' }).click();
  await sheet(page).locator('[data-edit]').click();
  const sum = page.locator('.menu-editor .sum');
  await expect(sum).toContainText('마진 12,000원 ✔');
  await page.locator('.menu-editor .radio-chip', { hasText: '칵테일' }).click();
  await expect(sum).not.toContainText('✔');
  await expect(sum.locator('.warn')).toHaveText('55.6%');
});

test('변경 기록이 남고, 빈칸으로 저장하면 해제, 잘못된 값은 저장하지 않음', async ({ page }) => {
  await openApp(page, { data: data(), tab: 'cost' });
  await setMargins(page, { 위스키: 12000 });
  const s = sheet(page);
  await s.locator('.margin-form input[name="위스키"]').fill('-5');
  await s.locator('.margin-form button[type=submit]').click();
  await expect(page.locator('.toast').last()).toContainText('0원 이상');
  await s.locator('.margin-form input[name="위스키"]').fill('');
  await s.locator('.margin-form button[type=submit]').click();
  await expect(s.locator('.target-hist li')).toHaveText([/위스키 해제\s*2026\.11\.04/, /위스키 12,000원\s*2026\.11\.04/]);
  await closeSheet(page);
  await expect(page.locator('.menu-card.over')).toHaveCount(2);
});

test('분류 이름을 바꾸면 최소 마진도 따라가고, 새로고침해도 유지', async ({ page }) => {
  await openApp(page, { data: data(), tab: 'cost' });
  await setMargins(page, { 위스키: 12000 });
  await closeSheet(page);
  await page.locator('[data-cost=edit-cats]').click();
  await sheet(page).locator('.cat-edit [data-f=name]').first().fill('싱글몰트');
  await sheet(page).locator('.save').click();
  await expect(page.locator('.margin-line')).toContainText('싱글몰트 12,000');
  await waitSaved(page, (d) => d?.minMargins?.['싱글몰트']?.at(-1)?.value === 12000 && !d.minMargins['위스키']);
  await page.reload();
  await expect(page.locator('.menu-card.by-margin')).toHaveCount(1);
});
