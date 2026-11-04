// 데이터 보관: IndexedDB (브라우저가 허락하는 큰 저장 공간)
//
// 예전에는 localStorage 에 JSON 글자로 저장했는데, 아이폰 Safari 는 사이트당 약 5MB 까지만 허락하고
// 한글은 글자당 2바이트로 계산되어 1년쯤 쓰면 가득 찹니다. IndexedDB 는 훨씬 크고, 글자로 바꾸지 않고 그대로 저장합니다.
// 처음 열 때 localStorage 의 예전 데이터를 옮기고, 옮긴 뒤에는 예전 데이터를 지웁니다.
// IndexedDB 를 못 쓰는 환경(일부 개인정보 보호 모드)에서는 예전처럼 localStorage 를 씁니다.

const DB_NAME = 'maeip';
const STORE = 'kv';
const KEY = 'data';
export const LEGACY_KEY = 'maeip.data.v1';

let dbPromise = null;

function openDb() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB 없음'));
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close(); // 다른 탭에서 지우거나 올릴 때 막지 않음
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

function tx(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(req?.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error ?? new Error('저장이 취소되었습니다'));
      }),
  );
}

function readLegacy() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

let useLocal = false; // IndexedDB 를 못 쓰면 true

/** @returns {Promise<{raw: object|null, migrated: boolean}>} migrated: 예전 localStorage 데이터를 읽었음 */
export async function load() {
  try {
    const raw = await tx('readonly', (s) => s.get(KEY));
    if (raw) return { raw, migrated: false };
    const legacy = readLegacy();
    return { raw: legacy, migrated: !!legacy };
  } catch {
    useLocal = true;
    return { raw: readLegacy(), migrated: false };
  }
}

/** 저장. 실패하면 오류를 던짐 */
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

/** 저장 공간 사용량 {usage, quota, persisted} (모르면 null) */
export async function storageInfo() {
  try {
    const est = (await navigator.storage?.estimate?.()) ?? null;
    const persisted = (await navigator.storage?.persisted?.()) ?? false;
    return est ? { usage: est.usage ?? 0, quota: est.quota ?? 0, persisted, backend: useLocal ? 'localStorage' : 'IndexedDB' } : null;
  } catch {
    return null;
  }
}
