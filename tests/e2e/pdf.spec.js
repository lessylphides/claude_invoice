// PDF 인식: 메뉴에서 PDF 고르기 → 3쪽이면 '인식 2회' 확인 → 서버에 PDF 로 보냄 → 확인 화면에 원본 PDF 링크
import { test, expect } from '@playwright/test';
import { openApp, mockClaude, ocrItem, PHOTO, sheet } from './helpers.js';

const pdf = (n) => ({
  name: '거래명세서.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from(
    `%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Count ${n} >> endobj\n` +
      Array.from({ length: n }, (_, i) => `${3 + i} 0 obj << /Type /Page /Parent 2 0 R >> endobj\n`).join('') +
      '%%EOF',
  ),
});

test('PDF 3쪽: 인식 2회 확인 후 PDF 로 인식, 원본 PDF 링크', async ({ page }) => {
  await page.route('**/api/level**', (r) => r.fulfill({ contentType: 'application/json', body: '{"gifts":[]}' }));
  const errors = await openApp(page, { data: {} });
  const reqs = await mockClaude(page, () => ({ documentType: '거래명세서', date: '2026-11-04', vendor: '서광컴퍼니', paymentHint: 'tax', total: 30000, items: [ocrItem('토닉워터', '주류·음료', 30000)] }));
  await page.locator('.fab').first().click();
  await expect(sheet(page)).toContainText('PDF 파일 선택');
  await page.locator('#pdf').setInputFiles(pdf(3));
  await expect(sheet(page)).toContainText('PDF 3쪽은(는) 인식 2회로 계산돼요');
  await sheet(page).locator('[data-ok]').click();
  await expect(page.locator('form.editor [name=vendor]')).toHaveValue('서광컴퍼니');
  await expect(page.locator('.pdf-link')).toContainText('원본 PDF 열기');
  expect(reqs[0].pdf).toBeTruthy();
  expect(reqs[0].images).toBeUndefined();
  expect(errors).toEqual([]);
});

test('PDF 7쪽은 인식 전에 안내, 사진 3장 합치기는 인식 2회 표시', async ({ page }) => {
  await page.route('**/api/level**', (r) => r.fulfill({ contentType: 'application/json', body: '{"gifts":[]}' }));
  await openApp(page, { data: {} });
  const reqs = await mockClaude(page, () => ({ documentType: '영수증', date: '2026-11-04', vendor: 'x', paymentHint: 'card', total: 1000, items: [ocrItem('a', '기타', 1000)] }));
  await page.locator('#pdf').setInputFiles(pdf(7));
  await expect(page.locator('.toast').last()).toContainText('6쪽까지');
  expect(reqs).toHaveLength(0);
  await page.locator('#gallery').setInputFiles([PHOTO, { ...PHOTO, name: 'b.png' }, { ...PHOTO, name: 'c.png' }]);
  await expect(sheet(page).locator('[data-merge=merge]')).toContainText('인식 2회');
});
