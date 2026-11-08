// 원가 변동 알림: 우유값이 오른 영수증을 저장하면 원가가 바뀐 메뉴와 추천 판매가를 보여 준다
import { test, expect } from '@playwright/test';
import { openApp, mockClaude, ocrItem, PHOTO, purchase, item, sheet } from './helpers.js';

const milk = (price) => item('서울우유 1L', '유제품·계란', price, { packSize: 1000, packUnit: 'ml' });
const data = () => ({
  categories: ['유제품·계란', '기타'],
  costTarget: { history: [{ value: 30, at: '2026-11-01' }] },
  purchases: [purchase('p1', '2026-11-01', '우유대리점', [milk(2500)])],
  menus: [
    { id: 'latte', name: '카페라떼', category: '커피', price: 5000, ingredients: [{ id: 'g1', type: 'item', itemName: '서울우유 1L', use: 200 }, { id: 'g2', type: 'manual', name: '원두', cost: 700 }] },
    { id: 'shake', name: '밀크셰이크', category: '음료', price: 3000, ingredients: [{ id: 'g3', type: 'item', itemName: '서울우유 1L', use: 300 }, { id: 'g4', type: 'manual', name: '아이스크림', cost: 200 }] },
    { id: 'ame', name: '아메리카노', category: '커피', price: 4500, ingredients: [{ id: 'g5', type: 'manual', name: '원두', cost: 700 }] },
  ],
});
const receipt = (price, date = '2026-11-04') => ({ documentType: '영수증', date, vendor: '우유대리점', paymentHint: 'card', total: price, items: [ocrItem('서울우유 1L', '유제품·계란', price, { packSize: 1000, packUnit: 'ml' })] });

test('우유값이 오르면 저장 직후 바뀐 메뉴·원가율·추천 판매가를 보여 준다', async ({ page }) => {
  const errors = await openApp(page, { data: data() });
  await mockClaude(page, () => receipt(2800));
  await page.locator('#cam').setInputFiles(PHOTO);
  await page.locator('form.editor button[type=submit]').click();

  const s = sheet(page);
  await expect(s.locator('.sheet-head h2')).toHaveText('원가가 바뀐 메뉴');
  await expect(s.locator('.ci-head')).toContainText('메뉴 2개');
  await expect(s.locator('.ci-items')).toContainText('2,500원 → 2,800원');
  await expect(s.locator('.ci-items')).toContainText('▲12%');
  // 밀크셰이크: 원가 950 → 1,040, 원가율 31.7% → 34.7% (목표 30% 를 이미 넘음) → 추천 판매가 3,500원
  const shake = s.locator('.ci-menu', { hasText: '밀크셰이크' });
  await expect(shake).toContainText('950원 → 1,040원');
  await expect(shake.locator('.ci-advice')).toContainText('3,000원 → 3,500원');
  // 카페라떼: 원가 1,200 → 1,260, 목표 안 → 추천 없음
  const latte = s.locator('.ci-menu', { hasText: '카페라떼' });
  await expect(latte).toContainText('▲60');
  await expect(latte.locator('.ci-advice')).toHaveCount(0);
  await expect(s.locator('.ci-menu', { hasText: '아메리카노' })).toHaveCount(0); // 우유를 안 쓰는 메뉴는 없음

  await s.locator('[data-ci=cost]').click();
  await expect(page.locator('.sheet-wrap')).toHaveCount(0);
  await expect(page.locator('[data-tab=cost]')).toHaveAttribute('aria-current', 'page');
  expect(errors).toEqual([]);
});

test('값이 그대로면 알림 없음, 내리기만 하면 짧은 안내만', async ({ page }) => {
  await openApp(page, { data: data() });
  let price = 2500;
  let date = '2026-11-03';
  await mockClaude(page, () => receipt(price, date));
  await page.locator('#cam').setInputFiles(PHOTO);
  await page.locator('form.editor button[type=submit]').click();
  await expect(page.locator('.sheet-wrap')).toHaveCount(0);

  price = 2200;
  date = '2026-11-04';
  await page.locator('#cam').setInputFiles(PHOTO);
  await page.locator('form.editor button[type=submit]').click();
  await expect(page.locator('.toast').last()).toContainText('메뉴 2개의 원가가 낮아졌어요');
  await expect(page.locator('.sheet-wrap')).toHaveCount(0);
});
