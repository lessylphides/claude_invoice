// 레벨: 헤더 배지(매입·원가 탭), 영수증을 저장하면 +10과 레벨업, 서버에서 선물 받기, 레벨 화면
import { test, expect } from '@playwright/test';
import { openApp, mockClaude, ocrItem, PHOTO, purchase, item, sheet } from './helpers.js';

// 띄엄띄엄 4건 (연속 기록 보너스 없이 40점)
const four = () => ({
  purchases: ['2026-10-20', '2026-10-23', '2026-10-26', '2026-10-29'].map((d, i) => purchase(`p${i}`, d, `가게${i}`, [item(`품목${i}`, '기타', 1000 + i)])),
});

test('배지에 레벨, 영수증을 저장하면 +10 → Lv.2 달성 → 레벨업 선물', async ({ page }) => {
  const claims = [];
  await page.route('**/api/level/claim', (r) => {
    claims.push(1);
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ rewarded: 2, balance: 3, granted: 3, history: [], gifts: [{ level: 2, amount: 3 }] }) });
  });
  const errors = await openApp(page, { data: four() });
  const badge = page.locator('.lv-badge');
  await expect(badge).toContainText('Lv.1');
  await expect(badge).toContainText('새내기 사장');
  await page.locator('[data-tab=cost]').click();
  await expect(page.locator('.lv-badge')).toContainText('Lv.1'); // 원가 탭에도 같은 자리
  await page.locator('[data-tab=purchase]').click();

  await mockClaude(page, () => ({ documentType: '영수증', date: '2026-11-04', vendor: '새 가게', paymentHint: 'card', total: 5000, items: [ocrItem('양파', '기타', 5000)] }));
  await page.locator('#cam').setInputFiles(PHOTO);
  await page.locator('form.editor button[type=submit]').click();
  await expect(page.locator('.lv-badge')).toContainText('Lv.2');
  await expect(page.locator('.lv-badge')).toContainText('영수증 모으는 사장');
  await expect(page.locator('.lv-plus')).toHaveText('+10');
  await expect(page.locator('.toast').last()).toContainText('레벨업 선물', { timeout: 10000 });
  expect(claims.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('레벨 화면: 포인트 내역·다음 선물·받은 선물', async ({ page }) => {
  await page.route('**/api/level', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ rewarded: 1, balance: 0, granted: 0, history: [] }) }));
  await page.route('**/api/level/claim', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ gifts: [] }) }));
  await openApp(page, { data: four() });
  await page.locator('.lv-badge').click();
  const s = sheet(page);
  await expect(s.locator('.lv-big')).toContainText('Lv.1 새내기 사장');
  await expect(s).toContainText('다음 레벨(Lv.2 영수증 모으는 사장)까지 10점');
  await expect(s).toContainText('추가 인식 3장');
  await expect(s.locator('.set-row', { hasText: '영수증 기록 4건' })).toContainText('40점');
  await expect(s.locator('.lv-gifts')).toContainText('남은 선물 0장');
});
