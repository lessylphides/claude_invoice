// 세금계산서 뷰어(etax-viewer/): 파일 고르기 → 번호 → 요약·원본·XML, 바깥으로 나가는 요청 없음
// 코스트노트 앱과 따로 떨어진 정적 페이지라 디스크에서 바로 읽어 가짜 주소로 띄움
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makeSecureMail, SAMPLE_ID } from '../unit/etaxSample.js';

const ORIGIN = 'https://etax.test';
const DIR = new URL('../../etax-viewer/', import.meta.url);
const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css' };

test.use({ storageState: { cookies: [], origins: [] } });

async function openViewer(page) {
  const outside = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) {
      outside.push(url.href);
      return route.abort();
    }
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    try {
      const body = await readFile(new URL(name, DIR));
      return route.fulfill({ body, contentType: TYPES[name.split('.').pop()] || 'application/octet-stream' });
    } catch {
      return route.fulfill({ status: 404, body: '' });
    }
  });
  await page.goto(`${ORIGIN}/`);
  return outside;
}

const sampleFile = (opts) => ({ name: 'NTS_eTaxInvoice.html', mimeType: 'text/html', buffer: Buffer.from(makeSecureMail(opts)) });

test('번호를 넣으면 요약이 보이고, 원본은 스크립트·바깥 이미지 없이 보임', async ({ page }) => {
  const outside = await openViewer(page);
  await page.locator('#file').setInputFiles(sampleFile());

  await page.locator('#bizno').fill('1234567891');
  await page.getByRole('button', { name: '열기' }).click();
  await expect(page.getByRole('alert')).toContainText('번호가 맞지 않아요');

  await page.locator('#bizno').fill('123-45-67890');
  await page.getByRole('button', { name: '열기' }).click();
  const summary = page.locator('#summary');
  await expect(summary).toContainText('33,000원');
  await expect(summary).toContainText('공급가액 30,000원 · 세액 3,000원');
  await expect(summary).toContainText('청구함');
  await expect(summary).toContainText('승인번호 20261030-10000000-12345678');
  await expect(summary).toContainText('품목 2개');
  await expect(summary).toContainText('우유 <1L>'); // 글자로만 들어가고 태그로 해석되지 않음
  await expect(summary).toContainText('111-22-33333');
  await expect(summary).toContainText('시험용 비고');
  await expect(summary).not.toContainText('null');
  await expect(page).toHaveTitle('(주) 시험공급 33,000원');

  await page.getByRole('button', { name: '원본 화면 보기' }).click();
  const frame = page.frameLocator('#original iframe');
  await expect(frame.getByText('전자세금계산서 시험 화면')).toBeVisible();
  expect(await frame.locator('body').getAttribute('data-ran')).toBeNull(); // 원본 속 스크립트는 실행 안 됨

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'XML 저장' }).click();
  expect((await download).suggestedFilename()).toBe('202610301000000012345678.xml');

  expect(outside).toEqual([]);
});

test('기억한 번호로 다음 파일은 바로 열리고, 지우기를 누르면 잊음', async ({ page }) => {
  await openViewer(page);
  await page.locator('#file').setInputFiles(sampleFile());
  await page.locator('#bizno').fill(SAMPLE_ID);
  await page.getByRole('button', { name: '열기' }).click();
  await expect(page.locator('#summary')).toContainText('33,000원');

  await page.reload();
  await page.locator('#file').setInputFiles(sampleFile());
  await expect(page.locator('#summary')).toContainText('33,000원');

  await page.getByRole('button', { name: '기억한 번호 지우기' }).click();
  await page.reload();
  await page.locator('#file').setInputFiles(sampleFile());
  await expect(page.locator('#bizno')).toHaveValue('');
});

test('국세청 파일이 아니면 알려 줌', async ({ page }) => {
  await openViewer(page);
  await page.locator('#file').setInputFiles({ name: 'other.html', mimeType: 'text/html', buffer: Buffer.from('<html>hi</html>') });
  await expect(page.getByRole('alert')).toContainText('보안메일 파일');
});
