// 시트를 아래로 끌어내려 닫기: 충분히 내리면 닫힘, 조금만 내리면 제자리, 입력한 내용이 있으면 물어봄
import { test, expect } from '@playwright/test';
import { openApp, sheet } from './helpers.js';

/** 시트 안의 selector 요소에서 시작해 아래로 dy 만큼 끌기 (터치 이벤트) */
async function drag(page, selector, dy, { steps = 8, ms = 300 } = {}) {
  await expect(page.locator('.sheet-wrap.open').last()).toBeVisible(); // 열리는 동작이 끝난 뒤에만 끌 수 있음
  await page.evaluate(
    async ({ selector, dy, steps, ms }) => {
      const el = document.querySelector(`.sheet-wrap:last-of-type ${selector}`);
      const r = el.getBoundingClientRect();
      const x = r.left + 10;
      const y0 = r.top + 5;
      const touch = (y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
      const fire = (type, y) => {
        const t = touch(y);
        el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], changedTouches: [t] }));
      };
      fire('touchstart', y0);
      for (let i = 1; i <= steps; i++) {
        await new Promise((r) => setTimeout(r, ms / steps));
        fire('touchmove', y0 + (dy * i) / steps);
      }
      fire('touchend', y0 + dy);
    },
    { selector, dy, steps, ms },
  );
}

test.beforeEach(({ browserName }) => test.skip(browserName !== 'chromium', '터치 이벤트를 직접 만드는 방식은 Chromium 에서만'));

test('제목 부분을 아래로 충분히 끌면 닫히고, 조금만 끌면 제자리로 돌아온다', async ({ page }) => {
  await openApp(page);
  await page.locator('[data-act=settings]').click();
  await expect(sheet(page)).toBeVisible();
  await drag(page, '.sheet-head h2', 40, { ms: 600 }); // 조금, 천천히
  await page.waitForTimeout(300);
  await expect(page.locator('.sheet-wrap')).toHaveCount(1);
  await expect(page.locator('.sheet')).toHaveAttribute('style', /^\s*$|^$/);
  await drag(page, '.sheet-head h2', 250);
  await expect(page.locator('.sheet-wrap')).toHaveCount(0);
});

test('입력한 내용이 있으면 끌어내릴 때 물어보고, 취소하면 그대로 둔다', async ({ page }) => {
  await openApp(page, { tab: 'cost' });
  await page.locator('[data-cost=add]').click();
  await sheet(page).locator('input[name=name]').fill('하이볼');
  page.once('dialog', (d) => d.dismiss());
  await drag(page, '.sheet-head h2', 250);
  await page.waitForTimeout(300);
  await expect(sheet(page).locator('input[name=name]')).toHaveValue('하이볼');
  page.once('dialog', (d) => d.accept());
  await drag(page, '.sheet-head h2', 250);
  await expect(page.locator('.sheet-wrap')).toHaveCount(0);
});

test('본문이 아래로 스크롤된 상태에서 당기면 닫지 않는다 (위로 스크롤하는 동작)', async ({ page }) => {
  await openApp(page);
  await page.locator('[data-act=settings]').click();
  await page.locator('.sheet-body').evaluate((b) => (b.scrollTop = 200));
  const scrolled = await page.locator('.sheet-body').evaluate((b) => b.scrollTop);
  test.skip(scrolled === 0, '설정 화면이 스크롤할 만큼 길지 않음');
  await drag(page, '.sheet-body', 250);
  await page.waitForTimeout(300);
  await expect(page.locator('.sheet-wrap')).toHaveCount(1);
});

test('본문이 맨 위일 때는 본문을 당겨도 닫힌다', async ({ page }) => {
  await openApp(page);
  await page.locator('[data-act=settings]').click();
  await expect(sheet(page)).toBeVisible();
  await drag(page, '.sheet-body', 250);
  await expect(page.locator('.sheet-wrap')).toHaveCount(0);
});
