// 요금제: 고르기 → 동의 → 토스페이먼츠 카드 등록창 → 돌아와서 첫 결제 / 바꾸기·해지
import { test, expect } from '@playwright/test';
import { openApp, sheet, TEST_USER } from './helpers.js';

const CK = `cn_${TEST_USER.id}`;
const PERIOD_END = Date.parse('2026-12-04T10:00:00+09:00');

/** 가짜 결제 서버(/api/billing). 앱이 보낸 요청은 requests 에 쌓임 */
async function fakeBilling(page, { mode = 'test', sub = null, entitlement = null } = {}) {
  const s = { sub, requests: [] };
  const statusBody = () => ({
    mode,
    customerKey: CK,
    subscription: s.sub,
    entitlement: s.sub ? { kind: 'plan', plan: s.sub.plan, day: 20, month: 120 } : entitlement ?? { kind: 'trial', day: 20, month: null, total: 20 },
    usage: { day: 2, month: 5, total: 5, period: 3 },
  });
  await page.route('**/api/billing**', async (route) => {
    const req = route.request();
    const action = new URL(req.url()).pathname.replace(/^\/api\/billing\/?/, '') || 'status';
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    s.requests.push({ action, body, auth: req.headers()['authorization'] });
    if (action === 'subscribe')
      s.sub = { plan: body.plan, status: 'active', periodStart: Date.now(), periodEnd: PERIOD_END, cancelAtPeriodEnd: false, nextPlan: null, card: { company: '신한', number: '4330****1234' }, payments: [{ amount: 9900, orderName: '코스트노트 기본 요금제 (1개월)', at: Date.now(), receipt: null }] };
    if (action === 'change') s.sub = { ...s.sub, plan: body.plan };
    if (action === 'cancel') s.sub = { ...s.sub, cancelAtPeriodEnd: true };
    if (action === 'resume') s.sub = { ...s.sub, cancelAtPeriodEnd: false };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(action === 'close' ? { closed: true } : statusBody()) });
  });
  // 토스페이먼츠 SDK 대신: 카드 등록창을 연 것처럼 successUrl 로 돌아옴
  await page.route('https://js.tosspayments.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.TossPayments = function (clientKey) {
        return { payment: function (init) { return { requestBillingAuth: async function (o) {
          sessionStorage.setItem('__toss', JSON.stringify({ clientKey: clientKey, customerKey: init.customerKey, o: o }));
          location.href = o.successUrl + '&customerKey=' + encodeURIComponent(init.customerKey) + '&authKey=ak_test';
        } }; } };
      };`,
    }),
  );
  return s;
}

async function openPlansFromSettings(page) {
  await page.locator('[data-act=settings]').click();
  await expect(sheet(page).locator('.ocr-usage')).toContainText('무료 체험');
  await sheet(page).locator('[data-act=plans]').click();
  await expect(sheet(page).locator('.plan-list')).toBeVisible();
}

test('구독 시작: 동의해야 카드 등록창으로 가고, 돌아오면 첫 결제를 마무리한다', async ({ page }) => {
  const server = await fakeBilling(page);
  const errors = await openApp(page);
  await openPlansFromSettings(page);
  const s = sheet(page);
  await expect(s.locator('.plan-test')).toContainText('시험 결제');
  await expect(s).toContainText('20장 중 5장 사용');

  // 프로 선택 → 버튼 문구가 바뀜
  await s.locator('.plan-opt', { hasText: '프로' }).click();
  await expect(s.locator('[data-act=start]')).toHaveText('카드 등록하고 프로 시작 (월 19,900원)');
  await s.locator('.plan-opt', { hasText: '기본' }).click();

  // 동의 안 하면 막음
  await s.locator('[data-act=start]').click();
  await expect(s.locator('.plan-err')).toContainText('동의해 주세요');
  await s.locator('[name=agree]').check();
  await s.locator('[data-act=start]').click();

  // 카드 등록창(가짜)을 거쳐 돌아옴 → 서버에 구독 요청 → 안내
  await expect(page.locator('.toast').last()).toContainText('기본 요금제를 시작했어요');
  const toss = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__toss')));
  expect(toss.clientKey).toMatch(/^test_ck_/);
  expect(toss.customerKey).toBe(CK);
  expect(toss.o).toMatchObject({ method: 'CARD', windowTarget: 'self', customerEmail: TEST_USER.email });
  expect(server.requests.find((r) => r.action === 'subscribe')).toMatchObject({
    body: { plan: 'basic', authKey: 'ak_test', customerKey: CK },
    auth: 'Bearer test-access-token',
  });
  // 주소에서 결제 정보를 지움
  expect(new URL(page.url()).search).toBe('');
  await expect(sheet(page).locator('.plan-current')).toContainText('기본 요금제 이용 중');
  await expect(sheet(page).locator('.plan-current')).toContainText('4330****1234');
  await expect(sheet(page).locator('.pay-list')).toContainText('9,900원');
  expect(errors).toEqual([]);
});

test('구독 중: 올리기는 확인 후 바로, 해지와 해지 취소', async ({ page }) => {
  const sub = { plan: 'basic', status: 'active', periodStart: 0, periodEnd: PERIOD_END, cancelAtPeriodEnd: false, nextPlan: null, card: null, payments: [] };
  const server = await fakeBilling(page, { sub });
  await openApp(page);
  await page.locator('[data-act=settings]').click();
  await expect(sheet(page).locator('.ocr-usage')).toContainText('기본 요금제');
  await sheet(page).locator('[data-act=plans]').click();
  const s = sheet(page);
  await expect(s.locator('.plan-opt.on')).toContainText('이용 중');
  await expect(s.locator('[name=agree]')).toHaveCount(0); // 이미 구독 중이면 동의 체크 없음

  await s.locator('.plan-opt', { hasText: '프로' }).click();
  await expect(s.locator('[data-act=change]')).toContainText('차액 10,000원');
  page.once('dialog', (d) => d.accept());
  await s.locator('[data-act=change]').click();
  await expect(page.locator('.toast').last()).toContainText('프로 요금제로 바꿨어요');
  expect(server.requests.find((r) => r.action === 'change').body).toEqual({ plan: 'pro' });

  page.once('dialog', (d) => d.accept());
  await s.locator('[data-act=cancel]').click();
  await expect(s.locator('.plan-current')).toContainText('구독이 끝나요');
  await s.locator('[data-act=resume]').click();
  await expect(s.locator('[data-act=cancel]')).toBeVisible();
});

test('결제 기능이 꺼져 있으면 요금제 버튼을 보여 주지 않는다', async ({ page }) => {
  await fakeBilling(page, { mode: 'off', entitlement: { kind: 'legacy', day: 30, month: 300 } });
  await openApp(page);
  await page.locator('[data-act=settings]').click();
  await expect(sheet(page).locator('.ocr-usage .meter').first()).toContainText('오늘2 / 30회');
  await expect(sheet(page).locator('.ocr-usage .meter').nth(1)).toContainText('이번 달5 / 300회');
  await expect(sheet(page).locator('[data-act=plans]')).toBeHidden();
});

test('카드 등록을 취소하고 돌아오면 안내만 한다', async ({ page }) => {
  const server = await fakeBilling(page);
  await openApp(page, { path: '/?billing=fail&code=PAY_PROCESS_CANCELED&message=x' });
  await expect(page.locator('.toast').last()).toContainText('카드 등록을 취소했어요');
  expect(server.requests.filter((r) => r.action === 'subscribe')).toEqual([]);
  expect(new URL(page.url()).search).toBe('');
});
