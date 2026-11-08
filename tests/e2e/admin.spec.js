// 운영 현황: 운영자에게만 보이고, 가입자·구독·인식량·비용을 보여 줌
import { test, expect } from '@playwright/test';
import { openApp, sheet } from './helpers.js';

const status = (owner) => ({ mode: 'test', owner, customerKey: 'cn_x', subscription: null, entitlement: { kind: 'legacy', day: 30, month: 300 }, usage: { day: 0, month: 0, total: 0, period: 0 } });
const days = Array.from({ length: 30 }, (_, i) => ({ date: `2026-10-${String(i + 6).padStart(2, '0')}`.replace('2026-10-32', '2026-11-01'), count: i % 5, failed: i === 29 ? 1 : 0, costKrw: (i % 5) * 42 }));
const stats = {
  mode: 'test', fx: 1450, model: 'claude-opus-5-5',
  users: { total: 12, confirmed: 10, new7: 3, new30: 12, active7: 5, ledgers: 9, ocrUsers30: 4, signups: [] },
  ocr: { days, count30: 58, failed30: 1, costKrw30: 2478, perReceiptKrw: 42, avgInput: 5200, avgOutput: 480, models: { 'claude-opus-5-5': 59 },
    month: { key: '2026-11', count: 20, costKrw: 840, users: 4, avg: 5, median: 4, max: 9, buckets: [{ label: '1~20장', users: 4 }, { label: '21~50장', users: 0 }, { label: '51~120장', users: 0 }, { label: '121~250장', users: 0 }, { label: '251장 이상', users: 0 }] } },
  billing: { paying: 1, byPlan: { lite: 0, basic: 1, pro: 0, unlimited: 0 }, mrr: 9900, canceling: 0, pastDue: 0, paid30: 14900, payments: [{ email: 'a@x', amount: 9900, orderName: '코스트노트 기본 요금제 (1개월)', at: Date.parse('2026-11-04T09:00:00+09:00') }] },
};

for (const owner of [false, true])
  test(`운영 현황 메뉴는 운영자에게만 (${owner ? '운영자' : '일반'})`, async ({ page }) => {
    await page.route('**/api/billing**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(status(owner)) }));
    await page.route('**/api/admin', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(stats) }));
    const errors = await openApp(page);
    await page.locator('[data-act=settings]').click();
    await expect(sheet(page).locator('.ocr-usage .meter').first()).toBeVisible();
    if (!owner) return expect(sheet(page).locator('[data-act=admin]')).toBeHidden();
    await sheet(page).locator('[data-act=admin]').click();
    const s = sheet(page);
    await expect(s.locator('.stat-tile').first()).toContainText('12명');
    await expect(s).toContainText('9,900원'); // MRR
    await expect(s).toContainText('1장당 원가');
    await expect(s.locator('.bar-hit')).toHaveCount(30);
    await s.locator('.bar-hit').last().click();
    await expect(s.locator('.chart-readout')).toContainText('실패 1');
    await expect(s.locator('.hbar-row').first()).toContainText('4명');
    expect(errors).toEqual([]);
  });

test('회원 관리: 찾기 → 추가 인식 주기 → 이용 정지', async ({ page }) => {
  const U = '11111111-2222-3333-4444-555555555555';
  const user = { id: U, email: 'shop@example.com', created_at: '2026-11-01T00:00:00Z', last_sign_in_at: '2026-11-03T00:00:00Z', confirmed: true, suspended: false, reason: null, bonus: 0, bonus_granted: 0, ocr_month: 12, ocr_total: 20, has_ledger: true, plan: null };
  const posts = [];
  await page.route('**/api/billing**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(status(true)) }));
  await page.route('**/api/admin', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(stats) }));
  await page.route('**/api/admin/users**', async (r) => {
    const req = r.request();
    if (req.method() === 'POST') {
      const b = JSON.parse(req.postData());
      posts.push({ url: new URL(req.url()).pathname, body: b });
      if (b.addBonus) Object.assign(user, { bonus: user.bonus + b.addBonus, bonus_granted: user.bonus_granted + b.addBonus });
      if (typeof b.suspended === 'boolean') Object.assign(user, { suspended: b.suspended, reason: b.reason ?? null });
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ account: { bonus: user.bonus, bonus_granted: user.bonus_granted, suspended: user.suspended, reason: user.reason } }) });
    }
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ users: [user] }) });
  });
  const errors = await openApp(page);
  await page.locator('[data-act=settings]').click();
  await sheet(page).locator('[data-act=admin]').click();
  await sheet(page).locator('[data-act=members]').click();
  const list = sheet(page);
  await expect(list.locator('[data-uid]')).toContainText('shop@example.com');
  await expect(list.locator('[data-uid]')).toContainText('이번 달 인식 12장');
  await list.locator('[data-uid]').click();

  const m = sheet(page);
  await m.locator('[data-bonus="30"]').click();
  await expect(m.locator('.usage-title')).toContainText('남은 추가 인식 30장');
  expect(posts[0]).toEqual({ url: `/api/admin/users/${U}`, body: { addBonus: 30 } });

  page.once('dialog', (d) => d.accept('결제 분쟁'));
  await m.locator('[data-act=suspend]').click();
  await expect(m.locator('.ci-advice')).toContainText('사유: 결제 분쟁');
  expect(posts[1].body).toEqual({ suspended: true, reason: '결제 분쟁' });
  await expect(m.locator('[data-act=unsuspend]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('정지된 계정은 설정에 정지 안내, 추가 인식이 있으면 남은 장수 표시', async ({ page }) => {
  const st = (account) => ({ ...status(false), usage: { day: 0, month: 0, total: 0, period: 0, account } });
  let account = { suspended: false, reason: null, bonus: 7 };
  await page.route('**/api/billing**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(st(account)) }));
  await openApp(page);
  await page.locator('[data-act=settings]').click();
  await expect(sheet(page).locator('.ocr-usage')).toContainText('추가 인식 7장 남음');
  await page.keyboard.press('Escape');
  account = { suspended: true, reason: '약관 위반', bonus: 0 };
  await page.locator('[data-act=settings]').click();
  await expect(sheet(page).locator('.ocr-usage')).toContainText('이용 정지');
  await expect(sheet(page).locator('.ocr-usage')).toContainText('약관 위반');
});
