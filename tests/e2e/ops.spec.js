// 운영비 · 투자 회수: 고정비·투자 → 본전 매출(한 달·하루), 영수증의 비품을 투자로, 월 매출 → 실제
import { test, expect } from '@playwright/test';
import { openApp, purchase, item, sheet } from './helpers.js';

const ownerStatus = (owner) => ({ mode: 'test', owner, customerKey: 'cn_x', subscription: null, entitlement: { kind: owner ? 'owner' : 'legacy', day: 30, month: 300 }, usage: { day: 0, month: 0, total: 0, period: 0 } });
const data = () => ({
  version: 6,
  categories: ['주류·음료', '기타'],
  menuCategories: ['위스키', '커피'],
  costTarget: { history: [{ value: 25, at: '2026-11-01' }] },
  minMargins: { 위스키: [{ value: 16000, bottle: 0, at: '2026-11-01' }], 커피: [{ value: 3000, bottle: 0, at: '2026-11-01' }] },
  purchases: [
    purchase('p', '2026-11-02', '주방몰', [item('하이볼잔 24개', '비품·집기', 300000), item('발베니 12년 700ML', '주류·음료', 160000, { packSize: 700, packUnit: 'ml' })]),
  ],
  menus: [
    { id: 'w', name: '발베니', price: 26000, category: '위스키', ingredients: [{ id: 'g', type: 'item', itemName: '발베니 12년 700ML', use: 30 }] },
    { id: 'c', name: '아메리카노', price: 4500, category: '커피', ingredients: [{ id: 'h', type: 'manual', name: '원두', cost: 500 }] },
  ],
});

test('운영비: 넣으면 본전 매출, 비품 영수증을 투자로, 월 매출과 비교, 저장 후 유지', async ({ page }) => {
  await page.route('**/api/level**', (r) => r.fulfill({ contentType: 'application/json', body: '{"gifts":[]}' }));
  await page.route('**/api/billing**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(ownerStatus(true)) }));
  const errors = await openApp(page, { data: data(), tab: 'cost' });
  await expect(page.locator('.ops-line')).toContainText('아직 안 넣음');
  await page.locator('[data-cost=ops]').click();
  const s = sheet(page);
  // 고정비 2개
  await s.locator('[data-add=fixed]').click();
  await s.locator('[data-list=fixed] .ops-row').nth(0).locator('[data-f=name]').fill('월세');
  await s.locator('[data-list=fixed] .ops-row').nth(0).locator('[data-f=amount]').fill('2500000');
  await s.locator('[data-add=fixed]').click();
  await s.locator('[data-list=fixed] .ops-row').nth(1).locator('[data-f=name]').fill('인건비');
  await s.locator('[data-list=fixed] .ops-row').nth(1).locator('[data-f=amount]').fill('6487500');
  // 영수증의 하이볼잔(비품·집기) → 투자 항목 (24개월)
  await expect(s.locator('.ops-cands')).toContainText('하이볼잔 24개');
  await s.locator('[data-cand]').click();
  await expect(s.locator('[data-list=invests] [data-f=months]').first()).toHaveValue('24');
  // 8,987,500 + 300,000/24(12,500) = 9,000,000 → 메뉴가 2개라 목표 원가율 25% → 본전 12,000,000 / 25일 = 480,000
  await expect(s.locator('.ops-need')).toContainText('9,000,000원');
  await expect(s.locator('.ops-be')).toContainText('한 달 12,000,000원');
  await expect(s.locator('.ops-be')).toContainText('목표 원가율 기준');
  await s.locator('input[name=workDays]').fill('25');
  await expect(s.locator('.ops-be')).toContainText('하루 480,000원');
  await expect(s.locator('input[name=monthlyGlasses]')).toHaveCount(0); // 잔 수 입력은 없음
  await expect(s.locator('.ops-cat')).toHaveCount(0); // 분류별 점검도 없음
  // 월 매출 (운영자): 본전보다 덜 팔았음
  await s.locator('[data-sales="2026-11"]').fill('10000000');
  await expect(s.locator('.ops-actual')).toContainText('2026년 11월');
  await expect(s.locator('.ops-actual')).toContainText('본전 매출보다 2,000,000원 덜 팔았어요');
  await s.locator('button[type=submit]').click();
  await expect(page.locator('.ops-line')).toContainText('9,000,000원');
  await expect(page.locator('.ops-line')).toContainText('본전 매출 하루 480,000원');
  await page.reload();
  await expect(page.locator('.ops-line')).toContainText('9,000,000원');
  expect(errors).toEqual([]);
});

test('비품·시설로 분류한 매입은 메뉴 재료 목록에 나오지 않음', async ({ page }) => {
  await page.route('**/api/level**', (r) => r.fulfill({ contentType: 'application/json', body: '{"gifts":[]}' }));
  await openApp(page, { data: data(), tab: 'cost' });
  await page.locator('[data-cost=add]').click();
  await page.locator('.sheet[aria-label="메뉴 추가"] [data-add=item]').click();
  const pick = page.locator('.sheet[aria-label="매입 품목 선택"]');
  await expect(pick).toContainText('발베니 12년 700ML');
  await expect(pick).not.toContainText('하이볼잔');
});

test('월 매출(판매 파일 불러오기)은 운영자에게만 보임', async ({ page }) => {
  await page.route('**/api/level**', (r) => r.fulfill({ contentType: 'application/json', body: '{"gifts":[]}' }));
  await page.route('**/api/billing**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(ownerStatus(false)) }));
  await openApp(page, { data: data(), tab: 'cost' });
  await page.locator('[data-cost=ops]').click();
  await expect(sheet(page).locator('.ops-sum')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(sheet(page).locator('.ops-sales')).toBeHidden();
  await expect(sheet(page).locator('[data-import]')).toBeHidden();
});
