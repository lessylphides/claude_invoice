// 설정 → 문의하기: 종류를 고르면 안내·예시, 사진 붙이기, 보내기
import { test, expect } from '@playwright/test';
import { openApp, sheet } from './helpers.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

test('문의하기: 종류 → 안내·예시 → 사진 → 보내기 (기기·화면 정보 함께)', async ({ page }) => {
  let sent = null;
  await page.route('**/api/level**', (r) => r.fulfill({ contentType: 'application/json', body: '{"gifts":[]}' }));
  await page.route('**/api/support', async (r) => {
    sent = JSON.parse(r.request().postData());
    await r.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
  });
  const errors = await openApp(page, { data: {} });
  await page.locator('[data-act=settings]').first().click();
  await page.locator('[data-act=support]').click();
  const s = sheet(page);
  await expect(s).toContainText('하루 안에');
  await s.locator('button[type=submit]').click();
  await expect(page.locator('.toast').last()).toContainText('먼저 골라');
  await s.locator('label.chip', { hasText: '잘 안 돼요' }).click();
  await expect(s.locator('.support-guide')).toContainText('화면 캡처를 붙이면');
  await expect(s.locator('textarea')).toHaveAttribute('placeholder', /매입 탭에서 영수증을/);
  await s.locator('input[type=file]').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
  await expect(s.locator('.support-thumbs img')).toHaveCount(1);
  await s.locator('textarea').fill('영수증을 찍었는데 인식에 실패했어요.');
  await s.locator('button[type=submit]').click();
  await expect(page.locator('.toast').last()).toContainText('문의를 보냈어요');
  expect(sent).toMatchObject({ kind: 'bug', text: '영수증을 찍었는데 인식에 실패했어요.', meta: { tab: '매입 탭' } });
  expect(sent.images).toHaveLength(1);
  expect(errors).toEqual([]);
});
