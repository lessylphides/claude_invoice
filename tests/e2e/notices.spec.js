// 공지사항: 새 공지면 설정 아이콘에 빨간 점 → 설정 → 공지사항 → 읽으면 점이 사라짐. 중요 공지는 앱을 열 때 한 번
import { test, expect } from '@playwright/test';
import { openApp, sheet } from './helpers.js';

const NOW = Date.now();
const NOTICES = [
  { id: 'n2', at: NOW - 3600_000, kind: 'feature', title: '문의하기가 생겼어요', body: '설정 → 소식·도움 → 문의하기\n\n궁금한 점을 보내 주세요.', important: false },
  { id: 'n1', at: NOW - 86400_000 * 3, kind: 'fix', title: '확대·축소를 막았어요', body: '앱 화면이 커지지 않아요.', important: false },
];

test('새 공지 → 빨간 점 → 공지사항에서 읽으면 사라짐', async ({ page }) => {
  await page.route('**/api/level**', (r) => r.fulfill({ contentType: 'application/json', body: '{"gifts":[]}' }));
  await page.route('**/api/notices', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ notices: NOTICES }) }));
  const errors = await openApp(page, { data: {} });
  await expect(page.locator('[data-act=settings] .nt-dot')).toBeVisible();
  await page.locator('[data-act=settings]').first().click();
  await expect(page.locator('[data-act=notices] .nt-count')).toHaveText('2');
  await page.locator('[data-act=notices]').click();
  const s = sheet(page);
  await expect(s.locator('.nt-item').first()).toHaveAttribute('open', '');
  await expect(s.locator('.nt-item').first()).toContainText('궁금한 점을 보내 주세요');
  await expect(s.locator('.nt-new')).toHaveCount(2);
  await s.locator('.close').click();
  await expect(page.locator('[data-act=settings] .nt-dot')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('중요 공지는 앱을 열 때 한 번만 펼쳐서 보여 줌', async ({ page }) => {
  await page.route('**/api/level**', (r) => r.fulfill({ contentType: 'application/json', body: '{"gifts":[]}' }));
  const imp = [{ id: 'n9', at: NOW - 600_000, kind: 'notice', title: '요금제가 바뀌어요', body: '12월부터 …', important: true }, ...NOTICES];
  await page.route('**/api/notices', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ notices: imp }) }));
  await openApp(page, { data: {} });
  const s = sheet(page);
  await expect(s.locator('.nt-item[open]')).toContainText('요금제가 바뀌어요');
  await s.locator('.close').click();
  await page.reload();
  await expect(page.locator('.tabbar')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator('.sheet-wrap')).toHaveCount(0);
});
