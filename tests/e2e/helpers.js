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
export async function openApp(page, { data, settings, tab } = {}) {
  await page.clock.setFixedTime(new Date(`${TODAY}T10:00:00`));
  await page.addInitScript(
    ({ data, settings, tab }) => {
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      localStorage.clear();
      if (data) localStorage.setItem('maeip.data.v1', JSON.stringify(data));
      if (settings) localStorage.setItem('maeip.settings.v1', JSON.stringify(settings));
      if (tab) localStorage.setItem('maeip.tab', tab);
    },
    { data: data ?? null, settings: settings ?? null, tab: tab ?? null },
  );
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.tabbar')).toBeVisible();
  return errors;
}

/**
 * Claude API 를 가짜로 대신한다. respond(body, n) 가 돌려준 JSON 을 인식 결과로 보낸다.
 * 돌려받은 requests 배열에 실제로 보낸 요청 본문이 쌓인다.
 */
export async function mockClaude(page, respond) {
  const requests = [];
  await page.route('https://api.anthropic.com/**', async (route) => {
    const body = JSON.parse(route.request().postData());
    requests.push(body);
    const out = await respond(body, requests.length);
    if (out && out.status) {
      return route.fulfill({ status: out.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out.body) });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: body.model,
        stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: JSON.stringify(out) }],
      }),
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

export const KEY = { apiKey: 'sk-ant-test', model: 'claude-opus-5-5' };

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
