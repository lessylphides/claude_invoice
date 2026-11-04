// 데이터 보관: localStorage → IndexedDB 옮기기, 큰 데이터, 새로고침 후 유지, 백업 알림
import { test, expect } from '@playwright/test';
import { openApp, openManualEntry, purchase, item, readSaved, waitSaved, sheet } from './helpers.js';

const many = (n) => ({
  purchases: Array.from({ length: n }, (_, i) => purchase(`p${i}`, `2026-10-${String((i % 28) + 1).padStart(2, '0')}`, `가게${i % 3}`, [item(`품목${i % 7}`, '기타', 1000 + i)])),
});

test('예전(localStorage) 데이터를 IndexedDB 로 옮기고 예전 것은 지운다', async ({ page }) => {
  await openApp(page, { data: many(3) });
  await waitSaved(page, (d) => d?.purchases?.length === 3 && d.version === 3);
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

test.describe('코드 리뷰에서 찾은 데이터 안전 문제 재현', () => {
  test('IndexedDB 에 데이터가 있는데 예전 버전 창이 localStorage 에 새로 쓴 내역도 잃지 않는다', async ({ page }) => {
    await openApp(page, { data: many(2) });
    await waitSaved(page, (d) => d?.purchases?.length === 2);
    // 예전 버전 앱이 옮긴 뒤에 예전 저장소에 쓴 상황
    await page.evaluate(() => localStorage.setItem('maeip.data.v1', JSON.stringify({ purchases: [{ id: 'late', date: '2026-10-20', vendor: '늦게 쓴 가게', items: [{ name: 'x', qty: 1, unitPrice: 777, amount: 777 }] }] })));
    await page.reload();
    await waitSaved(page, (d) => d?.purchases?.length === 3 && d.purchases.some((p) => p.id === 'late'));
    await expect.poll(() => page.evaluate(() => localStorage.getItem('maeip.data.v1'))).toBeNull();
  });

  test('저장된 데이터를 읽지 못하면 빈 장부가 아니라 오류와 다시 시도를 보여준다', async ({ page }) => {
    await page.addInitScript(() => {
      indexedDB.open = () => {
        const req = {};
        setTimeout(() => {
          req.error = new DOMException('Connection to Indexed Database server lost', 'UnknownError');
          req.onerror?.();
        });
        return req;
      };
    });
    await page.goto('/');
    await expect(page.locator('.load-error')).toContainText('데이터를 불러오지 못했습니다');
    await expect(page.locator('.load-error [data-act=reload]')).toBeVisible();
    await expect(page.locator('.calendar')).toHaveCount(0);
  });

  test('IndexedDB 연결이 처음 한 번 실패해도 다시 연결해서 정상으로 연다', async ({ page }) => {
    await openApp(page, { data: many(2) });
    await waitSaved(page, (d) => d?.purchases?.length === 2);
    await page.addInitScript(() => {
      const real = indexedDB.open.bind(indexedDB);
      let failed = false;
      indexedDB.open = (...a) => {
        if (failed) return real(...a);
        failed = true;
        const req = {};
        setTimeout(() => {
          req.error = new DOMException('lost', 'UnknownError');
          req.onerror?.();
        });
        return req;
      };
    });
    await page.reload();
    await page.locator('[data-act=prev]').click();
    await expect(page.locator('.hero-sub')).toContainText('2건');
  });

  test('예전 데이터에 깨진 항목(null)이 있어도 앱이 열린다', async ({ page }) => {
    await openApp(page, { data: { purchases: [null, { id: 'ok', date: '2026-11-02', vendor: '가게', items: [null, { name: '우유', qty: 1, unitPrice: 1000, amount: 1000 }] }] } });
    await expect(page.locator('.hero-num')).toHaveText('1,000원');
  });

  test('다른 창에서 저장하면 이 창은 덮어쓰지 않고 새로 불러오기를 안내한다', async ({ page, context }) => {
    await openApp(page, { data: many(1) });
    await waitSaved(page, (d) => d?.purchases?.length === 1);
    const other = await context.newPage();
    await other.clock.setFixedTime(new Date('2026-11-04T10:00:00'));
    await other.goto('/');
    await expect(other.locator('.tabbar')).toBeVisible();

    // 다른 창에서 하나 추가
    await openManualEntry(other);
    await other.locator('form.editor [name=vendor]').fill('다른 창');
    await other.locator('form.editor [data-f=name]').fill('A');
    await other.locator('form.editor [data-f=unitPrice]').fill('1');
    await other.locator('form.editor button[type=submit]').click();
    await waitSaved(page, (d) => d?.purchases?.length === 2);

    // 이 창은 낡았다고 알리고, 여기서 입력해도 저장하지 않음 (다른 창 입력을 지키기 위해)
    await expect(page.locator('.stale-banner')).toBeVisible();
    page.on('dialog', (d) => d.accept());
    await openManualEntry(page);
    await page.locator('form.editor [name=vendor]').fill('낡은 창');
    await page.locator('form.editor [data-f=name]').fill('B');
    await page.locator('form.editor [data-f=unitPrice]').fill('1');
    await page.locator('form.editor button[type=submit]').click();
    await page.waitForTimeout(500);
    const saved = await readSaved(page);
    expect(saved.purchases.map((p) => p.vendor)).toContain('다른 창');
    expect(saved.purchases.map((p) => p.vendor)).not.toContain('낡은 창');

    // 새로 불러오면 다른 창의 내역이 보임
    await page.locator('.stale-banner [data-act=reload]').click();
    await expect(page.locator('.sum-head .name', { hasText: '다른 창' })).toBeVisible();
  });

  test('공유 시트에서 백업을 취소하면 백업한 것으로 치지 않는다', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.canShare = () => true;
      navigator.share = () => Promise.reject(new DOMException('cancel', 'AbortError'));
    });
    await openApp(page, { data: many(12) });
    await page.locator('.backup-banner [data-act=backup-now]').click();
    await expect(page.locator('.toast')).toHaveText('백업을 취소했습니다.');
    await expect(page.locator('.backup-banner')).toBeVisible();
  });

  test('공유 시트로 저장하면 백업으로 기록한다 (아이폰 홈 화면 앱)', async ({ page }) => {
    await page.addInitScript(() => {
      window.__shared = [];
      navigator.canShare = () => true;
      navigator.share = (d) => (window.__shared.push(d.files[0].name), Promise.resolve());
    });
    await openApp(page, { data: many(12) });
    await page.locator('.backup-banner [data-act=backup-now]').click();
    await expect(page.locator('.backup-banner')).toHaveCount(0);
    expect(await page.evaluate(() => window.__shared)).toEqual(['매입장부_백업_2026-11-04.json']);
  });
});
