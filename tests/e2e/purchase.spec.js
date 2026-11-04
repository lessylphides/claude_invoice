// 매입 탭: 직접 입력, 달력·월 요약, 날짜 상세, 결제 구분(세금계산서/카드), 수정·삭제
import { test, expect } from '@playwright/test';
import { openApp, openManualEntry, purchase, item, sheet, closeSheet } from './helpers.js';

const seed = () => ({
  categories: ['채소·과일', '육류', '주류·음료', '기타'],
  purchases: [
    purchase('a', '2026-11-02', '가락청과', [item('양파 20kg', '채소·과일', 28000), item('대파', '채소·과일', 4000, { qty: 3 })], { payType: 'tax', taxIssued: true }),
    purchase('b', '2026-11-02', '한우마을', [item('한우 등심', '육류', 98000, { qty: 2 })], { payType: 'card' }),
    purchase('c', '2026-11-03', '가락청과', [item('양파 20kg', '채소·과일', 31000)], { payType: 'tax' }),
  ],
});

test('빈 상태에서 직접 입력하면 달력·월 합계·거래처 요약에 반영된다', async ({ page }) => {
  const errors = await openApp(page);
  await expect(page.locator('.hero-num')).toHaveText('0원');
  await expect(page.locator('.empty-msg')).toBeVisible();

  await openManualEntry(page);
  const form = page.locator('form.editor');
  await expect(form.locator('[name=date]')).toHaveValue('2026-11-04');
  await form.locator('[name=vendor]').fill('동네마트');
  const row = form.locator('.item-edit').first();
  await row.locator('[data-f=name]').fill('우유');
  await row.locator('[data-f=qty]').fill('3');
  await row.locator('[data-f=unitPrice]').fill('2500');
  await expect(row.locator('[data-f=amount]')).toHaveValue('7500'); // 수량×단가 자동 계산
  await expect(form.locator('.sum')).toHaveText('7,500원');
  await form.locator('button[type=submit]').click();

  await expect(page.locator('.hero-num')).toHaveText('7,500원');
  await expect(page.locator('.cell[data-date="2026-11-04"] .amt')).toHaveText('7,500');
  await expect(page.locator('.sum-head .name')).toHaveText('동네마트');
  expect(errors).toEqual([]);
});

test('필수 값이 없으면 저장하지 않고 안내한다', async ({ page }) => {
  await openApp(page);
  await openManualEntry(page);
  await page.locator('form.editor button[type=submit]').click();
  await expect(page.locator('.toast')).toHaveText('거래처를 입력해 주세요.');
  await expect(page.locator('form.editor')).toBeVisible();
});

test('월 요약: 거래처별·항목별·세금계산서·카드 보기', async ({ page }) => {
  await openApp(page, { data: seed() });
  await expect(page.locator('.hero-num')).toHaveText('267,000원');
  await expect(page.locator('.hero-sub')).toContainText('미발행 31,000원');
  // 달력 칸: 축약 금액 + 미발행 표시
  await expect(page.locator('.cell[data-date="2026-11-02"] .amt')).toHaveText('23.6만');
  await expect(page.locator('.cell[data-date="2026-11-03"] .pend')).toHaveCount(1);
  await expect(page.locator('.cell[data-date="2026-11-02"] .pend')).toHaveCount(0);

  // 거래처별: 금액 큰 순
  await expect(page.locator('.sum-head .name')).toHaveText(['한우마을', '가락청과']);

  // 항목별: 펼치면 같은 품목끼리 합산
  await page.locator('[data-summary=category]').click();
  await page.locator('.sum-head', { hasText: '채소·과일' }).click();
  const onion = page.locator('.item-list .item-btn', { hasText: '양파 20kg' });
  await expect(onion.locator('.iamt')).toContainText('59,000원');

  // 세금계산서·카드: 발행/미발행이 세금계산서 아래에 들여써짐
  await page.locator('[data-summary=pay]').click();
  const tax = page.locator('.pay-break .pb-group').first();
  await expect(tax.locator('.pb-row')).toContainText('세금계산서');
  await expect(tax.locator('.pb-subs li.ok')).toContainText('40,000원');
  await expect(tax.locator('.pb-subs li.warn')).toContainText('31,000원');
  await expect(page.locator('.pb-total')).toContainText('267,000원');
  // 미발행 거래처의 날짜를 누르면 그날 상세가 열린다
  await page.locator('.pending-list [data-date="2026-11-03"]').click();
  await expect(sheet(page).locator('.sheet-head h2')).toHaveText('2026년 11월 3일 (화)');
});

test('달 이동과 이번 달로 돌아오기', async ({ page }) => {
  await openApp(page, { data: seed() });
  await page.locator('[data-act=prev]').click();
  await expect(page.locator('.month-title')).toHaveText('2026년 10월');
  await expect(page.locator('.hero-num')).toHaveText('0원');
  await page.locator('[data-act=next]').click();
  await page.locator('[data-act=next]').click();
  await expect(page.locator('.month-title')).toHaveText('2026년 12월');
  await page.locator('[data-act=today]').click();
  await expect(page.locator('.month-title')).toHaveText('2026년 11월');
});

test('날짜 상세: 매입처별/항목별, 세금계산서 하위의 발행 받음, 카드와 배타 선택', async ({ page }) => {
  await openApp(page, { data: seed() });
  await page.locator('.cell[data-date="2026-11-02"]').click();
  const s = sheet(page);
  await expect(s.locator('.day-total strong')).toHaveText('236,000원');

  const hanwoo = s.locator('.vendor-card', { hasText: '한우마을' });
  await expect(hanwoo.locator('[data-pay=card]')).toBeChecked();
  await expect(hanwoo.locator('[data-pay=issued]')).toHaveCount(0);

  // 세금계산서를 고르면 카드는 풀리고, '발행 받음'이 세금계산서 상자 안에 나타난다
  await hanwoo.locator('[data-pay=tax]').check();
  await expect(hanwoo.locator('[data-pay=card]')).not.toBeChecked();
  const issued = hanwoo.locator('.pay-opt.on [data-pay=issued]');
  await expect(issued).toBeVisible();
  await expect(issued).not.toBeChecked();
  await expect(s.locator('.day-pay .pb-subs li.warn')).toContainText('196,000원');
  await issued.check();
  await expect(s.locator('.day-pay .pb-subs li.ok')).toContainText('236,000원');

  // 항목별 보기
  await s.locator('[data-mode=category]').click();
  await expect(s.locator('.card h3')).toHaveText(['육류', '채소·과일']);
});

test('수정과 삭제', async ({ page }) => {
  await openApp(page, { data: seed() });
  await page.locator('.cell[data-date="2026-11-03"]').click();
  await sheet(page).locator('[data-edit=c]').click();
  const form = page.locator('form.editor');
  await expect(page.locator('.sheet-head h2').last()).toHaveText('매입 내역 수정');
  await form.locator('[data-f=unitPrice]').first().fill('33000');
  await form.locator('button[type=submit]').click();
  await expect(sheet(page).locator('.day-total strong')).toHaveText('33,000원');

  page.once('dialog', (d) => d.accept());
  await sheet(page).locator('[data-del=c]').click();
  await expect(sheet(page).locator('.empty-msg')).toBeVisible();
  await closeSheet(page);
  await expect(page.locator('.cell[data-date="2026-11-03"] .amt')).toHaveCount(0);
});

test('입력 화면: 쿠폰·할인을 품목 아래에 붙이면 금액이 정가-할인으로 계산된다', async ({ page }) => {
  await openApp(page);
  await openManualEntry(page);
  const form = page.locator('form.editor');
  await form.locator('[name=vendor]').fill('코스트코');
  const row = form.locator('.item-edit').first();
  await row.locator('[data-f=name]').fill('멈 꼬르동루즈');
  await row.locator('[data-f=unitPrice]').fill('65900');
  await row.locator('.add-disc').click();
  await row.locator('[data-f=discount]').fill('14000');
  await expect(row.locator('[data-f=amount]')).toHaveValue('51900');
  await expect(row.locator('.disc-net')).toHaveText('정가 65,900원');
  await form.locator('button[type=submit]').click();

  await page.locator('.cell[data-date="2026-11-04"]').click();
  const li = sheet(page).locator('.item-btn', { hasText: '멈 꼬르동루즈' });
  await expect(li.locator('.disc')).toHaveText('└ 쿠폰·할인 -14,000원');
  await expect(li.locator('s')).toHaveText('65,900');
  await expect(li.locator('.iamt')).toContainText('51,900원');
});

test('날짜 상세의 추가 버튼은 촬영/앨범/직접 입력 메뉴를 열고, 직접 입력은 그 날짜로 채워진다', async ({ page }) => {
  await openApp(page, { data: seed() });
  await page.locator('.cell[data-date="2026-11-10"]').click();
  await sheet(page).locator('[data-day-act=add]').click();
  await expect(sheet(page).locator('.sheet-head h2')).toHaveText('11월 10일 매입 추가');
  await expect(sheet(page).locator('.menu-note')).toContainText('11월 10일');
  await sheet(page).locator('[data-src=manual]').click();
  await expect(page.locator('form.editor [name=date]')).toHaveValue('2026-11-10');
});
