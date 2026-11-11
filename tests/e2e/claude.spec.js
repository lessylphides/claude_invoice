// 설정 → 클로드 연결: 연결 주소·방법, 클로드가 바꾼 기록과 되돌리기
import { test, expect } from '@playwright/test';
import { openApp, sheet } from './helpers.js';

const CH = [
  { id: 'c2', at: Date.parse('2026-11-11T13:05:00+09:00'), kind: 'menu_field', menuId: 'm1', menuName: '어벨라워 아부나흐', field: 'price', label: '잔 판매가', before: 33000, after: 36000, tool: 'set_menu_price' },
  { id: 'c1', at: Date.parse('2026-11-11T13:04:00+09:00'), kind: 'category_create', category: '하이볼', tool: 'create_menu_category' },
];

test('클로드 연결 화면: 주소, 방법, 바꾼 기록 → 되돌리기', async ({ page }) => {
  const undo = [];
  await page.route('**/api/ai-changes', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ changes: CH }) }));
  await page.route('**/api/ai-changes/undo', async (r) => {
    undo.push(JSON.parse(r.request().postData()).id);
    const changes = CH.map((c) => (c.id === 'c2' ? { ...c, undoneAt: Date.now() } : c));
    await r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, message: '"어벨라워 아부나흐" 잔 판매가를 되돌렸어요.', changes }) });
  });
  const revoked = [];
  await page.route('**/api/claude/grants', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ grants: revoked.length ? [] : [{ id: 'g1', createdAt: Math.floor(Date.now() / 1000), client: 'Claude' }] }) }));
  await page.route('**/api/claude/revoke', async (r) => {
    revoked.push(JSON.parse(r.request().postData()).id);
    await r.fulfill({ contentType: 'application/json', body: '{"revoked":1}' });
  });
  await page.route('**/api/level**', (r) => r.fulfill({ contentType: 'application/json', body: '{"gifts":[]}' }));
  const errors = await openApp(page, { data: {} });
  await page.locator('[data-act=settings]').first().click();
  await page.locator('[data-act=claude]').click();
  const s = sheet(page);
  await expect(s).toContainText('https://app.costnote.co.kr/mcp');
  await expect(s).toContainText('커스텀 커넥터 추가');
  await expect(s.locator('.ai-log .ai-ch').first()).toContainText('잔 판매가 33,000원 → 36,000원');
  await expect(s.locator('.ai-log .ai-ch').nth(1)).toContainText('메뉴 분류 하이볼 만들기');
  await s.locator('[data-undo=c2]').click();
  await expect(page.locator('.toast').last()).toContainText('되돌렸어요');
  await expect(s.locator('.ai-log .ai-ch').first()).toContainText('되돌림');
  expect(undo).toEqual(['c2']);
  // 연결된 클로드 → 끊기
  await expect(s.locator('.ai-grants')).toContainText('Claude');
  page.once('dialog', (d) => d.accept());
  await s.locator('[data-revoke=g1]').click();
  await expect(s.locator('.ai-grants')).toContainText('연결된 클로드가 없어요');
  expect(revoked).toEqual(['g1']);
  expect(errors).toEqual([]);
});
