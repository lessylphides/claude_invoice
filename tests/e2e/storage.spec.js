// 데이터 보관: localStorage → IndexedDB 옮기기, 큰 데이터, 새로고침 후 유지, 백업 알림
import { test, expect } from '@playwright/test';
import { openApp, openManualEntry, purchase, item, readSaved, waitSaved, sheet } from './helpers.js';

const many = (n) => ({
  purchases: Array.from({ length: n }, (_, i) => purchase(`p${i}`, `2026-10-${String((i % 28) + 1).padStart(2, '0')}`, `가게${i % 3}`, [item(`품목${i % 7}`, '기타', 1000 + i)])),
});

test('예전(localStorage) 데이터를 IndexedDB 로 옮기고 예전 것은 지운다', async ({ page }) => {
  await openApp(page, { data: many(3) });
  await waitSaved(page, (d) => d?.purchases?.length === 3 && d.version === 2);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('maeip.data.v1'))).toBeNull();
  await page.reload();
  await page.locator('[data-act=prev]').click();
  await expect(page.locator('.hero-sub')).toContainText('3건');
});

test('입력한 내역은 새로고침해도 남는다', async ({ page }) => {
  await openApp(page);
  await openManualEntry(page);
  await page.locator('form.editor [name=vendor]').fill('동네마트');
  await page.locator('form.editor [data-f=name]').fill('우유');
  await page.locator('form.editor [data-f=unitPrice]').fill('2500');
  await page.locator('form.editor button[type=submit]').click();
  await waitSaved(page, (d) => d?.purchases?.length === 1);
  await page.reload();
  await expect(page.locator('.hero-num')).toHaveText('2,500원');
});

test('큰 데이터(약 4MB, 예전 저장 방식의 한도 근처)도 저장·불러오기 된다', async ({ page }) => {
  // 품목 이름을 길게 해서 4MB 정도 만듦
  const long = '아주긴품목이름'.repeat(20);
  const data = { purchases: Array.from({ length: 1500 }, (_, i) => purchase(`b${i}`, '2026-10-15', '도매상', Array.from({ length: 10 }, (_, j) => item(`${long}${j}`, '기타', 1000)))) };
  await openApp(page, { data: { purchases: [] } });
  // 예전 방식(localStorage)이라면 한도를 넘었을 크기를 앱 저장소로 직접 넣고 확인
  await page.evaluate((data) => new Promise((resolve, reject) => {
    const req = indexedDB.open('maeip', 1);
    req.onsuccess = () => {
      const t = req.result.transaction('kv', 'readwrite');
      t.objectStore('kv').put({ version: 2, categories: ['기타'], menus: [], costTarget: { history: [{ value: 25, at: '2026-11-04' }] }, ...data }, 'data');
      t.oncomplete = () => { req.result.close(); resolve(); };
      t.onerror = () => reject(t.error);
    };
  }), data);
  await page.reload();
  await openManualEntry(page);
  await page.locator('form.editor [name=vendor]').fill('추가');
  await page.locator('form.editor [data-f=name]').fill('하나 더');
  await page.locator('form.editor [data-f=unitPrice]').fill('1');
  await page.locator('form.editor button[type=submit]').click();
  await waitSaved(page, (d) => d?.purchases?.length === 1501);
  const size = await page.evaluate(async () => JSON.stringify(await new Promise((r) => {
    const req = indexedDB.open('maeip', 1);
    req.onsuccess = () => { const g = req.result.transaction('kv').objectStore('kv').get('data'); g.onsuccess = () => r(g.result); };
  })).length);
  expect(size).toBeGreaterThan(3_000_000);
});

test('백업 알림: 쌓였는데 백업한 적 없으면 보이고, 나중에/지금 백업으로 사라진다', async ({ page }) => {
  await openApp(page, { data: many(12) });
  const banner = page.locator('.backup-banner');
  await expect(banner).toContainText('아직 백업한 적이 없습니다');
  await banner.locator('[data-act=backup-later]').click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.backup-banner')).toHaveCount(0); // 7일 동안 다시 안 보임

  // 8일 뒤
  await page.clock.setFixedTime(new Date('2026-11-12T10:00:00'));
  await page.reload();
  await expect(page.locator('.backup-banner')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-act=backup-now]').click()]);
  expect(download).toBeTruthy();
  await expect(page.locator('.backup-banner')).toHaveCount(0);
  await page.locator('[data-act=settings]').click();
  await expect(sheet(page).locator('.backup-line')).toContainText('2026.11.12 (오늘)');
});

test('매입이 적으면 백업 알림을 띄우지 않는다', async ({ page }) => {
  await openApp(page, { data: many(5) });
  await expect(page.locator('.backup-banner')).toHaveCount(0);
});

test('설정에 저장 위치와 사용량을 보여준다', async ({ page }) => {
  await openApp(page, { data: many(3) });
  await page.locator('[data-act=settings]').click();
  await expect(sheet(page).locator('.storage-line')).toContainText('매입 3건 · 메뉴 0개');
  await expect(sheet(page).locator('.storage-line')).toContainText('IndexedDB');
});
