// 데이터 보관: IndexedDB (브라우저가 허락하는 큰 저장 공간)
//
// 예전에는 localStorage 에 JSON 글자로 저장했는데, 아이폰 Safari 는 사이트당 약 5MB 까지만 허락하고
// 한글은 글자당 2바이트로 계산되어 1년쯤 쓰면 가득 찹니다. IndexedDB 는 훨씬 크고, 글자로 바꾸지 않고 그대로 저장합니다.
//
// 지키는 원칙
// - 처음 열 때 localStorage 의 예전 데이터를 옮기고, 옮긴 뒤에는 예전 사본을 지웁니다.
// - IndexedDB 연결이 잠깐 끊겨도(아이폰에서 앱이 백그라운드에 있을 때 흔함) 새로 연결해 다시 시도합니다.
// - IndexedDB 를 읽지 못했는데 예전 사본도 없으면 '빈 장부'로 시작하지 않고 오류를 알립니다
//   (빈 장부에 새로 입력하면 진짜 데이터와 갈라져서 나중에 사라지므로).
// - IndexedDB 가 아예 없는 환경(일부 개인정보 보호 모드)에서만 예전처럼 localStorage 를 씁니다.

const DB_NAME = 'maeip';
const STORE = 'kv';
const KEY = 'data';
export const LEGACY_KEY = 'maeip.data.v1';

let dbPromise = null;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      const db = req.result;
      const forget = () => {
        if (dbPromise && current === db) dbPromise = null;
      };
      // 다른 탭이 지우거나 버전을 올리면 비켜 주고, 연결이 닫히면 다음에 새로 연결
      db.onversionchange = () => {
        db.close();
        forget();
      };
      db.onclose = forget;
      current = db;
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB 가 다른 탭에서 사용 중'));
  }).catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}
let current = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 트랜잭션 실행. 연결이 끊겨 있으면 새로 연결해 최대 3번 시도 */
async function tx(mode, fn, attempt = 0) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode); // 닫힌 연결이면 여기서 InvalidStateError
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error('저장이 취소되었습니다'));
    });
  } catch (err) {
    if (attempt >= 2 || err?.name === 'QuotaExceededError') throw err;
    dbPromise = null;
    await sleep(150 * (attempt + 1));
    return tx(mode, fn, attempt + 1);
  }
}

function readLegacy() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const hasIdb = () => typeof indexedDB !== 'undefined';
let useLocal = !hasIdb(); // IndexedDB 가 아예 없으면 예전 방식

export class LoadError extends Error {}

/**
 * @returns {Promise<{raw: object|null, legacy: object|null}>}
 *   raw: 저장된 데이터 (IndexedDB, 없으면 예전 localStorage)
 *   legacy: IndexedDB 와 함께 남아 있는 예전 localStorage 데이터 (옮기는 중이거나, 예전 버전 창이 그 뒤에 쓴 것)
 */
export async function load() {
  if (useLocal) return { raw: readLegacy(), legacy: null };
  let raw;
  try {
    raw = await tx('readonly', (s) => s.get(KEY));
  } catch (err) {
    const legacy = readLegacy();
    // IndexedDB 를 읽지 못했는데 예전 사본이 있으면, 아직 옮기기 전이므로 예전 방식으로 계속
    if (legacy) {
      useLocal = true;
      return { raw: legacy, legacy: null };
    }
    throw new LoadError(`저장된 데이터를 읽지 못했습니다 (${err?.name || err}).`);
  }
  return { raw: raw ?? null, legacy: readLegacy() };
}

/** 저장. 실패하면 오류를 던짐. dropLegacy: 성공하면 예전 localStorage 사본을 지움 */
export async function save(data, { dropLegacy = false } = {}) {
  if (useLocal) {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(data));
    return;
  }
  await tx('readwrite', (s) => s.put(data, KEY));
  if (dropLegacy) {
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch {}
  }
}

/** 브라우저가 공간이 부족할 때 이 앱 데이터를 지우지 않도록 요청 (가능한 경우) */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** 저장 공간 사용량 {usage, quota, persisted, backend} (모르면 null) */
export async function storageInfo() {
  try {
    const est = (await navigator.storage?.estimate?.()) ?? null;
    const persisted = (await navigator.storage?.persisted?.()) ?? false;
    return est ? { usage: est.usage ?? 0, quota: est.quota ?? 0, persisted, backend: useLocal ? 'localStorage' : 'IndexedDB' } : null;
  } catch {
    return null;
  }
}
