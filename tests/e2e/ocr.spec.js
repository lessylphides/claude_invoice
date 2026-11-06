// 영수증 인식: Claude 요청 형식, 결과 → 입력 화면, 여러 장 합치기, 실패·키 없음, 용량 자동 채우기
import { test, expect } from '@playwright/test';
import { openApp, mockClaude, ocrItem, PHOTO, KEY, purchase, item, sheet } from './helpers.js';

const costco = {
  documentType: '영수증', date: '2026-10-28', vendor: '(주)코스트코코리아 양재점', paymentHint: 'card', total: 113680,
  items: [
    ocrItem('멈 꼬르동루즈', '주류·음료', 65900, { discount: 14000 }),
    ocrItem('몽키숄더700ML', '주류·음료', 49790, { discount: 10000, packSize: 700, packUnit: 'ml' }),
    ocrItem('바스크치즈케이크', '유제품·계란', 17990),
    ocrItem('블루베리510G', '채소·과일', 22990),
  ],
};
costco.total = costco.items.reduce((s, i) => s + i.amount, 0);

test('사진 한 장: 요청 형식과 인식 결과 → 확인 화면 → 영수증 날짜의 달로 이동', async ({ page }) => {
  const errors = await openApp(page, { settings: KEY });
  const requests = await mockClaude(page, () => costco);
  await page.locator('#cam').setInputFiles(PHOTO);
  const form = page.locator('form.editor');
  await expect(form).toBeVisible();

  const req = requests[0];
  expect(req.model).toBe('claude-opus-5-5');
  expect(req.fallbacks).toBe('default');
  expect(req.output_config.format.type).toBe('json_schema');
  expect(req.output_config.effort).toBe('medium');
  const images = req.messages[0].content.filter((c) => c.type === 'image');
  expect(images).toHaveLength(1);
  expect(images[0].source.media_type).toBe('image/jpeg');
  const itemSchema = req.output_config.format.schema.properties.items.items;
  expect(itemSchema.required).toEqual(expect.arrayContaining(['discount', 'packSize', 'packUnit']));

  await expect(form.locator('[name=date]')).toHaveValue('2026-10-28');
  await expect(form.locator('[name=vendor]')).toHaveValue('(주)코스트코코리아 양재점');
  await expect(form.locator('.pay-opt.on [data-pay=card]')).toBeChecked();
  await expect(form.locator('.item-edit')).toHaveCount(4);
  await expect(form.locator('.notice')).toHaveCount(0); // 합계 일치, 날짜 있음
  const mumm = form.locator('.item-edit').first();
  await expect(mumm.locator('[data-f=discount]')).toHaveValue('14000');
  await expect(mumm.locator('[data-f=amount]')).toHaveValue('51900');
  // 이름의 용량(510G)은 추정해서 채움
  await expect(form.locator('.item-edit').nth(3).locator('[data-f=packSize]')).toHaveValue('510');
  await expect(form.locator('.item-edit').nth(3).locator('[data-f=packUnit]')).toHaveValue('g');
  await expect(form.locator('.sum')).toHaveText('132,670원');

  await form.locator('button[type=submit]').click();
  await expect(page.locator('.month-title')).toHaveText('2026년 10월');
  await expect(page.locator('.cell[data-date="2026-10-28"] .amt')).toHaveText('13.3만');
  expect(errors).toEqual([]);
});

test('날짜를 못 읽거나 합계가 다르면 확인 화면에 안내한다', async ({ page }) => {
  await openApp(page, { settings: KEY });
  await mockClaude(page, () => ({ ...costco, date: '', total: 999999 }));
  await page.locator('#cam').setInputFiles(PHOTO);
  const notice = page.locator('.sheet-body .notice');
  await expect(notice).toContainText('날짜를 읽지 못해');
  await expect(notice).toContainText('문서 합계(999,999원)');
  await expect(page.locator('form.editor [name=date]')).toHaveValue('2026-11-04');
});

test('여러 장 → "영수증 한 장이에요": 한 번의 요청에 사진을 순서대로 담는다', async ({ page }) => {
  await openApp(page, { settings: KEY });
  const requests = await mockClaude(page, () => costco);
  await page.locator('#gallery').setInputFiles([PHOTO, { ...PHOTO, name: 'b.png' }, { ...PHOTO, name: 'c.png' }]);
  await expect(sheet(page).locator('.sheet-head h2')).toHaveText('사진 3장을 골랐습니다');
  await page.locator('[data-merge=merge]').click();
  await expect(page.locator('form.editor')).toBeVisible();
  expect(requests).toHaveLength(1);
  const content = requests[0].messages[0].content;
  expect(content.filter((c) => c.type === 'image')).toHaveLength(3);
  expect(content.filter((c) => c.type === 'text').map((c) => c.text).slice(0, 3)).toEqual(['사진 1/3', '사진 2/3', '사진 3/3']);
  await expect(page.locator('.photo summary')).toHaveText('촬영한 사진 보기 (3장)');
});

test('여러 장 → "각각 다른 영수증": 사진마다 따로 인식하고 차례로 확인한다', async ({ page }) => {
  await openApp(page, { settings: KEY });
  const requests = await mockClaude(page, (_, n) => ({ ...costco, vendor: `가게${n}`, items: [ocrItem(`품목${n}`, '기타', 1000 * n)], total: 1000 * n }));
  await page.locator('#gallery').setInputFiles([PHOTO, { ...PHOTO, name: 'b.png' }]);
  await page.locator('[data-merge=separate]').click();
  await expect(page.locator('form.editor')).toBeVisible();
  expect(requests).toHaveLength(2);
  await page.locator('form.editor button[type=submit]').click();
  await expect(page.locator('form.editor')).toBeVisible(); // 두 번째 확인 화면
  await page.locator('form.editor button[type=submit]').click();
  await expect(page.locator('form.editor')).toHaveCount(0);
  await page.locator('.cell[data-date="2026-10-28"]').click();
  await expect(sheet(page).locator('.vendor-card')).toHaveCount(2);
});

test('인식이 실패하면 사진을 둔 채 직접 입력 화면을 연다', async ({ page }) => {
  await openApp(page, { settings: KEY });
  await mockClaude(page, () => ({ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }));
  await page.locator('#cam').setInputFiles(PHOTO);
  await expect(page.locator('.notice')).toContainText('API 키가 올바르지 않습니다');
  await expect(page.locator('.photo')).toBeVisible();
});

test('크레딧이 떨어지거나 사용 한도에 닿으면 충전 안내와 함께 직접 입력 화면을 연다', async ({ page }) => {
  await openApp(page, { settings: KEY });
  let msg = 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.';
  await mockClaude(page, () => ({ status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: msg } } }));
  await page.locator('#cam').setInputFiles(PHOTO);
  await expect(page.locator('.notice')).toContainText('API 크레딧이 다 떨어졌어요');
  await expect(page.locator('.notice')).not.toContainText('credit balance');
  await expect(page.locator('.photo')).toBeVisible();
  await page.locator('form.editor .cancel').click();

  msg = 'You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.';
  await page.locator('#cam').setInputFiles(PHOTO);
  await expect(page.locator('.notice')).toContainText('이번 달 API 사용 한도에 닿았어요');
});

test('다른 요청 오류는 원래 내용을 그대로 보여 준다', async ({ page }) => {
  await openApp(page, { settings: KEY });
  await mockClaude(page, () => ({ status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'image too large' } } }));
  await page.locator('#cam').setInputFiles(PHOTO);
  await expect(page.locator('.notice')).toContainText('요청 오류');
  await expect(page.locator('.notice')).toContainText('image too large');
});

test('API 키가 없으면 인식 없이 사진과 함께 직접 입력 화면을 연다', async ({ page }) => {
  await openApp(page);
  const requests = await mockClaude(page, () => costco);
  await page.locator('#cam').setInputFiles(PHOTO);
  await expect(page.locator('form.editor')).toBeVisible();
  await expect(page.locator('.photo')).toBeVisible();
  expect(requests).toHaveLength(0);
});

test('같은 품목을 전에 산 적이 있으면 그때의 용량을 불러오고 "이전 기록"으로 표시한다', async ({ page }) => {
  const data = {
    categories: ['주류·음료', '유제품·계란', '채소·과일', '기타'],
    purchases: [purchase('old', '2026-09-20', '코스트코', [item('바스크치즈케이크', '유제품·계란', 17990, { packSize: 7, packUnit: '개' })])],
  };
  await openApp(page, { data, settings: KEY });
  await mockClaude(page, () => costco);
  await page.locator('#cam').setInputFiles(PHOTO);
  const cake = page.locator('form.editor .item-edit').nth(2);
  await expect(cake.locator('[data-f=packSize]')).toHaveValue('7');
  await expect(cake.locator('[data-f=packUnit]')).toHaveValue('개');
  await expect(cake.locator('.spec-tag')).toHaveText('이전 기록');
  // 인식이 읽어 온 용량(700ml)은 그대로
  await expect(page.locator('form.editor .item-edit').nth(1).locator('[data-f=packSize]')).toHaveValue('700');
});

test('직접 입력 중 품목명을 적으면 이전 용량을 채우고 포커스는 다음 칸으로 넘어간다', async ({ page }) => {
  const data = { purchases: [purchase('old', '2026-09-20', '코스트코', [item('몽키숄더700ML', '주류·음료', 45990, { packSize: 700, packUnit: 'ml' })])] };
  await openApp(page, { data });
  await page.locator('[data-act=capture]').click();
  await page.locator('[data-src=manual]').click();
  const row = page.locator('form.editor .item-edit').first();
  await row.locator('[data-f=name]').fill('몽키숄더700ML');
  await row.locator('[data-f=name]').press('Tab');
  await expect(row.locator('[data-f=packSize]')).toHaveValue('700');
  await expect(row.locator('.spec-tag')).toHaveText('이전 기록');
  // 포커스가 문서 밖(body)으로 빠지지 않음
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
});
