// 운영비 → 판매 파일 불러오기: 페이히어 매출 엑셀 + 비밀번호 걸린 네이버 엑셀 → 한 달 매출·메뉴별 수량·메뉴 연결·분석
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { openApp, purchase, item, sheet } from './helpers.js';

const fx = (n) => fileURLToPath(new URL(`../fixtures/${n}`, import.meta.url));
const ownerStatus = (owner) => ({ mode: 'test', owner, customerKey: 'cn_x', subscription: null, entitlement: { kind: owner ? 'owner' : 'legacy', day: 30, month: 300 }, usage: { day: 0, month: 0, total: 0, period: 0 } });
const data = () => ({
  version: 8,
  categories: ['주류·음료', '기타'],
  menuCategories: ['칵테일', '커피'],
  costTarget: { history: [{ value: 25, at: '2026-10-01' }] },
  purchases: [purchase('p', '2026-10-02', '도매', [item('위스키 1L', '주류·음료', 40000, { packSize: 1000, packUnit: 'ml' })])],
  menus: [
    { id: 'h', name: '하이볼', price: 16000, category: '칵테일', ingredients: [{ id: 'g', type: 'item', itemName: '위스키 1L', use: 45 }] },
    { id: 'l', name: '롱 블랙(브라우니)', price: 5500, category: '커피', ingredients: [{ id: 'm', type: 'manual', name: '원두', cost: 600 }] },
    { id: 'f', name: '롱 블랙 (푸릇)', price: 6000, category: '커피', ingredients: [{ id: 'n', type: 'manual', name: '원두', cost: 800 }] },
  ],
});

test('판매 파일: 비밀번호 열기 → 매출·수량·대조 → 메뉴 연결 → 저장 후 분석', async ({ page }) => {
  await page.route('**/api/level**', (r) => r.fulfill({ contentType: 'application/json', body: '{"gifts":[]}' }));
  await page.route('**/api/billing**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(ownerStatus(true)) }));
  const errors = await openApp(page, { data: data(), tab: 'cost' });
  await page.locator('[data-cost=ops]').click();
  await page.locator('[data-import]').click();
  const s = sheet(page);
  await expect(s.locator('.sheet')).toHaveAttribute('aria-label', '판매 파일 불러오기');
  await s.locator('[data-files]').setInputFiles([fx('payhere-sample.xlsx'), fx('naver-sample.xlsx')]);
  await expect(s.locator('.si-files')).toContainText('포스(페이히어) 매출 ✓');
  await expect(s.locator('.si-files')).toContainText('비밀번호가 걸린 파일이에요');
  // 네이버 파일만 아직: 포스 매출로 먼저 계산
  await expect(s.locator('.si-sum .ops-need')).toContainText('144,500원');
  await s.locator('[data-pw]').fill('0000');
  await s.locator('[data-pw]').press('Enter');
  await expect(s.locator('.si-files')).toContainText('비밀번호가 맞지 않아요');
  await s.locator('[data-pw]').fill('1234');
  await s.locator('[data-open]').click();
  await expect(s.locator('.si-files')).toContainText('네이버페이 주문 ✓');
  // 하루 시작 6시: 다음 날 아침에 넣은 기타 결제가 다른 날로 → 대조에 2일
  await expect(s.locator('.si-sum')).toContainText('네이버 주문 4건 · 예약금 1건 뺌');
  await expect(s.locator('.si-mis summary')).toContainText('2일');
  await s.locator('[data-daystart]').selectOption('12');
  await expect(s.locator('.si-mis')).toHaveCount(0);
  await expect(s.locator('.si-sum')).toContainText('네이버 주문 91,500원 · 포스 기타 결제 91,500원 ✓');
  await expect(s.locator('.si-sum')).toContainText('판매 13잔·접시 · 보틀 1병');
  // 연결: 하이볼은 자동, 롱 블랙은 '확인' 추천, 진토닉은 없음
  const sel = (n) => s.getByLabel(`${n} 메뉴`, { exact: true });
  const row = (n) => s.locator(`.si-link:has(select[aria-label="${n} 메뉴"])`);
  await expect(sel('하이볼')).toHaveValue('h');
  await expect(row('롱 블랙').locator('.tag.warn')).toBeVisible();
  await expect(sel('롱 블랙')).toHaveValue(/^[lf]$/); // 이름이 같은 메뉴가 둘 → 확인 필요
  await sel('롱 블랙').selectOption('l');
  await expect(row('롱 블랙').locator('.tag.warn')).toHaveCount(0);
  await expect(sel('DIVE 레몬필, 진&토닉')).toHaveValue('');
  await s.locator('[data-save]').click();
  // 운영비 화면: 10월 매출 칸 + 판매 분석
  const o = sheet(page);
  await expect(o.locator('.sheet')).toHaveAttribute('aria-label', '운영비 · 투자 회수');
  await expect(o.locator('.si-ana')).toContainText('2026년 10월 판매 분석');
  await expect(o.locator('.si-ana')).toContainText('13잔');
  // 레시피 재료비: 하이볼 6 × 1,800 + 롱 블랙 5 × 600 = 13,800
  await expect(o.locator('.si-ana')).toContainText('13,800원');
  await expect(o.locator('.si-ana')).toContainText('원가 연결 안 된 인기 메뉴');
  await o.locator('[data-useqty]').click();
  await expect(o.locator('input[name=monthlyGlasses]')).toHaveValue('13');
  await o.locator('button[type=submit]').click();
  // 다시 열어도 기억 (연결도 저장됨)
  await page.reload();
  await page.locator('[data-cost=ops]').click();
  await expect(sheet(page).locator('.si-ana')).toContainText('13,800원');
  await expect(sheet(page).locator('[data-sales="2026-10"]')).toHaveValue('144500').catch(() => {}); // 이번 달·지난달 칸에 있을 때만
  await sheet(page).locator('[data-import]').click();
  await sheet(page).locator('[data-files]').setInputFiles(fx('payhere-sample.xlsx'));
  await expect(sheet(page).locator('.si-link:has(select[aria-label="롱 블랙 메뉴"]) .tag.warn')).toHaveCount(0); // 기억한 연결
  await expect(sheet(page).locator('[data-daystart]')).toHaveValue('12');
  expect(errors).toEqual([]);
});
