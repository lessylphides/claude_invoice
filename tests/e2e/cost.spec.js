// 원가 탭: 메뉴 등록(품목 목록에서 고르기), 원가율 계산, 목표 원가율 변경 기록, 용량 연동, 가격 추이
import { test, expect } from '@playwright/test';
import { openApp, purchase, item, sheet, closeSheet } from './helpers.js';

const data = () => ({
  categories: ['주류·음료', '유제품·계란', '기타'],
  purchases: [
    purchase('p1', '2026-09-20', '코스트코', [
      item('몽키숄더700ML', '주류·음료', 45990, { packSize: 700, packUnit: 'ml' }),
      item('바스크치즈케이크', '유제품·계란', 17990),
    ]),
    purchase('p2', '2026-10-28', '(주)코스트코코리아 양재점', [
      item('몽키숄더700ML', '주류·음료', 49790, { discount: 10000 }),
      item('바스크치즈케이크', '유제품·계란', 17990, { packSize: 7, packUnit: '개' }),
      item('KS LONDON DRY GIN', '주류·음료', 27990, { packSize: 1000, packUnit: 'ml' }),
      item('쿠폰할인', '기타', 0, { amount: -3000 }),
    ]),
  ],
});

async function addMenu(page, name, price, ings) {
  await page.locator('[data-cost=add]').click();
  const form = page.locator('.menu-editor');
  await form.locator('[name=name]').fill(name);
  await form.locator('[name=price]').fill(String(price));
  for (const g of ings) {
    if (g.manual) {
      await form.locator('[data-add=manual]').click();
      const row = form.locator('.ing-edit').last();
      await row.locator('[data-f=name]').fill(g.manual);
      await row.locator('[data-f=cost]').fill(String(g.cost));
      continue;
    }
    await form.locator('[data-add=item]').click();
    await sheet(page).locator(`.pick-item[data-name="${g.item}"]`).click();
    const row = form.locator('.ing-edit').last();
    await expect(row.locator('[data-f=use]')).toBeFocused(); // 고르면 바로 사용량 칸으로
    if (g.pack) await row.locator('[data-f=packSize]').fill(String(g.pack));
    if (g.unit) await row.locator('[data-f=unit]').selectOption(g.unit);
    await row.locator('[data-f=use]').fill(String(g.use));
  }
  await form.locator('button[type=submit]').click();
  await expect(form).toHaveCount(0);
}

test('메뉴 등록 → 원가율 계산, 목표 초과 표시', async ({ page }) => {
  const errors = await openApp(page, { data: data() });
  await page.locator('[data-tab=cost]').click();
  await expect(page.locator('.target-card .hero-num')).toHaveText('25%');
  await expect(page.locator('.target-card .hero-sub')).toHaveText('2026.11.04 기본값으로 설정');

  // 매입 기록의 용량(700ml)을 쓰고, 할인 반영 단가 39,790원 → 30ml = 1,705원
  await addMenu(page, '몽키숄더 한 잔', 12000, [{ item: '몽키숄더700ML', use: 30 }]);
  // 케이크: 매입 기록 7개 중 1개 = 2,570원 → 8,000원이면 32.1%
  await addMenu(page, '바스크 치즈케이크', 8000, [{ item: '바스크치즈케이크', use: 1 }]);
  // 진토닉: 진 45ml(1,259.55원) + 직접 입력 900원
  await addMenu(page, '진토닉', 9000, [{ item: 'KS LONDON DRY GIN', use: 45 }, { manual: '토닉워터·라임', cost: 900 }]);

  await expect(page.locator('.mc-name')).toHaveText(['⚠ 바스크 치즈케이크', '진토닉', '몽키숄더 한 잔']);
  await expect(page.locator('.mc-rate')).toHaveText(['32.1%', '24.0%', '14.2%']);
  await expect(page.locator('.cost-summary')).toContainText('목표 초과 1개');
  // 몽키숄더: 직전 매입(45,990원) 대비 원가 하락 ▼
  await expect(page.locator('.menu-card', { hasText: '몽키숄더' }).locator('.down')).toHaveText('▼266');
  expect(errors).toEqual([]);
});

test('품목 목록: 분류별로 묶이고, 검색으로 거르며, 할인·쿠폰 줄(0원 이하)은 나오지 않는다', async ({ page }) => {
  await openApp(page, { data: data(), tab: 'cost' });
  await page.locator('[data-cost=add]').click();
  await page.locator('.menu-editor [data-add=item]').click();
  const s = sheet(page);
  await expect(s.locator('.sub')).toHaveText(['주류·음료', '유제품·계란']);
  await expect(s.locator('.pick-item')).toHaveCount(3);
  await expect(s.locator('.pick-item', { hasText: '몽키숄더' }).locator('small')).toContainText('700ml · 최근 39,790원');
  await s.locator('.pick-search').fill('gin');
  await expect(s.locator('.pick-item')).toHaveCount(1);
  await closeSheet(page);
  await expect(page.locator('.menu-editor .ing-edit')).toHaveCount(0); // 취소하면 재료가 추가되지 않음
});

test('메뉴 상세: 재료별 원가, 목표 판매가 안내, 수정·삭제, 재료 → 가격 추이', async ({ page }) => {
  await openApp(page, { data: data(), tab: 'cost' });
  await addMenu(page, '바스크 치즈케이크', 8000, [{ item: '바스크치즈케이크', use: 1 }]);
  await page.locator('.menu-card').click();
  const s = sheet(page);
  await expect(s.locator('.stats')).toContainText('2,570원');
  await expect(s.locator('.notice')).toContainText('판매가 약 10,300원 이상');
  await expect(s.locator('.ing-list small').first()).toContainText('7개 중 1개');
  await expect(s.locator('.ing-list small').first()).toContainText('최근 17,990원 (26.10.28 (주)코스트코코리아 양재점)');

  await s.locator('[data-edit]').click();
  await expect(page.locator('.menu-editor .ing-info')).toContainText('최근 매입 17,990원');
  await page.locator('.menu-editor [name=price]').fill('11000');
  await page.locator('.menu-editor button[type=submit]').click();
  await expect(s.locator('.notice')).toHaveCount(0);
  await expect(s.locator('.stats .over')).toHaveCount(0);

  await s.locator('[data-ing-trend]').click();
  await expect(sheet(page).locator('.sheet-head h2')).toHaveText('바스크치즈케이크 가격 추이');
  await closeSheet(page);

  page.once('dialog', (d) => d.accept());
  await sheet(page).locator('[data-del]').click();
  await expect(page.locator('.menu-card')).toHaveCount(0);
});

test('목표 원가율을 바꾸면 날짜와 변경 기록이 남고 초과 판정이 바뀐다', async ({ page }) => {
  await openApp(page, { data: data(), tab: 'cost' });
  await addMenu(page, '바스크 치즈케이크', 8000, [{ item: '바스크치즈케이크', use: 1 }]);
  await expect(page.locator('.menu-card.over')).toHaveCount(1);
  await page.locator('[data-cost=target]').click();
  await page.locator('.target-form [name=v]').fill('35');
  await page.locator('.target-form button[type=submit]').click();
  await expect(sheet(page).locator('.target-hist li')).toHaveCount(2);
  await expect(sheet(page).locator('.target-hist li').first()).toContainText('35%');
  await expect(sheet(page).locator('.target-hist li').first()).toContainText('2026.11.04 · 현재');
  await closeSheet(page);
  await expect(page.locator('.target-card .hero-num')).toHaveText('35%');
  await expect(page.locator('.target-card .hero-sub')).toHaveText('2026.11.04 변경');
  await expect(page.locator('.menu-card.over')).toHaveCount(0);
  // 새로고침해도 유지
  await page.reload();
  await expect(page.locator('.target-card .hero-num')).toHaveText('35%');
});

test('매입 기록의 용량을 고치면 원가율이 따라 바뀐다', async ({ page }) => {
  await openApp(page, { data: data(), tab: 'cost' });
  await addMenu(page, '바스크 치즈케이크', 8000, [{ item: '바스크치즈케이크', use: 1 }]);
  await expect(page.locator('.mc-rate')).toHaveText('32.1%');

  await page.locator('[data-tab=purchase]').click();
  await page.locator('[data-act=prev]').click();
  await page.locator('.cell[data-date="2026-10-28"]').click();
  await sheet(page).locator('[data-edit=p2]').click();
  const cake = page.locator('form.editor .item-edit', { has: page.locator('[data-f=name][value="바스크치즈케이크"]') });
  await cake.locator('[data-f=packSize]').fill('8');
  await page.locator('form.editor button[type=submit]').click();
  await expect(sheet(page).locator('.item-btn', { hasText: '바스크치즈케이크' })).toContainText('1(8개)');
  await closeSheet(page);

  await page.locator('[data-tab=cost]').click();
  await expect(page.locator('.mc-rate')).toHaveText('28.1%');
});

test('메뉴에 용량을 직접 적으면 매입 기록보다 우선한다', async ({ page }) => {
  await openApp(page, { data: data(), tab: 'cost' });
  await addMenu(page, '바스크 반 조각', 5000, [{ item: '바스크치즈케이크', pack: 14, unit: '개', use: 1 }]);
  // 17,990 / 14 = 1,285원 → 25.7%
  await expect(page.locator('.mc-rate')).toHaveText('25.7%');
});

test('계산할 수 있는 재료가 없으면 0% 가 아니라 "계산 불가"로 보이고 평균에서 빠진다', async ({ page }) => {
  await openApp(page, { data: data(), tab: 'cost' });
  await addMenu(page, '몽키숄더 한 잔', 12000, [{ item: '몽키숄더700ML', use: 30 }]);
  // 사용량을 0 으로 두면 이 재료는 계산할 수 없음
  await page.locator('[data-cost=add]').click();
  const form = page.locator('.menu-editor');
  await form.locator('[name=name]').fill('바스크 (용량 없음)');
  await form.locator('[name=price]').fill('8000');
  await form.locator('[data-add=item]').click();
  await sheet(page).locator('.pick-item[data-name="바스크치즈케이크"]').click();
  await form.locator('.ing-edit').last().locator('[data-f=use]').fill('0');
  await form.locator('button[type=submit]').click();
  const card = page.locator('.menu-card', { hasText: '용량 없음' });
  await expect(card.locator('.mc-rate')).toHaveText('계산 불가');
  await expect(page.locator('.cost-summary')).toContainText('평균 14.2%');
});
