// 알림은 한 번에 하나씩 차례로: 메뉴 저장 → 레벨업이 겹치지 않음
import { test, expect } from '@playwright/test';
import { openApp, purchase, item } from './helpers.js';

// 띄엄띄엄 2건: 영수증 20점 + 첫 영수증 미션 20점 = 40점 (Lv.1). 판매가 넣은 메뉴 1개(+20)면 Lv.2
const data = () => ({ purchases: ['2026-10-20', '2026-10-29'].map((d, i) => purchase(`p${i}`, d, `가게${i}`, [item(`품목${i}`, '기타', 1000 + i)])) });

test('메뉴 저장과 레벨업 알림이 겹치지 않고 차례로 보임', async ({ page }) => {
  await page.route('**/api/level**', (r) => r.fulfill({ contentType: 'application/json', body: '{"gifts":[]}' }));
  await openApp(page, { data: data() });
  await page.locator('[data-tab=cost]').click();
  await page.locator('[data-cost=add]').click();
  const form = page.locator('.menu-editor');
  await form.locator('[name=name]').fill('아메리카노');
  await form.locator('[name=price]').fill('4500');
  await form.locator('[data-add=manual]').click();
  const row = form.locator('.ing-edit').last();
  await row.locator('[data-f=name]').fill('원두');
  await row.locator('[data-f=cost]').fill('600');
  await form.locator('button[type=submit]').click();
  await expect(page.locator('.toast')).toHaveCount(1);
  await expect(page.locator('.toast')).toHaveText('저장했습니다.');
  await expect(page.locator('.toast')).toHaveText(/Lv\.2 .* 달성/, { timeout: 4000 });
  await expect(page.locator('.toast')).toHaveCount(1);
});
