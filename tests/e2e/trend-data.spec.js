// 가격 추이 그래프, 백업/복원, CSV 내보내기, 설정
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openApp, purchase, item, sheet, closeSheet, readSaved, waitSaved, clearSaved } from './helpers.js';

// 헤드리스 Chromium 은 한글 파일 이름을 'download' 로 바꿔 버리므로, 앱이 요청한 이름을 직접 기록해서 확인
async function recordDownloadNames(page) {
  await page.addInitScript(() => {
    window.__downloads = [];
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) window.__downloads.push(this.download);
      return click.call(this);
    };
  });
}
const lastDownloadName = (page) => page.evaluate(() => window.__downloads.at(-1));

const data = () => ({
  categories: ['채소·과일', '기타'],
  purchases: [
    purchase('a', '2026-09-15', '(주)싱싱농산', [item('양파20kg', '채소·과일', 26500, { qty: 2 })]),
    purchase('b', '2026-11-01', '가락청과', [item('양파 20kg', '채소·과일', 25000)]),
    purchase('c', '2026-11-03', '가락청과', [item('양파 20kg', '채소·과일', 31000, { discount: 1000 })], { payType: 'tax' }),
  ],
});

test('가격 추이: 이름 표기가 달라도 같은 품목으로 묶고, 거래처별로 거를 수 있다', async ({ page }) => {
  await openApp(page, { data: data() });
  await page.locator('.cell[data-date="2026-11-03"]').click();
  await sheet(page).locator('.item-btn', { hasText: '양파' }).click();
  const s = sheet(page);
  await expect(s.locator('.sheet-head h2')).toHaveText('양파 20kg 가격 추이');
  // 날짜 화면에서 가락청과 품목을 눌렀으므로 가락청과 기준으로 시작
  await expect(s.locator('.chip[aria-pressed=true]')).toHaveText('가락청과');
  await expect(s.locator('.hist tbody tr')).toHaveCount(2);
  // 최근 단가 = 할인 반영 30,000 / 직전 25,000 대비 ▲
  await expect(s.locator('.stats > div').first()).toContainText('30,000원');
  await expect(s.locator('.stats .up')).toContainText('5,000원 (20.0%)');
  await expect(s.locator('.hist tbody tr').first()).toContainText('정가 31,000');

  await s.locator('[data-scope=all]').click();
  await expect(s.locator('.hist tbody tr')).toHaveCount(3);
  await expect(s.locator('svg .dot:not(.active)')).toHaveCount(3);

  // 그래프를 누르면 툴팁
  const box = await s.locator('svg').boundingBox();
  await page.mouse.click(box.x + box.width - 20, box.y + box.height / 2);
  await expect(s.locator('.tip')).toBeVisible();
  await expect(s.locator('.tip')).toContainText('30,000원');
  await expect(s.locator('.tip')).toContainText('정가 31,000');

  // 표의 날짜를 누르면 그날 상세로
  await s.locator('.hist [data-date="2026-09-15"]').click();
  await expect(sheet(page).locator('.sheet-head h2')).toHaveText('2026년 9월 15일 (화)');
});

test('백업 저장 → 지운 뒤 불러오기 하면 그대로 돌아온다', async ({ page }) => {
  await recordDownloadNames(page);
  await openApp(page, { data: data() });
  await page.locator('[data-act=settings]').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-act=backup]').click()]);
  expect(await lastDownloadName(page)).toBe('매입장부_백업_2026-11-04.json');
  const path = await download.path();
  const json = JSON.parse(await readFile(path, 'utf8'));
  expect(json.purchases).toHaveLength(3);

  await clearSaved(page);
  await page.reload();
  await expect(page.locator('.hero-num')).toHaveText('0원');

  await page.locator('[data-act=settings]').click();
  page.once('dialog', (d) => d.accept());
  await sheet(page).locator('.restore-file').setInputFiles(path);
  await expect(page.locator('.hero-num')).toHaveText('55,000원');
});

test('잘못된 백업 파일은 거부하고 데이터를 바꾸지 않는다', async ({ page }) => {
  await openApp(page, { data: data() });
  await page.locator('[data-act=settings]').click();
  page.on('dialog', (d) => d.accept());
  await sheet(page).locator('.restore-file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(page.locator('.hero-num')).toHaveText('55,000원');
});

test('이번 달 CSV: 엑셀용 BOM, 할인·용량 열, 수식으로 해석될 값은 막는다', async ({ page }) => {
  const d = data();
  d.purchases.push(purchase('x', '2026-11-04', '=HYPERLINK("http://evil")', [item('+위험', '기타', 1000)]));
  await recordDownloadNames(page);
  await openApp(page, { data: d });
  await page.locator('[data-act=settings]').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-act=csv]').click()]);
  expect(await lastDownloadName(page)).toBe('매입_2026-11.csv');
  const text = await readFile(await download.path(), 'utf8');
  expect(text.charCodeAt(0)).toBe(0xfeff);
  const lines = text.slice(1).split('\r\n');
  expect(lines[0]).toBe('"날짜","거래처","결제구분","세금계산서발행","품목","분류","수량","단위","1개용량","용량단위","정가단가","할인","금액"');
  expect(lines).toHaveLength(4); // 머리글 + 11월 3건 (9월 제외)
  expect(lines[2]).toContain('"세금계산서","미발행","양파 20kg"');
  expect(lines[2]).toContain('"31000","1000","30000"');
  expect(lines[3]).toContain(`"'=HYPERLINK`);
  expect(lines[3]).toContain(`"'+위험"`);
});

test('설정: API 키·모델·분류 목록 저장', async ({ page }) => {
  await openApp(page);
  await page.locator('[data-act=settings]').click();
  const s = sheet(page);
  await s.locator('[name=apiKey]').fill('  sk-ant-abc  ');  // 앞뒤 공백은 지움
  await s.locator('[name=model]').selectOption('claude-sonnet-5-5');
  await s.locator('[name=cats]').fill('주류\n\n안주\n주류');
  await s.locator('button[type=submit]').click();
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('maeip.settings.v1')));
  expect(settings).toMatchObject({ apiKey: 'sk-ant-abc', model: 'claude-sonnet-5-5' });
  // 빈 줄·중복 제거, '기타'는 항상 포함
  await waitSaved(page, (d) => JSON.stringify(d?.categories) === JSON.stringify(['주류', '안주', '기타']));
});

test('탭 전환은 새로고침 후에도 유지된다', async ({ page }) => {
  await openApp(page);
  await page.locator('[data-tab=cost]').click();
  await expect(page.locator('.target-card')).toBeVisible();
  await page.reload();
  await expect(page.locator('.target-card')).toBeVisible();
  await page.locator('[data-tab=purchase]').click();
  await expect(page.locator('.calendar')).toBeVisible();
});

test.describe('화면 단위 확인', () => {
  test('시트를 닫으면 배경 스크롤 잠금이 풀린다', async ({ page }) => {
    await openApp(page, { data: data() });
    await page.locator('.cell[data-date="2026-11-03"]').click();
    await expect(page.locator('body')).toHaveClass(/no-scroll/);
    await closeSheet(page);
    await expect(page.locator('body')).not.toHaveClass(/no-scroll/);
  });
});
