// e2e 공통 도우미: 날짜 고정, 데이터 미리 넣기, Claude API 가짜 응답
import { expect } from '@playwright/test';

export const TODAY = '2026-11-04';

// 1×1 PNG (영수증 사진 대신 쓰는 아주 작은 이미지)
export const PHOTO = {
  name: 'receipt.png',
  mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64'),
};

export const item = (name, category, unitPrice, extra = {}) => {
  const qty = extra.qty ?? 1;
  const discount = extra.discount ?? 0;
  return { id: `i-${name}-${unitPrice}`, name, category, qty, unit: '', unitPrice, discount, amount: qty * unitPrice - discount, packSize: 0, packUnit: '', ...extra };
};

export const purchase = (id, date, vendor, items, extra = {}) => ({
  id, date, vendor, payType: '', taxIssued: false, memo: '', createdAt: Date.parse(date), items, ...extra,
});

/**
 * 앱을 연다. data/settings 를 주면 그 상태로 시작 (새로고침해도 다시 덮어쓰지 않음)
 */
export const TEST_USER = { id: '00000000-0000-4000-8000-000000000001', email: 'owner@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, identities: [{}], created_at: '2026-11-01T00:00:00Z' };

/** 로그인된 상태(Supabase 세션) — 만료가 먼 미래라 서버에 묻지 않음 */
export const fakeSession = (user = TEST_USER) => ({
  access_token: 'test-access-token', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, refresh_token: 'test-refresh', user,
});

/** 로그인 서버(Supabase) 요청을 가로챔. handler(route, path, body) 가 없으면 테스트 중 실제 서버로 나가지 않게 막음 */
export async function mockAuth(page, handler = null) {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS' };
  const calls = [];
  await page.route('https://*.supabase.co/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const path = new URL(req.url()).pathname + new URL(req.url()).search;
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ method: req.method(), path, body });
    const out = handler ? await handler(path, body, req.method(), req) : null;
    if (!out) return route.fulfill({ status: 500, headers: cors, contentType: 'application/json', body: JSON.stringify({ error_code: 'unexpected_failure', msg: 'not mocked' }) });
    return route.fulfill({ status: out.status ?? 200, headers: cors, contentType: 'application/json', body: JSON.stringify(out.body ?? {}) });
  });
  return calls;
}

/**
 * 앱을 연다. data/settings 를 주면 그 상태로 시작 (새로고침해도 다시 덮어쓰지 않음)
 * loggedIn=false 면 로그인 안 된 상태(로그인 화면)로 시작. path 로 메일 링크 주소(#...)를 흉내 낼 수 있음
 */
export async function openApp(page, { data, settings, tab, loggedIn = true, path = '/', auth = null, local = null } = {}) {
  await page.clock.setFixedTime(new Date(`${TODAY}T10:00:00`));
  const calls = await mockAuth(page, auth);
  await page.addInitScript(
    ({ data, settings, tab, session, local }) => {
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      localStorage.clear();
      if (data) localStorage.setItem('maeip.data.v1', JSON.stringify(data));
      if (settings) localStorage.setItem('maeip.settings.v1', JSON.stringify(settings));
      if (tab) localStorage.setItem('maeip.tab', tab);
      if (session) localStorage.setItem('costnote.auth', JSON.stringify(session));
      for (const [k, v] of Object.entries(local ?? {})) localStorage.setItem(k, JSON.stringify(v));
    },
    { data: data ?? null, settings: settings ?? null, tab: tab ?? null, session: loggedIn ? fakeSession() : null, local },
  );
  const errors = [];
  page.authCalls = calls; // 로그인 서버로 보낸 요청 (auth.spec 에서 확인)
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(path);
  // 로그인 안 한 상태로 시작해도 메일 링크(path)로 바로 로그인될 수 있으므로 둘 중 하나
  await expect(page.locator(loggedIn ? '.tabbar' : '.auth-screen, .tabbar').first()).toBeVisible();
  return errors;
}

/**
 * 영수증 인식 서버(/api/ocr)를 가짜로 대신한다. respond(body, n) 가 돌려준 객체를 인식 결과로 보낸다.
 * {status, body} 를 돌려주면 그대로 응답 (오류 흉내). 돌려받은 requests 배열에 앱이 보낸 요청이 쌓인다.
 */
export async function mockClaude(page, respond) {
  const requests = [];
  await page.route('**/api/ocr', async (route) => {
    const body = JSON.parse(route.request().postData());
    requests.push({ ...body, authorization: route.request().headers()['authorization'] });
    const out = await respond(body, requests.length);
    if (out && out.status) return route.fulfill({ status: out.status, contentType: 'application/json', body: JSON.stringify(out.body) });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: out, usage: { day: requests.length, month: requests.length }, limits: { day: 30, month: 300 } }),
    });
  });
  return requests;
}

export const ocrItem = (name, category, unitPrice, extra = {}) => {
  const qty = extra.qty ?? 1;
  const discount = extra.discount ?? 0;
  return { name, category, qty, unit: '', unitPrice, discount, amount: qty * unitPrice - discount, packSize: 0, packUnit: '', ...extra };
};

export const sheet = (page) => page.locator('.sheet-wrap').last();

export async function closeSheet(page) {
  await sheet(page).locator('.sheet-head .close').click();
}

/** 하단 메뉴로 매입 추가 → 직접 입력 */
export async function openManualEntry(page) {
  await page.locator('[data-act=capture]').click();
  await page.locator('[data-src=manual]').click();
  await expect(page.locator('form.editor')).toBeVisible();
}


/** 앱이 IndexedDB 에 저장한 데이터 읽기 (없으면 null) */
export function readSaved(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('maeip', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => {
          const db = req.result;
          const get = db.transaction('kv').objectStore('kv').get('data');
          get.onsuccess = () => {
            db.close();
            resolve(get.result ?? null);
          };
          get.onerror = () => resolve(null);
        };
        req.onerror = () => resolve(null);
      }),
  );
}

/** 저장이 끝날 때까지 기다림 (조건이 맞을 때까지) */
export async function waitSaved(page, check) {
  await expect.poll(async () => check(await readSaved(page)), { timeout: 5000 }).toBe(true);
}

/** 앱 데이터 전부 지우기 (IndexedDB + 예전 localStorage) */
export function clearSaved(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        localStorage.removeItem('maeip.data.v1');
        const req = indexedDB.open('maeip', 1);
        req.onsuccess = () => {
          const db = req.result;
          const t = db.transaction('kv', 'readwrite');
          t.objectStore('kv').clear();
          t.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
  );
}

/**
 * 가짜 장부 서버 (Supabase 'ledgers' 표 흉내). server.row 가 서버에 저장된 장부 ({rev, data} 또는 null).
 * openApp(page, { auth: server.handler }) 로 씀
 */
export function fakeLedgerServer(row = null) {
  const server = { row, requests: [] };
  server.handler = (path, body, method, req) => {
    if (!path.startsWith('/rest/v1/ledgers')) return null;
    server.requests.push({ method, path, body });
    const wantsObject = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    const out = (rows, status = 200) => ({ status, body: wantsObject ? rows[0] ?? null : rows });
    if (method === 'GET') return out(server.row ? [{ ...server.row, updated_at: '2026-11-04T01:00:00Z' }] : []);
    if (method === 'POST') {
      if (server.row) return { status: 409, body: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      server.row = { rev: body.rev, data: body.data };
      return out([{ rev: body.rev }], 201);
    }
    if (method === 'PATCH') {
      const expected = Number(new URL('http://x' + path).searchParams.get('rev')?.replace('eq.', ''));
      if (!server.row || server.row.rev !== expected) return out([]);
      server.row = { rev: body.rev, data: body.data };
      return out([{ rev: body.rev }]);
    }
    return null;
  };
  return server;
}
