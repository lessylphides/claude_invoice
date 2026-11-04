// 원가 탭 메뉴 분류: 칩으로 거르기, 전체는 분류별로 묶기, 메뉴 분류 고르기, 분류 편집(추가·이름·삭제·순서)
import { test, expect } from '@playwright/test';
import { openApp, purchase, item, sheet, waitSaved } from './helpers.js';

const data = () => ({
  version: 3,
  categories: ['주류·음료', '기타'],
  menuCategories: ['커피', '위스키', '칵테일', '맥주', '티', '디저트'],
  costTarget: { history: [{ value: 25, at: '2026-11-04' }] },
  purchases: [
    purchase('p', '2026-10-28', '코스트코', [
      item('몽키숄더700ML', '주류·음료', 39790, { packSize: 700, packUnit: 'ml' }),
      item('기네스440ML', '주류·음료', 3000, { packSize: 440, packUnit: 'ml' }),
      item('바스크치즈케이크', '기타', 17990, { packSize: 7, packUnit: '개' }),
    ]),
  ],
  menus: [
    { id: 'm1', name: '몽키숄더 (G)', price: 18000, category: '위스키', ingredients: [{ id: 'a', type: 'item', itemName: '몽키숄더700ML', use: 30 }] },
    { id: 'm2', name: '기네스 잔', price: 8000, category: '맥주', ingredients: [{ id: 'b', type: 'item', itemName: '기네스440ML', use: 440 }] },
    { id: 'm3', name: '바스크치즈케이크', price: 9500, category: '디저트', ingredients: [{ id: 'c', type: 'item', itemName: '바스크치즈케이크', use: 1 }] },
    { id: 'm4', name: '하우스 칵테일', price: 9000, category: '', ingredients: [{ id: 'd', type: 'manual', name: '재료', cost: 1800 }] },
  ],
});

test('칩으로 분류를 고르면 그 분류만, 요약도 그 분류 기준', async ({ page }) => {
  const errors = await openApp(page, { data: data(), tab: 'cost' });
  const chips = page.locator('.cat-chips .chip[data-cost-filter]');
  await expect(chips).toHaveText(['전체 4', '커피 0', '위스키 1', '칵테일 0', '맥주 1', '티 0', '디저트 1', '미분류 1']);

  // 전체: 분류 순서대로 묶고 미분류는 맨 뒤, 빈 분류는 숨김
  await expect(page.locator('.group-title')).toHaveText(['위스키 1', '맥주 1', '디저트 1', '미분류 1']);
  await expect(page.locator('.cost-summary')).toContainText('메뉴 4개');

  await page.locator('[data-cost-filter="디저트"]').click();
  await expect(page.locator('.menu-card')).toHaveCount(1);
  await expect(page.locator('.cost-summary')).toHaveText(/^디저트 · 메뉴 1개 · ⚠ 목표 초과 1개 · 평균 27\.1%/);
  await expect(page.locator('.group-title')).toHaveCount(0);

  await page.locator('[data-cost-filter="커피"]').click();
  await expect(page.locator('.empty-msg')).toContainText('커피 분류에 메뉴가 없습니다');

  // 고른 분류는 새로고침해도 유지
  await page.locator('[data-cost-filter="맥주"]').click();
  await page.reload();
  await expect(page.locator('.chip[aria-pressed=true]')).toHaveText('맥주 1');
  expect(errors).toEqual([]);
});

test('메뉴 추가: 보고 있던 분류가 미리 골라지고, 바꿀 수 있다', async ({ page }) => {
  await openApp(page, { data: data(), tab: 'cost' });
  await page.locator('[data-cost-filter="칵테일"]').click();
  await page.locator('[data-cost=add]').click();
  const form = page.locator('.menu-editor');
  await expect(form.locator('input[name=category]:checked')).toHaveValue('칵테일');
  await form.locator('[name=name]').fill('진토닉');
  await form.locator('[name=price]').fill('9000');
  await form.locator('[data-add=manual]').click();
  await form.locator('.ing-edit [data-f=name]').fill('진');
  await form.locator('.ing-edit [data-f=cost]').fill('1500');
  await form.locator('button[type=submit]').click();
  await expect(page.locator('.menu-card')).toHaveText(/진토닉/);

  // 미분류 메뉴를 수정해서 분류 지정
  await page.locator('[data-cost-filter="미분류"]').click();
  await page.locator('.menu-card').click();
  await sheet(page).locator('[data-edit]').click();
  await page.locator('.menu-editor .radio-chip', { hasText: '칵테일' }).click();
  await page.locator('.menu-editor button[type=submit]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-cost-filter="칵테일"]')).toHaveText('칵테일 2');
  await expect(page.locator('[data-cost-filter="미분류"]')).toHaveCount(0); // 미분류가 없으면 칩도 없음
});

test('분류 편집: 순서 바꾸기·이름 바꾸기(메뉴도 따라감)·추가·삭제(메뉴는 미분류로)', async ({ page }) => {
  await openApp(page, { data: data(), tab: 'cost' });
  await page.locator('[data-cost=edit-cats]').click();
  const s = sheet(page);
  const names = () => s.locator('.cat-edit [data-f=name]').evaluateAll((els) => els.map((e) => e.value));
  expect(await names()).toEqual(['커피', '위스키', '칵테일', '맥주', '티', '디저트']);
  await expect(s.locator('.cat-edit li').nth(1).locator('.cat-count')).toHaveText('1개');

  // 위스키를 맨 위로
  await s.locator('.cat-edit li').nth(1).locator('[data-move="-1"]').click();
  expect(await names()).toEqual(['위스키', '커피', '칵테일', '맥주', '티', '디저트']);
  await expect(s.locator('.cat-edit li').first().locator('[data-move="-1"]')).toBeDisabled();
  // 맥주 → 생맥주
  await s.locator('.cat-edit [data-f=name]').nth(3).fill('생맥주');
  // 와인 추가
  await s.locator('.cat-add input').fill('와인');
  await s.locator('.cat-add button').click();
  // 디저트 삭제 (메뉴 1개 → 미분류)
  page.once('dialog', (d) => d.accept());
  await s.locator('.cat-edit li').nth(5).locator('[data-del]').click();
  expect(await names()).toEqual(['위스키', '커피', '칵테일', '생맥주', '티', '와인']);
  await s.locator('.save').click();
  await expect(page.locator('.toast')).toContainText("메뉴 1개를 '미분류'로");

  await expect(page.locator('.cat-chips .chip[data-cost-filter]')).toHaveText(['전체 4', '위스키 1', '커피 0', '칵테일 0', '생맥주 1', '티 0', '와인 0', '미분류 2']);
  await waitSaved(page, (d) => d?.menus?.find((m) => m.id === 'm2')?.category === '생맥주' && d.menus.find((m) => m.id === 'm3').category === '');
});

test('분류 편집: 빈 이름·중복·예약어는 막고, 취소하면 바뀌지 않는다', async ({ page }) => {
  await openApp(page, { data: data(), tab: 'cost' });
  await page.locator('[data-cost=edit-cats]').click();
  const s = sheet(page);
  await s.locator('.cat-add input').fill('전체');
  await s.locator('.cat-add button').click();
  await expect(page.locator('.toast').last()).toContainText('쓸 수 없습니다');
  await s.locator('.cat-add input').fill('커피');
  await s.locator('.cat-add button').click();
  await expect(page.locator('.toast').last()).toContainText('이미 있는 분류');
  await s.locator('.cat-edit [data-f=name]').first().fill('위스키');
  await s.locator('.save').click();
  await expect(page.locator('.toast').last()).toContainText('같은 이름의 분류');
  await s.locator('.cancel').click();
  await expect(page.locator('.cat-chips .chip').nth(1)).toHaveText('커피 0');
});

test('예전(v2) 데이터: 기본 분류가 생기고 기존 메뉴는 미분류', async ({ page }) => {
  const d = data();
  delete d.menuCategories;
  d.version = 2;
  d.menus = d.menus.map(({ category, ...m }) => m);
  await openApp(page, { data: d, tab: 'cost' });
  await expect(page.locator('.cat-chips .chip[data-cost-filter]')).toHaveText(['전체 4', '커피 0', '위스키 0', '칵테일 0', '맥주 0', '티 0', '디저트 0', '미분류 4']);
});
