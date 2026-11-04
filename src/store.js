// 데이터 저장소: 이 기기 브라우저(localStorage)에 저장하고, 바뀌면 구독한 화면에 알립니다.
// 데이터 형식·계산 규칙은 lib/model.js, 품목 색인은 lib/itemIndex.js 에 있습니다.

import { normKey, todayStr } from './lib/format.js';
import { migrate, sanitizePurchase, sanitizeMenu, sanitizeCategories, parseTarget } from './lib/model.js';
import { buildItemIndex } from './lib/itemIndex.js';

const DATA_KEY = 'maeip.data.v1';
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
    alert('저장에 실패했습니다. 브라우저 저장 공간 또는 개인정보 보호 모드를 확인하세요.');
    return false;
  }
}

let data = migrate(readJSON(DATA_KEY));
let settings = { apiKey: '', model: MODELS[0].id, ...readJSON(SETTINGS_KEY) };
let index = null; // 품목 색인 (데이터가 바뀌면 다시 만듦)

const listeners = new Set();
function commit() {
  index = null;
  writeJSON(DATA_KEY, data);
  listeners.forEach((fn) => fn());
}

const upsertInto = (list, clean) => {
  const i = list.findIndex((x) => x.id === clean.id);
  if (i >= 0) list[i] = clean;
  else list.push(clean);
  return clean;
};

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
    writeJSON(SETTINGS_KEY, settings);
  },

  // ── 백업 ──
  exportData() {
    return JSON.stringify({ app: 'maeip-calendar', exportedAt: new Date().toISOString(), ...data }, null, 2);
  },
  importData(json) {
    const parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.purchases)) throw new Error('올바른 백업 파일이 아닙니다.');
    data = migrate(parsed);
    commit();
  },
};
