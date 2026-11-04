// 데이터 저장소: 메모리에 들고 있다가 바뀔 때마다 이 기기(IndexedDB, persist.js)에 저장하고 구독한 화면에 알립니다.
// 데이터 형식·계산 규칙은 lib/model.js, 품목 색인은 lib/itemIndex.js 에 있습니다.

import { normKey, todayStr } from './lib/format.js';
import { migrate, mergeLegacy, sanitizePurchase, sanitizeMenu, sanitizeCategories, parseTarget } from './lib/model.js';
import { buildItemIndex } from './lib/itemIndex.js';
import * as persist from './persist.js';

const SETTINGS_KEY = 'maeip.settings.v1';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (정확도 우선, 기본)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (빠름·저렴)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (가장 저렴)' },
];

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

let data = migrate(null); // ready 전까지는 빈 데이터
let settings = { apiKey: '', model: MODELS[0].id, ...readJSON(SETTINGS_KEY) };
let index = null; // 품목 색인 (데이터가 바뀌면 다시 만듦)

const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

// ── 저장: 바뀔 때마다 바로 쓰기 시작하고, 쓰는 중에 또 바뀌면 끝난 뒤 한 번 더 씀 ──
let inflight = null;
let again = false;
let dropLegacy = false; // 예전 localStorage 데이터를 옮긴 직후 첫 저장이 끝나면 지움
let warned = false;

// 같은 저장소를 쓰는 다른 창(탭)이 저장하면, 이 창의 데이터는 낡은 것이 됨.
// 낡은 데이터로 덮어쓰면 다른 창의 입력이 사라지므로, 이 창은 저장을 멈추고 새로 불러오기를 안내합니다.
const tabId = Math.random().toString(36).slice(2);
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('maeip') : null;
let stale = false;
channel?.addEventListener('message', (e) => {
  if (e.data?.type === 'saved' && e.data.from !== tabId && !stale) {
    stale = true;
    notify();
  }
});

function persistNow() {
  if (stale) {
    alert('다른 창에서 데이터가 바뀌어 이 창의 변경은 저장하지 않았습니다. 화면 위의 [새로 불러오기]를 눌러 주세요.');
    return Promise.resolve();
  }
  if (inflight) {
    again = true;
    return inflight;
  }
  inflight = persist
    .save(data, { dropLegacy })
    .then(() => {
      dropLegacy = false;
      warned = false;
      channel?.postMessage({ type: 'saved', from: tabId });
    })
    .catch((err) => {
      if (!warned) {
        warned = true;
        alert(`저장에 실패했습니다 (${err?.name || err}). 저장 공간을 확인하고, ⚙ 설정에서 백업 파일을 저장해 두세요.`);
      }
    })
    .finally(() => {
      inflight = null;
      if (again) {
        again = false;
        persistNow();
      }
    });
  return inflight;
}

function commit() {
  index = null;
  persistNow();
  notify();
}

/**
 * 앱 시작: 저장된 데이터를 읽어 옴.
 * - 예전 localStorage 데이터만 있으면 옮김
 * - 둘 다 있으면(예전 버전 창이 옮긴 뒤에 쓴 경우) 빠진 내역만 합침
 * 읽지 못하면 reject → 화면에 오류와 다시 시도를 보여줌 (빈 장부로 시작하지 않음)
 */
export const ready = (async () => {
  const { raw, legacy } = await persist.load();
  data = migrate(raw ?? legacy, { trusted: true });
  if (raw && legacy) data = mergeLegacy(data, migrate(legacy)).data;
  if (legacy) {
    dropLegacy = true;
    persistNow();
  }
  persist.requestPersistence();
})();
const upsertInto = (list, clean) => {
  const i = list.findIndex((x) => x.id === clean.id);
  if (i >= 0) list[i] = clean;
  else list.push(clean);
  return clean;
};

/** 첫 화면을 그린 뒤 한가할 때 품목 색인을 미리 만들어 둠 (가격 추이·원가 탭을 처음 열 때 빠르게) */
export function warmIndex() {
  const run = () => store.index;
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 500);
}

export const store = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  // ── 매입 ──
  get purchases() {
    return data.purchases;
  },
  get categories() {
    return data.categories;
  },
  /** 품목 색인: history(name) / spec(name) / pickList() */
  get index() {
    return (index ??= buildItemIndex(data.purchases));
  },
  get(id) {
    return data.purchases.find((p) => p.id === id);
  },
  upsert(p) {
    const clean = upsertInto(data.purchases, sanitizePurchase(p));
    commit();
    return clean;
  },
  remove(id) {
    data.purchases = data.purchases.filter((p) => p.id !== id);
    commit();
  },
  /** 여러 영수증(같은 날·같은 거래처)의 결제 정보를 한 번에 바꿈 */
  setPayment(ids, patch) {
    for (const p of data.purchases) {
      if (!ids.includes(p.id)) continue;
      if ('payType' in patch) p.payType = patch.payType;
      if ('taxIssued' in patch) p.taxIssued = !!patch.taxIssued;
      if (p.payType !== 'tax') p.taxIssued = false;
    }
    commit();
  },
  setCategories(list) {
    data.categories = sanitizeCategories(list);
    commit();
  },
  /** 지금까지 입력된 거래처 이름 (최근 사용 순) */
  vendorNames() {
    const seen = new Map();
    [...data.purchases]
      .sort((a, b) => b.date.localeCompare(a.date))
      .forEach((p) => {
        const k = normKey(p.vendor);
        if (!seen.has(k)) seen.set(k, p.vendor);
      });
    return [...seen.values()];
  },

  // ── 원가 ──
  get menus() {
    return data.menus;
  },
  getMenu(id) {
    return data.menus.find((m) => m.id === id);
  },
  upsertMenu(m) {
    const clean = upsertInto(data.menus, sanitizeMenu(m));
    commit();
    return clean;
  },
  removeMenu(id) {
    data.menus = data.menus.filter((m) => m.id !== id);
    commit();
  },
  /** 현재 목표 원가율 {value, at, note?} */
  get costTarget() {
    return data.costTarget.history.at(-1);
  },
  get costTargetHistory() {
    return data.costTarget.history;
  },
  setCostTarget(value) {
    data.costTarget.history.push({ value: parseTarget(value), at: todayStr() });
    commit();
  },

  // ── 설정 ──
  get settings() {
    return settings;
  },
  saveSettings(patch) {
    settings = { ...settings, ...patch };
    if (!writeJSON(SETTINGS_KEY, settings)) alert('설정 저장에 실패했습니다. 개인정보 보호 모드인지 확인하세요.');
  },
  /** 다른 창에서 저장해서 이 창의 데이터가 낡았는지 */
  get stale() {
    return stale;
  },

  // ── 백업 ──
  exportData() {
    return JSON.stringify({ app: 'maeip-calendar', exportedAt: new Date().toISOString(), ...data }, null, 2);
  },
  /** 백업 파일을 저장했음을 기록 (백업 알림용) */
  markBackedUp() {
    this.saveSettings({ lastBackupAt: todayStr(), backupSnoozeUntil: null });
    notify();
  },
  snoozeBackup(until) {
    this.saveSettings({ backupSnoozeUntil: until });
    notify();
  },
  importData(json) {
    const parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.purchases)) throw new Error('올바른 백업 파일이 아닙니다.');
    data = migrate(parsed);
    commit();
  },
};
