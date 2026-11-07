// 접근성 자동 검사 (axe): 주요 화면을 밝은/어두운 모드에서 확인
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { openApp, purchase, item, sheet } from './helpers.js';

const data = {
  categories: ['채소·과일', '주류·음료', '기타'],
  purchases: [
    purchase('a', '2026-11-02', '가락청과', [item('양파 20kg', '채소·과일', 28000)], { payType: 'tax' }),
    purchase('b', '2026-11-03', '코스트코', [item('몽키숄더700ML', '주류·음료', 49790, { discount: 10000, packSize: 700, packUnit: 'ml' })], { payType: 'card' }),
  ],
  menus: [{ id: 'm', name: '몽키숄더 한 잔', price: 6000, ingredients: [{ id: 'g', type: 'item', itemName: '몽키숄더700ML', use: 30 }] }],
};

async function check(page, label, issues) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  for (const v of r.violations)
    for (const n of v.nodes)
      issues.push(`${label}: ${v.id} ${n.target.join(' ')} ${(n.any[0]?.data && n.any[0].data.contrastRatio) ? `${n.any[0].data.fgColor} on ${n.any[0].data.bgColor} = ${n.any[0].data.contrastRatio}` : ''}`);
}

for (const scheme of ['light', 'dark']) {
  test(`접근성 검사 (${scheme})`, async ({ page }) => {
    const issues = [];
    await page.emulateMedia({ colorScheme: scheme });
    await openApp(page, { data });
    await check(page, '매입 탭', issues);
    await page.locator('[data-summary=pay]').click();
    await check(page, '세금계산서·카드 요약', issues);
    await page.locator('.cell[data-date="2026-11-03"]').click();
    await expect(sheet(page)).toBeVisible();
    await page.waitForTimeout(300);
    await check(page, '날짜 상세', issues);
    await sheet(page).locator('.item-btn').first().click();
    await page.waitForTimeout(300);
    await check(page, '가격 추이', issues);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.locator('[data-tab=cost]').click();
    await check(page, '원가 탭', issues);
    await page.locator('.menu-card').click();
    await page.waitForTimeout(300);
    await check(page, '메뉴 상세', issues);
    await page.keyboard.press('Escape');
    await page.locator('[data-cost=add]').click();
    await page.waitForTimeout(300);
    await check(page, '메뉴 추가', issues);
    expect([...new Set(issues)]).toEqual([]);
  });
}

for (const scheme of ['light', 'dark']) {
  test(`접근성 검사: 로그인·회원가입 (${scheme})`, async ({ page }) => {
    const issues = [];
    await page.emulateMedia({ colorScheme: scheme });
    await openApp(page, { loggedIn: false });
    await page.locator('.auth-screen input[name=email]').fill('x');
    await page.locator('.auth-screen button[type=submit]').click(); // 오류 안내도 함께 검사
    await check(page, '로그인', issues);
    await page.locator('[data-auth-go=signup]').click();
    await check(page, '회원가입', issues);
    expect(issues).toEqual([]);
  });
}
