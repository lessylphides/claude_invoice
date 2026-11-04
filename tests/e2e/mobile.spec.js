// 아이폰 사용성 회귀 방지: 입력칸 글자 크기(자동 확대 방지), 키보드가 올라오고 내려갈 때 시트 높이
import { test, expect } from '@playwright/test';
import { openApp, openManualEntry, purchase, item } from './helpers.js';

test('모든 입력칸은 16px 이상 (아이폰이 칸을 누를 때 화면을 확대하지 않도록)', async ({ page }) => {
  await openApp(page, { data: { purchases: [purchase('a', '2026-11-02', '가게', [item('몽키숄더700ML', '기타', 1000)])] } });
  await openManualEntry(page);
  await page.locator('.item-edit .add-disc').first().click();
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('.sheet input, .sheet select, .sheet textarea')]
      .filter((el) => el.type !== 'checkbox' && el.type !== 'file' && el.offsetParent)
      .map((el) => [el.dataset.f || el.name || el.className, parseFloat(getComputedStyle(el).fontSize)])
      .filter(([, size]) => size < 16),
  );
  expect(small).toEqual([]);

  // 원가 메뉴 입력 화면도
  await page.locator('.sheet-head .close').last().click();
  await page.locator('[data-tab=cost]').click();
  await page.locator('[data-cost=add]').click();
  await page.locator('.menu-editor [data-add=manual]').click();
  await page.locator('.menu-editor [data-add=item]').click();
  await page.locator('.pick-item').first().click();
  const small2 = await page.evaluate(() =>
    [...document.querySelectorAll('.sheet input, .sheet select')]
      .filter((el) => el.offsetParent)
      .map((el) => [el.dataset.f || el.name || el.className, parseFloat(getComputedStyle(el).fontSize)])
      .filter(([, size]) => size < 16),
  );
  expect(small2).toEqual([]);
});

test('날짜 칸이 거래처 칸을 덮지 않는다', async ({ page }) => {
  await openApp(page);
  await openManualEntry(page);
  const [date, vendor] = await Promise.all([
    page.locator('form.editor [name=date]').boundingBox(),
    page.locator('form.editor [name=vendor]').boundingBox(),
  ]);
  expect(date.x + date.width).toBeLessThanOrEqual(vendor.x + 1);
});

test('키보드가 올라오면 시트를 보이는 영역에 맞추고, 내려갈 때 신호가 없어도 원래 높이로 돌아온다', async ({ page }) => {
  // 아이폰 흉내: visualViewport 높이를 줄였다가, 키보드가 내려갈 때는 resize 신호를 보내지 않음
  await page.addInitScript(() => {
    let fakeH = null;
    Object.defineProperty(window.visualViewport, 'height', { get: () => fakeH ?? window.innerHeight });
    window.__keyboard = (h) => {
      fakeH = h;
      if (h) window.visualViewport.dispatchEvent(new Event('resize'));
    };
  });
  await openApp(page);
  await openManualEntry(page);
  const height = () => page.evaluate(() => Math.round(document.querySelector('.sheet-wrap:last-child').getBoundingClientRect().height));
  const full = await height();

  await page.locator('[data-f=unitPrice]').first().focus();
  await page.evaluate(() => window.__keyboard(380));
  await expect.poll(height).toBe(380);
  // 칸을 옮겨도 유지 (숫자 키패드 ↔ 다른 칸)
  await page.locator('[data-f=qty]').first().focus();
  await page.waitForTimeout(500);
  expect(await height()).toBe(380);
  // 입력 중인 칸은 보이는 영역 안에 있다
  const box = await page.locator('[data-f=qty]').first().boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(380);

  await page.evaluate(() => {
    window.__keyboard(null);
    document.activeElement.blur();
  });
  await expect.poll(height, { timeout: 2000 }).toBe(full);
});
