// 처음 쓰는 사장님: 매입 탭 맨 위 '시작하기 3단계' (장부로 자동 체크, 닫으면 다시 안 보임)
import { test, expect } from '@playwright/test';
import { openApp, purchase, item } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/level**', (r) => r.fulfill({ contentType: 'application/json', body: '{"gifts":[]}' }));
  await page.route('**/api/notices', (r) => r.fulfill({ contentType: 'application/json', body: '{"notices":[]}' }));
});

test('빈 장부: 1단계부터, 버튼으로 바로 영수증 찍기·메뉴 만들기', async ({ page }) => {
  const errors = await openApp(page, { data: { purchases: [], menus: [] } });
  const card = page.locator('.onboard');
  await expect(card).toContainText('0/3');
  await expect(card.locator('li.now')).toContainText('영수증 한 장 찍기');
  await card.locator('[data-onboard=capture]').click();
  await expect(page.locator('.sheet-wrap').last()).toBeVisible();
  expect(errors).toEqual([]);
});

test('영수증이 있으면 2단계 → 메뉴 만들기 버튼은 원가 탭의 메뉴 추가로, 닫으면 다시 안 보임', async ({ page }) => {
  await openApp(page, { data: { purchases: [purchase('p', '2026-11-03', '코스트코', [item('레몬', '채소·과일', 900)])], menus: [] } });
  const card = page.locator('.onboard');
  await expect(card).toContainText('1/3');
  await expect(card.locator('li.done')).toContainText('영수증 한 장 찍기');
  await card.locator('[data-onboard=menu]').click();
  await expect(page.locator('.sheet[aria-label="메뉴 추가"]')).toBeVisible();
  await page.locator('.sheet[aria-label="메뉴 추가"] .close').click();
  await page.locator('.tabbar button').nth(0).click();
  await page.locator('.onboard [data-onboard=hide]').click();
  await expect(page.locator('.onboard')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.tabbar')).toBeVisible();
  await expect(page.locator('.onboard')).toHaveCount(0);
});
