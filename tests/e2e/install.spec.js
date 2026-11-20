// 홈 화면에 설치: 안드로이드 크롬은 버튼으로 바로 설치 창, 그 밖은 방법 안내. 앱으로 열었으면 안 보임
import { test, expect } from '@playwright/test';
import { openApp, purchase, item, sheet } from './helpers.js';

const data = { purchases: [purchase('p', '2026-11-03', '마트', [item('레몬', '채소·과일', 900)])], menus: [] };
const local = { 'costnote:onboard-hide': 1 };

test.beforeEach(async ({ page }) => {
  await page.route('**/api/level**', (r) => r.fulfill({ contentType: 'application/json', body: '{"gifts":[]}' }));
  await page.route('**/api/notices', (r) => r.fulfill({ contentType: 'application/json', body: '{"notices":[]}' }));
});

test('크롬이 설치 창을 주면: 띠의 [설치] → 설치 창, 설치되면 안내', async ({ page }) => {
  const errors = await openApp(page, { data, local });
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = () => { window.__prompted = true; return Promise.resolve(); };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    dispatchEvent(e);
  });
  const banner = page.locator('.install-banner');
  await expect(banner).toContainText('홈 화면에 설치');
  await banner.locator('[data-onboard=install]').click();
  await expect.poll(() => page.evaluate(() => window.__prompted)).toBe(true);
  await page.evaluate(() => dispatchEvent(new Event('appinstalled')));
  await expect(page.locator('.toast').last()).toContainText('설치했어요');
  expect(errors).toEqual([]);
});

test('설치 창이 없으면(삼성 인터넷·아이폰 등) 방법 안내, 띠는 닫으면 다시 안 보임, 설정에도 있음', async ({ page }) => {
  await openApp(page, { data, local });
  await page.locator('.install-banner [data-onboard=install]').click();
  await expect(sheet(page)).toContainText('홈 화면에 추가');
  await sheet(page).locator('.close').click();
  await page.locator('.install-banner [data-onboard=install-hide]').click();
  await expect(page.locator('.install-banner')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.tabbar')).toBeVisible();
  await expect(page.locator('.install-banner')).toHaveCount(0);
  await page.locator('[data-act=settings]').first().click();
  await expect(page.locator('[data-act=install]')).toContainText('홈 화면에 설치');
});

test('홈 화면 앱으로 열었으면 설치 안내가 없음', async ({ page }) => {
  await page.addInitScript(() => {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => (q.includes('standalone') ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : mm(q));
  });
  await openApp(page, { data, local });
  await expect(page.locator('.install-banner')).toHaveCount(0);
  await page.locator('[data-act=settings]').first().click();
  await expect(page.locator('[data-act=install]')).toHaveCount(0);
});

test('manifest: 안드로이드용(maskable) 아이콘', async ({ request }) => {
  const m = await (await request.get('/manifest.webmanifest')).json();
  expect(m.icons.filter((i) => i.purpose === 'maskable').map((i) => i.sizes)).toEqual(['192x192', '512x512']);
  expect((await request.get('/icon-maskable-512.png')).status()).toBe(200);
});

for (const [name, ua, expects] of [
  ['아이폰 사파리 iOS 26', 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1', ['≡', '공유', '더 보기', '웹 앱으로 열기', '한 번 더 로그인']],
  ['아이폰 사파리 iOS 18', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1', ['공유 버튼(□↑)', '홈 화면에 추가']],
  ['아이폰 크롬', 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1', ['크롬 주소창', 'Safari']],
]) {
  test.describe(name, () => {
    test.use({ userAgent: ua });
    test(`${name}: 기기에 맞는 순서를 그림과 함께 안내`, async ({ page }) => {
      await openApp(page, { data, local });
      await page.locator('.install-banner [data-onboard=install]').click();
      const s = sheet(page);
      await expect(s.locator('.ig-steps li').first()).toBeVisible();
      for (const t of expects) await expect(s).toContainText(t);
      await expect(s).toContainText('애플 정책');
    });
  });
}
