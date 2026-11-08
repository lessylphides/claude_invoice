// 영수증 인식: Claude 요청 형식, 결과 → 입력 화면, 여러 장 합치기, 실패·키 없음, 용량 자동 채우기
import { test, expect } from '@playwright/test';
import { openApp, mockClaude, ocrItem, PHOTO, purchase, item, sheet } from './helpers.js';

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
  const errors = await openApp(page);
  const requests = await mockClaude(page, () => costco);
  await page.locator('#cam').setInputFiles(PHOTO);
  const form = page.locator('form.editor');
  await expect(form).toBeVisible();

  // 앱 → 우리 서버: 로그인 토큰 + JPEG 사진 + 분류 목록 (Claude 요청은 서버가 만듦, tests/unit/ocrServer.test.js)
  const req = requests[0];
  expect(req.authorization).toBe('Bearer test-access-token');
  expect(req.images).toHaveLength(1);
  expect(atob(req.images[0]).slice(0, 3)).toBe('\xff\xd8\xff'); // JPEG 로 바꿔 보냄
  expect(req.categories.length).toBeGreaterThan(0);
  expect(req).not.toHaveProperty('apiKey');

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
  await openApp(page);
  await mockClaude(page, () => ({ ...costco, date: '', total: 999999 }));
  await page.locator('#cam').setInputFiles(PHOTO);
  const notice = page.locator('.sheet-body .notice');
  await expect(notice).toContainText('날짜를 읽지 못해');
  await expect(notice).toContainText('문서 합계(999,999원)');
  await expect(page.locator('form.editor [name=date]')).toHaveValue('2026-11-04');
});

test('여러 장 → "영수증 한 장이에요": 한 번의 요청에 사진을 순서대로 담는다', async ({ page }) => {
  await openApp(page);
  const requests = await mockClaude(page, () => costco);
  await page.locator('#gallery').setInputFiles([PHOTO, { ...PHOTO, name: 'b.png' }, { ...PHOTO, name: 'c.png' }]);
  await expect(sheet(page).locator('.sheet-head h2')).toHaveText('사진 3장을 골랐습니다');
  await page.locator('[data-merge=merge]').click();
  await expect(page.locator('form.editor')).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].images).toHaveLength(3); // 사진 번호 붙이기는 서버가 함 (tests/unit/ocrServer.test.js)
  await expect(page.locator('.photo summary')).toHaveText('촬영한 사진 보기 (3장)');
});

test('여러 장 → "각각 다른 영수증": 사진마다 따로 인식하고 차례로 확인한다', async ({ page }) => {
  await openApp(page);
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

test('인식이 실패하면 서버의 안내와 함께 사진을 둔 채 직접 입력 화면을 연다', async ({ page }) => {
  await openApp(page);
  await mockClaude(page, () => ({ status: 401, body: { error: { code: 'login', message: '로그인이 만료됐어요. 다시 로그인해 주세요.' } } }));
  await page.locator('#cam').setInputFiles(PHOTO);
  await expect(page.locator('.notice')).toContainText('자동 인식 실패: 로그인이 만료됐어요');
  await expect(page.locator('.photo')).toBeVisible();
});

test('사용 한도를 넘거나 서비스를 쓸 수 없으면 서버 안내를 그대로 보여 준다', async ({ page }) => {
  await openApp(page);
  let reply = { status: 429, body: { error: { code: 'daily_limit', message: '오늘 영수증 인식(30회)을 다 썼어요. 내일 다시 쓸 수 있어요. 지금은 직접 입력해 주세요.' } } };
  await mockClaude(page, () => reply);
  await page.locator('#cam').setInputFiles(PHOTO);
  await expect(page.locator('.notice')).toContainText('오늘 영수증 인식(30회)을 다 썼어요');
  await page.locator('form.editor .cancel').click();

  reply = { status: 503, body: { error: { code: 'billing', message: '영수증 인식 서비스를 잠시 쓸 수 없어요. 지금은 직접 입력해 주세요.' } } };
  await page.locator('#cam').setInputFiles(PHOTO);
  await expect(page.locator('.notice')).toContainText('영수증 인식 서비스를 잠시 쓸 수 없어요');
});

test('서버가 엉뚱한 응답을 주거나 연결이 끊기면 알아듣기 쉬운 안내', async ({ page }) => {
  await openApp(page);
  await page.route('**/api/ocr', (r) => r.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad gateway</html>' }));
  await page.locator('#cam').setInputFiles(PHOTO);
  await expect(page.locator('.notice')).toContainText('영수증 인식 서버에 연결하지 못했어요 (502)');
  await page.locator('form.editor .cancel').click();
  await page.unroute('**/api/ocr');
  await page.route('**/api/ocr', (r) => r.abort('internetdisconnected'));
  await page.locator('#cam').setInputFiles(PHOTO);
  await expect(page.locator('.notice')).toContainText('인터넷 연결을 확인해 주세요');
});

test('같은 품목을 전에 산 적이 있으면 그때의 용량을 불러오고 "이전 기록"으로 표시한다', async ({ page }) => {
  const data = {
    categories: ['주류·음료', '유제품·계란', '채소·과일', '기타'],
    purchases: [purchase('old', '2026-09-20', '코스트코', [item('바스크치즈케이크', '유제품·계란', 17990, { packSize: 7, packUnit: '개' })])],
  };
  await openApp(page, { data });
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

test('인식 결과를 저장하면 고친 개수만 서버로 보낸다 (내용은 보내지 않음)', async ({ page }) => {
  await openApp(page);
  await mockClaude(page, () => costco);
  const feedback = [];
  await page.route('**/api/ocr/feedback', async (route) => {
    feedback.push({ body: JSON.parse(route.request().postData()), auth: route.request().headers()['authorization'] });
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.locator('#cam').setInputFiles(PHOTO);
  const form = page.locator('form.editor');
  await form.locator('[name=vendor]').fill('코스트코 양재');
  await form.locator('.item-edit').first().locator('[data-f=name]').fill('멈 꼬르동루즈 750ml');
  await form.locator('button[type=submit]').click();
  await expect.poll(() => feedback.length).toBe(1);
  expect(feedback[0].auth).toBe('Bearer test-access-token');
  expect(feedback[0].body).toMatchObject({ receipts: 1, untouched: 0, vendor: 1, name: 1, price: 0, date: 0, items: 4 });
  const sent = JSON.stringify(feedback[0].body);
  expect(sent).not.toContain('코스트코');
  expect(sent).not.toContain('꼬르동');
});
