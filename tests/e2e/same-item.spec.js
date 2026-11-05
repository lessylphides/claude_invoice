// 같은 품목 묶기: 거래처마다 이름이 조금 다른 같은 물건을 하나로 (가격 추이·원가는 가장 최근 매입가)
import { test, expect } from '@playwright/test';
import { openApp, openManualEntry, purchase, item, sheet, closeSheet, waitSaved } from './helpers.js';

const data = () => ({
  categories: ['주류·음료', '기타'],
  menuCategories: ['위스키'],
  purchases: [
    purchase('c', '2026-11-03', '코스트코', [item('러셀싱글베럴', '주류·음료', 70000, { packSize: 750, packUnit: 'ml' })]),
    purchase('s', '2026-11-04', '서광컴퍼니', [item('러셀 싱글배럴 750', '주류·음료', 73000)]),
  ],
  menus: [{ id: 'm', name: '러셀 한 잔', price: 15000, category: '위스키', ingredients: [{ id: 'g', type: 'item', itemName: '러셀싱글베럴', use: 30 }] }],
});

/** 날짜 상세에서 품목을 눌러 가격 추이를 열고, 거래처가 여럿이면 '전체 거래처'로 */
async function openTrendFor(page, date, itemName) {
  await page.locator(`.cell[data-date="${date}"]`).click();
  await sheet(page).locator('.item-btn', { hasText: itemName }).click();
  const all = sheet(page).locator('[data-scope=all]');
  if (await all.count()) await all.click();
}

test('가격 추이에서 같은 품목 연결 → 두 거래처 가격이 한 곳에, 원가는 가장 최근 매입가', async ({ page }) => {
  const errors = await openApp(page, { data: data(), tab: 'cost' });
  // 묶기 전: 원가는 코스트코 가격(70,000)만 → 30ml = 2,800원
  await expect(page.locator('.menu-card .mc-sub')).toContainText('원가 2,800');

  await page.locator('[data-tab=purchase]').click();
  await openTrendFor(page, '2026-11-03', '러셀싱글베럴');
  let s = sheet(page);
  await expect(s.locator('.hist tbody tr')).toHaveCount(1);
  await s.locator('[data-link]').click();
  const picker = sheet(page);
  await expect(picker.locator('.sheet-head h2')).toHaveText('같은 품목으로 묶을 이름');
  await expect(picker.locator('.pick-item', { hasText: '러셀싱글베럴' })).toHaveCount(0); // 자기 자신은 목록에 없음
  await picker.locator('.pick-item[data-name="러셀 싱글배럴 750"]').click();
  await expect(page.locator('.toast').last()).toContainText('같은 품목으로 묶었습니다');

  s = sheet(page);
  await expect(s.locator('.hist tbody tr')).toHaveCount(2);
  await expect(s.locator('.chips .chip')).toHaveText(['전체 거래처', '코스트코', '서광컴퍼니']);
  await expect(s.locator('.stats .up')).toContainText('3,000원'); // 최근(서광) 73,000 vs 직전(코스트코) 70,000
  await expect(s.locator('.same-list li')).toHaveCount(2);
  await expect(s.locator('.same-list li', { hasText: '러셀싱글베럴' })).toContainText('대표 이름');
  await closeSheet(page);
  await closeSheet(page);

  // 원가: 가장 최근(서광 73,000원) 기준, 용량은 코스트코 기록(750ml)을 함께 씀 → 30ml = 2,920원
  await page.locator('[data-tab=cost]').click();
  await expect(page.locator('.menu-card .mc-sub')).toContainText('원가 2,920');
  await expect(page.locator('.menu-card .mc-sub .up')).toHaveText('▲120');
  // 재료 고르기 목록엔 대표 이름 한 줄
  await page.locator('[data-cost=add]').click();
  await page.locator('.menu-editor [data-add=item]').click();
  await expect(sheet(page).locator('.pick-item')).toHaveCount(1);
  await expect(sheet(page).locator('.pick-item')).toHaveAttribute('data-name', '러셀싱글베럴');
  expect(errors).toEqual([]);
});

test('연결 해제하면 다시 따로', async ({ page }) => {
  await openApp(page, { data: { ...data(), itemLinks: { 러셀싱글배럴750: '러셀싱글베럴' } } });
  await openTrendFor(page, '2026-11-03', '러셀싱글베럴');
  const s = sheet(page);
  await expect(s.locator('.hist tbody tr')).toHaveCount(2);
  await s.locator('[data-unlink="러셀 싱글배럴 750"]').click();
  await expect(s.locator('.hist tbody tr')).toHaveCount(1);
  await waitSaved(page, (d) => d && Object.keys(d.itemLinks).length === 0);
});

test('새 영수증에 비슷한 이름이 있으면 저장 후 "같은 품목인가요?" → 같은 품목', async ({ page }) => {
  const d = data();
  d.purchases = d.purchases.slice(0, 1); // 코스트코만 있는 상태
  await openApp(page, { data: d });
  await openManualEntry(page);
  const form = page.locator('form.editor');
  await form.locator('[name=vendor]').fill('서광컴퍼니');
  await form.locator('[data-f=name]').fill('러셀 싱글배럴 750');
  await form.locator('[data-f=unitPrice]').fill('73000');
  await form.locator('button[type=submit]').click();

  const ask = sheet(page);
  await expect(ask.locator('.sheet-head h2')).toHaveText('같은 품목인가요?');
  await expect(ask.locator('.same-ask li')).toContainText('러셀 싱글배럴 750');
  await expect(ask.locator('.same-ask li')).toContainText('↔ 러셀싱글베럴');
  await expect(ask.locator('.same-ask li')).toContainText('코스트코 · 최근 70,000원');
  await ask.locator('[data-same="0"]').click();
  await expect(page.locator('.sheet-wrap')).toHaveCount(0); // 다 답하면 닫힘
  await waitSaved(page, (x) => x?.itemLinks?.['러셀싱글배럴750'] === '러셀싱글베럴');

  // 용량도 묶음의 기록(750ml)을 따라감
  await openTrendFor(page, '2026-11-04', '러셀 싱글배럴 750');
  await expect(sheet(page).locator('.hist tbody tr')).toHaveCount(2);
});

test('"다른 품목"이라고 답하면 기억해서 다시 묻지 않음, 처음 보는 이름이 아니면 묻지 않음', async ({ page }) => {
  const d = data();
  d.purchases = d.purchases.slice(0, 1);
  await openApp(page, { data: d });
  const add = async (name, vendor = '서광컴퍼니') => {
    await openManualEntry(page);
    const form = page.locator('form.editor');
    await form.locator('[name=vendor]').fill(vendor);
    await form.locator('[data-f=name]').fill(name);
    await form.locator('[data-f=unitPrice]').fill('1000');
    await form.locator('button[type=submit]').click();
  };
  await add('러셀 싱글배럴 750');
  await sheet(page).locator('[data-diff="0"]').click();
  await waitSaved(page, (x) => x?.itemNotSame?.length === 1);
  // 같은 이름을 또 사면 이미 아는 품목이라 묻지 않음
  await add('러셀 싱글배럴 750', '다른가게');
  await page.waitForTimeout(400);
  await expect(page.locator('.sheet-wrap')).toHaveCount(0);
  // 전혀 다른 이름도 묻지 않음
  await add('대파');
  await page.waitForTimeout(400);
  await expect(page.locator('.sheet-wrap')).toHaveCount(0);
});

test('월 요약 항목별에서도 묶인 품목은 한 줄로 합산', async ({ page }) => {
  await openApp(page, { data: { ...data(), itemLinks: { 러셀싱글배럴750: '러셀싱글베럴' } } });
  await page.locator('[data-summary=category]').click();
  await page.locator('.sum-head', { hasText: '주류·음료' }).click();
  await expect(page.locator('.item-list .item-btn')).toHaveCount(1);
  await expect(page.locator('.item-list .item-btn .iamt')).toContainText('143,000원');
});
