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
