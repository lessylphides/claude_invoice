// 로그인·회원가입·이메일 인증·비밀번호 찾기 (로그인 서버는 가짜 응답)
import { test, expect } from '@playwright/test';
import { openApp, TEST_USER, fakeSession, sheet } from './helpers.js';

const fill = async (page, values) => {
  for (const [name, v] of Object.entries(values)) await page.locator(`.auth-screen input[name=${name}]`).fill(v);
};
const submit = (page) => page.locator('.auth-screen button[type=submit]').click();
const notice = (page) => page.locator('.auth-notice');

test('로그인 안 했으면 로그인 화면, 틀리면 한국어 안내, 맞으면 앱이 열린다', async ({ page }) => {
  const errors = await openApp(page, {
    loggedIn: false,
    auth: (path, body) => {
      if (!path.startsWith('/auth/v1/token')) return null;
      if (body.password === 'wrong1234') return { status: 400, body: { error_code: 'invalid_credentials', msg: 'Invalid login credentials' } };
      return { body: fakeSession({ ...TEST_USER, email: body.email }) };
    },
  });
  await expect(page.locator('.auth-card h2')).toHaveText('로그인');
  await expect(page.locator('.tabbar')).toHaveCount(0);

  await fill(page, { email: 'bad', password: 'x' });
  await submit(page);
  await expect(notice(page)).toHaveText('이메일 주소를 확인해 주세요.');

  await fill(page, { email: 'me@example.com', password: 'wrong1234' });
  await submit(page);
  await expect(notice(page)).toHaveText('이메일 또는 비밀번호가 맞지 않아요.');
  await expect(page.locator('.auth-screen input[name=email]')).toHaveValue('me@example.com'); // 다시 적지 않아도 되게

  await fill(page, { password: 'right1234' });
  await submit(page);
  await expect(page.locator('.tabbar')).toBeVisible();

  // 설정에 계정 표시 → 로그아웃하면 로그인 화면 (장부는 그대로)
  await page.locator('[data-act=settings]').click();
  await expect(page.locator('.account-email')).toHaveText('me@example.com');
  page.once('dialog', (d) => d.accept());
  await page.locator('[data-act=logout]').click();
  await expect(page.locator('.auth-card h2')).toHaveText('로그인');
  await expect(notice(page)).toHaveText('로그아웃했어요.');
  expect(await page.evaluate(() => localStorage.getItem('costnote.auth'))).toBeNull();
  expect(errors).toEqual([]);
});

test('회원가입: 비밀번호 규칙 확인 → 인증 메일 안내 → 다시 보내기', async ({ page }) => {
  const errors = await openApp(page, {
    loggedIn: false,
    auth: (path, body) => {
      if (path.startsWith('/auth/v1/signup')) return { body: { ...TEST_USER, email: body.email, identities: [{}], confirmation_sent_at: '2026-11-04T01:00:00Z' } };
      if (path.startsWith('/auth/v1/resend')) return { body: {} };
      return null;
    },
  });
  await page.locator('[data-auth-go=signup]').click();
  await expect(page.locator('.auth-card h2')).toHaveText('회원가입');
  await fill(page, { email: 'new@example.com', password: 'short', password2: 'short' });
  await submit(page);
  await expect(notice(page)).toHaveText('비밀번호는 8자 이상이어야 해요.');
  await fill(page, { password: 'onlyletters', password2: 'onlyletters' });
  await submit(page);
  await expect(notice(page)).toHaveText('비밀번호에 영문과 숫자를 함께 넣어 주세요.');
  await fill(page, { password: 'goodpass12', password2: 'goodpass13' });
  await submit(page);
  await expect(notice(page)).toHaveText('비밀번호 확인이 일치하지 않아요.');
  await fill(page, { password2: 'goodpass12' });
  await submit(page);
  await expect(notice(page)).toHaveText('이용약관과 개인정보 처리에 동의해 주세요.');
  await page.locator('.auth-screen input[name=agree]').check();
  await submit(page);
  await expect(page.locator('.auth-card h2')).toHaveText('메일함을 확인해 주세요');
  await expect(page.locator('.auth-text')).toContainText('new@example.com');
  await page.locator('[data-auth-act=resend]').click();
  await expect(notice(page)).toHaveText('인증 메일을 다시 보냈어요.');
  const signup = page.authCalls.find((c) => c.path.startsWith('/auth/v1/signup'));
  expect(signup.body).toMatchObject({ email: 'new@example.com', password: 'goodpass12' });
  expect(signup.path).toContain('redirect_to=');
  expect(errors).toEqual([]);
});

test('이미 가입된 이메일로 가입하면 로그인·비밀번호 찾기 안내', async ({ page }) => {
  await openApp(page, {
    loggedIn: false,
    auth: (path, body) => (path.startsWith('/auth/v1/signup') ? { body: { ...TEST_USER, email: body.email, identities: [] } } : null),
  });
  await page.locator('[data-auth-go=signup]').click();
  await fill(page, { email: 'owner@example.com', password: 'goodpass12', password2: 'goodpass12' });
  await page.locator('.auth-screen input[name=agree]').check();
  await submit(page);
  await expect(notice(page)).toContainText('이미 가입된 이메일이에요');
});

test('비밀번호 찾기 → 메일 안내, 메일 링크로 들어오면 새 비밀번호 정하기', async ({ page }) => {
  await openApp(page, {
    loggedIn: false,
    auth: (path) => (path.startsWith('/auth/v1/recover') ? { body: {} } : null),
  });
  await page.locator('[data-auth-go=forgot]').click();
  await fill(page, { email: 'owner@example.com' });
  await submit(page);
  await expect(page.locator('.auth-card h2')).toHaveText('메일을 보냈어요');
});

test('재설정 링크로 들어오면 새 비밀번호를 정하고 앱이 열린다', async ({ page }) => {
  const hash = '#access_token=recovery-token&expires_at=4102444800&expires_in=3600&refresh_token=r1&token_type=bearer&type=recovery';
  const errors = await openApp(page, {
    loggedIn: false,
    path: `/${hash}`,
    auth: (path, body, method) => {
      if (path.startsWith('/auth/v1/user') && method === 'GET') return { body: TEST_USER };
      if (path.startsWith('/auth/v1/user') && method === 'PUT') return { body: TEST_USER };
      return null;
    },
  });
  await expect(page.locator('.auth-card h2')).toHaveText('새 비밀번호 정하기');
  expect(await page.evaluate(() => location.hash)).toBe(''); // 토큰은 주소창에서 지움
  await fill(page, { password: 'newpass123', password2: 'newpass123' });
  await submit(page);
  await expect(page.locator('.tabbar')).toBeVisible();
  const put = page.authCalls.find((c) => c.method === 'PUT');
  expect(put.body).toMatchObject({ password: 'newpass123' });
});

test('만료된 메일 링크로 들어오면 안내', async ({ page }) => {
  await openApp(page, { loggedIn: false, path: '/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired' });
  await expect(notice(page)).toHaveText('링크가 만료됐거나 이미 쓴 링크예요. 메일을 다시 받아 주세요.');
});

test('메일 링크가 우리 주소(token_hash)로 오면: 가입 인증 → 로그인된 상태로 열림', async ({ page }) => {
  await openApp(page, {
    loggedIn: false,
    path: '/?token_hash=abc123&type=email',
    auth: (path, body) => (path.startsWith('/auth/v1/verify') ? { body: { ...fakeSession(), type: body.type } } : null),
  });
  await expect(page.locator('.tabbar')).toBeVisible();
  await expect(page.locator('.toast').last()).toContainText('이메일 인증이 끝났어요');
  expect(await page.evaluate(() => location.search)).toBe('');
  const verify = page.authCalls.find((c) => c.path.startsWith('/auth/v1/verify'));
  expect(verify.body).toMatchObject({ token_hash: 'abc123', type: 'email' });
});

test('메일 링크(token_hash)로 비밀번호 재설정 → 새 비밀번호 화면', async ({ page }) => {
  await openApp(page, {
    loggedIn: false,
    path: '/?token_hash=r9&type=recovery',
    auth: (path) => (path.startsWith('/auth/v1/verify') ? { body: fakeSession() } : null),
  });
  await expect(page.locator('.auth-card h2')).toHaveText('새 비밀번호 정하기');
});

test('이미 쓴(만료된) 메일 링크면 안내', async ({ page }) => {
  await openApp(page, {
    loggedIn: false,
    path: '/?token_hash=old&type=email',
    auth: (path) => (path.startsWith('/auth/v1/verify') ? { status: 403, body: { error_code: 'otp_expired', msg: 'Email link is invalid or has expired' } } : null),
  });
  await expect(page.locator('.auth-notice')).toContainText('링크가 만료됐거나 이미 쓴 링크예요');
});

test('소개 페이지의 [지금 써 보기](?start=signup)로 오면 회원가입 화면부터, 주소는 깔끔하게', async ({ page }) => {
  await openApp(page, { loggedIn: false, path: '/?start=signup' });
  await expect(page.locator('.auth-card h2')).toHaveText('회원가입');
  expect(await page.evaluate(() => location.search)).toBe('');
});

test('회원 탈퇴: "탈퇴"를 입력해야 진행, 자동 결제를 먼저 멈추고 서버 계정 삭제 후 이 기기 장부도 지우고 로그인 화면', async ({ page }) => {
  const order = [];
  await page.route('**/api/billing**', (route) => {
    order.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"closed":true}' });
  });
  page.on('request', (r) => r.url().includes('delete_my_account') && order.push('delete_my_account'));
  await openApp(page, {
    data: { purchases: [] , menus: [{ id: 'm', name: '아메리카노', price: 4500, ingredients: [{ id: 'g', type: 'manual', name: '원두', cost: 500 }] }] },
    auth: (path, body, method) => (path.startsWith('/rest/v1/rpc/delete_my_account') ? { status: 200, body: null } : null),
  });
  await page.locator('[data-act=settings]').click();
  page.once('dialog', (d) => d.accept('아니요'));
  await sheet(page).locator('[data-act=delete-account]').click();
  expect(page.authCalls.some((c) => c.path.includes('delete_my_account'))).toBe(false); // 잘못 입력하면 그대로
  page.once('dialog', (d) => d.accept('탈퇴'));
  await sheet(page).locator('[data-act=delete-account]').click();
  await expect(page.locator('.auth-notice')).toContainText('탈퇴가 끝났어요');
  expect(page.authCalls.some((c) => c.path.includes('delete_my_account'))).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('costnote.auth'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('costnote.sync'))).toBeNull();
  expect(order.filter((p) => p !== '/api/billing')).toEqual(['/api/billing/close', 'delete_my_account']);
});

test('광고 링크(?ref=)로 들어와 가입하면 계정 정보에 가입 경로가 함께 저장됨', async ({ page }) => {
  await openApp(page, {
    loggedIn: false,
    path: '/?ref=IG1',
    auth: (path, body) => (path.startsWith('/auth/v1/signup') ? { body: { ...TEST_USER, email: body.email, identities: [{}] } } : null),
  });
  expect(await page.evaluate(() => localStorage.getItem('costnote:ref'))).toBe('ig1');
  await page.locator('[data-auth-go=signup]').click();
  await fill(page, { email: 'ad@example.com', password: 'goodpass12', password2: 'goodpass12' });
  await page.locator('.auth-screen input[name=agree]').check();
  await submit(page);
  await expect(page.locator('.auth-card h2')).toHaveText('메일함을 확인해 주세요');
  const signup = page.authCalls.find((c) => c.path.startsWith('/auth/v1/signup'));
  expect(signup.body.data).toEqual({ ref: 'ig1' });
});

test('인증 코드: 틀리면 안내, 맞으면 가입한 화면에서 바로 로그인 (메일 앱을 다녀와 새로 열려도 코드 화면 유지)', async ({ page }) => {
  await openApp(page, {
    loggedIn: false,
    auth: (path, body) => {
      if (path.startsWith('/auth/v1/signup')) return { body: { ...TEST_USER, email: body.email, identities: [{}] } };
      if (path.startsWith('/auth/v1/verify'))
        return body.token === '482913' ? { body: fakeSession({ ...TEST_USER, email: body.email }) } : { status: 403, body: { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' } };
      return null;
    },
  });
  await page.locator('[data-auth-go=signup]').click();
  await fill(page, { email: 'code@example.com', password: 'goodpass12', password2: 'goodpass12' });
  await page.locator('.auth-screen input[name=agree]').check();
  await submit(page);
  await expect(page.locator('.auth-card h2')).toHaveText('메일함을 확인해 주세요');
  // 인스타그램 앱 안 브라우저는 메일 앱을 다녀오면 새로 열리기도 함
  await page.reload();
  await expect(page.locator('.auth-card h2')).toHaveText('메일함을 확인해 주세요');
  await expect(page.locator('.auth-text')).toContainText('code@example.com');
  await fill(page, { code: '123' });
  await submit(page);
  await expect(notice(page)).toContainText('숫자 6자리');
  await fill(page, { code: '111111' });
  await submit(page);
  await expect(notice(page)).toContainText('코드가 맞지 않거나');
  await fill(page, { code: '482 913' });
  await submit(page);
  await expect(page.locator('.tabbar')).toBeVisible();
  const verify = page.authCalls.filter((c) => c.path.startsWith('/auth/v1/verify')).at(-1);
  expect(verify.body).toMatchObject({ email: 'code@example.com', token: '482913', type: 'email' });
  expect(await page.evaluate(() => localStorage.getItem('costnote:pending-signup'))).toBeNull();
});

test('인증 안 한 계정으로 로그인하면 코드 넣는 화면으로', async ({ page }) => {
  await openApp(page, {
    loggedIn: false,
    auth: (path) => (path.startsWith('/auth/v1/token') ? { status: 400, body: { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' } } : null),
  });
  await fill(page, { email: 'late@example.com', password: 'goodpass12' });
  await submit(page);
  await expect(page.locator('.auth-card h2')).toHaveText('메일함을 확인해 주세요');
  await expect(page.locator('input[name=code]')).toBeVisible();
});

test.describe('인스타그램 앱 안 브라우저', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0 (iPhone15,2; iOS 18_0; ko_KR)' });
  test('밖(Safari)에서 열기 안내가 보임', async ({ page }) => {
    await openApp(page, { loggedIn: false });
    await expect(page.locator('.inapp-note')).toContainText('인스타그램');
    await expect(page.locator('.inapp-note')).toContainText('외부 브라우저에서 열기');
  });
});
