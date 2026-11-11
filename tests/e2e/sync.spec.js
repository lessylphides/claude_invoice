// 장부 서버 동기화: 처음 로그인하면 기기 장부를 올림, 바꾸면 올림, 다른 기기 변경을 받음, 충돌하면 물어봄
import { test, expect } from '@playwright/test';
import { openApp, purchase, item, sheet, fakeLedgerServer, TEST_USER } from './helpers.js';

const local = () => ({ purchases: [purchase('p1', '2026-11-02', '가락청과', [item('양파', '기타', 28000)])] });
const serverData = (vendor, price) => ({ version: 6, purchases: [purchase('s1', '2026-11-03', vendor, [item('우유', '기타', price)])] });
const syncState = (patch) => ({ 'costnote.sync': { owner: TEST_USER.id, rev: 1, dirty: false, syncedAt: 1, ...patch } });

test('처음 로그인: 이 기기 장부를 계정에 올리고, 고치면 다시 올린다', async ({ page }) => {
  const server = fakeLedgerServer();
  const errors = await openApp(page, { data: local(), auth: server.handler });
  await expect(page.locator('.toast').last()).toContainText('이 기기 장부(매입 1건 · 메뉴 0개)를 계정에 저장했어요');
  expect(server.row.rev).toBe(1);
  expect(server.row.data.purchases[0].vendor).toBe('가락청과');
  await expect(page.locator('.backup-banner')).toHaveCount(0); // 서버에 저장되면 백업 알림 없음

  // 결제 구분을 바꾸면 잠시 뒤 서버에 올라감 (번호 1 → 2)
  await page.locator('.cell[data-date="2026-11-02"]').click();
  await sheet(page).locator('.pay-checks input').first().check();
  await expect.poll(() => server.row.rev, { timeout: 5000 }).toBe(2);
  expect(server.requests.at(-1)).toMatchObject({ method: 'PATCH' });
  expect(server.requests.at(-1).path).toContain('rev=eq.1');

  await page.keyboard.press('Escape');
  await page.locator('[data-act=settings]').click();
  await expect(sheet(page).locator('.sync-line')).toContainText('서버에 저장됨');
  expect(errors).toEqual([]);
});

test('다른 기기에서 바뀐 장부를 받아온다', async ({ page }) => {
  const server = fakeLedgerServer({ rev: 3, data: serverData('코스트코', 3200) });
  await openApp(page, { data: local(), auth: server.handler, local: syncState({ rev: 2 }) });
  await expect(page.locator('.toast').last()).toContainText('다른 기기나 클로드에서 바뀐 장부를 불러왔어요');
  await expect(page.locator('.hero-num')).toHaveText('3,200원');
  expect(server.requests.filter((r) => r.method !== 'GET')).toEqual([]); // 덮어쓰지 않음
});

test('이 기기와 다른 기기가 둘 다 바꿨으면 어느 쪽을 남길지 묻는다', async ({ page }) => {
  const server = fakeLedgerServer({ rev: 3, data: serverData('코스트코', 3200) });
  await openApp(page, { data: local(), auth: server.handler, local: syncState({ rev: 2, dirty: true }) });
  await expect(sheet(page)).toContainText('다른 곳에서 장부가 바뀌었어요');
  await sheet(page).locator('[data-choice=local]').click();
  await expect.poll(() => server.row.rev).toBe(4);
  expect(server.row.data.purchases[0].vendor).toBe('가락청과');
  await expect(page.locator('.hero-num')).toHaveText('28,000원');
});

test('처음 로그인했는데 계정에도 장부가 있으면 고르게 한다 (계정 장부 쓰기)', async ({ page }) => {
  const server = fakeLedgerServer({ rev: 5, data: serverData('코스트코', 3200) });
  await openApp(page, { data: local(), auth: server.handler });
  await expect(sheet(page)).toContainText('매입 1건 · 메뉴 0개');
  await sheet(page).locator('[data-choice=server]').click();
  await expect(page.locator('.hero-num')).toHaveText('3,200원');
  expect(server.row.rev).toBe(5);
});

test('서버에 연결되지 않으면 이 기기에만 저장하고 설정에 알린다', async ({ page }) => {
  await openApp(page, { data: local() }); // 장부 서버 응답 없음(오류)
  await page.locator('[data-act=settings]').click();
  await expect(sheet(page).locator('.sync-line')).toContainText(/서버 저장에 실패|인터넷 연결이 없어/);
  await expect(page.locator('.hero-num')).toHaveText('28,000원'); // 장부는 그대로
});
