// 데이터 저장소: 메모리에 들고 있다가 바뀔 때마다 이 기기(IndexedDB, persist.js)에 저장하고 구독한 화면에 알립니다.
// 데이터 형식·계산 규칙은 lib/model.js, 품목 색인은 lib/itemIndex.js 에 있습니다.

import { normKey, todayStr } from './lib/format.js';
import { migrate, mergeLegacy, sanitizePurchase, sanitizeMenu, sanitizeCategories, parseTarget, parseMargin } from './lib/model.js';
import { currentMinMargin } from './lib/cost.js';
import { buildItemIndex } from './lib/itemIndex.js';
import { applyCategoryEdit } from './lib/menuCategories.js';
import { linkInto, unlink, pairKey, groupKey } from './lib/itemLinks.js';
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
// 영수증 인식이 서버를 거치게 되면서 이 기기에 키를 둘 이유가 없어짐 → 예전에 저장한 키는 지움
if (settings.apiKey) {
  settings = { ...settings, apiKey: '' };
  writeJSON(SETTINGS_KEY, settings);
}
let index = null; // 품목 색인 (데이터가 바뀌면 다시 만듦)
let rev = 0; // 데이터가 바뀔 때마다 1씩 (화면에서 계산 결과를 다시 쓸지 판단)

const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());
// 사용자가 직접 바꾼 경우에만 알림 (서버 동기화가 '올릴 것 있음'으로 표시하는 데 씀)
const changeListeners = new Set();

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
  rev++;
  persistNow();
  changeListeners.forEach((fn) => fn());
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
  rev++;
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
    return (index ??= buildItemIndex(data.purchases, data.itemLinks));
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
  // ── 같은 품목 묶기 ──
  /** 같은 품목이면 같은 값 (묶기 반영) */
  itemKey(name) {
    return groupKey(data.itemLinks, name);
  },
  /** name 이 속한 묶음을 intoName 의 묶음에 합침 */
  linkItems(name, intoName) {
    const next = linkInto(data.itemLinks, name, intoName);
    if (next === data.itemLinks) return false;
    data.itemLinks = next;
    commit();
    return true;
  },
  /** 묶음에서 빼기 (대표 이름이 아닌 이름만) */
  unlinkItem(name) {
    const next = unlink(data.itemLinks, name);
    if (next === data.itemLinks) return false;
    data.itemLinks = next;
    commit();
    return true;
  },
  /** 대표 이름인지 (묶음에서 뺄 수 없는 이름) */
  isLinkedAlias(name) {
    return !!data.itemLinks[groupKey({}, name)];
  },
  /** '다른 품목'이라고 답한 쌍 (비슷한 이름 제안을 다시 하지 않음) */
  markNotSame(a, b) {
    const k = pairKey(a, b);
    if (data.itemNotSame.includes(k)) return;
    data.itemNotSame = [...data.itemNotSame, k];
    commit();
  },
  isNotSame(a, b) {
    return data.itemNotSame.includes(pairKey(a, b));
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

  /** 데이터 판(바뀔 때마다 늘어남) */
  get rev() {
    return rev;
  },
  /** 같은 품목 묶기 기록 (레벨 계산용) */
  get itemLinks() {
    return data.itemLinks;
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
  /** 원가 탭 메뉴 분류 (보여줄 순서대로) */
  get menuCategories() {
    return data.menuCategories;
  },
  /**
   * 분류 편집 저장 (추가·이름 바꾸기·삭제·순서). 지운 분류의 메뉴는 미분류로.
   * @param {Array<{orig: string|null, name: string}>} entries
   * @returns {number} 미분류로 옮겨진 메뉴 수
   */
  saveMenuCategories(entries) {
    const r = applyCategoryEdit(data.menus, entries, data.menuCategories, data.minMargins);
    data.menuCategories = r.categories;
    data.menus = r.menus;
    data.minMargins = r.margins;
    commit();
    return r.moved;
  },
  /** 분류별 최소 마진 기록 { 분류: [{value, bottle, at}] } */
  get minMargins() {
    return data.minMargins;
  },
  /** 분류의 현재 최소 마진 (없으면 null). kind: 'glass' 잔 / 'bottle' 보틀 */
  minMarginOf(category, kind = 'glass') {
    return currentMinMargin(data.minMargins, category, kind);
  },
  /** 분류의 최소 마진이 마지막으로 바뀐 기록 {value, at} (없으면 null) */
  minMarginLast(category) {
    return data.minMargins[category]?.at(-1) ?? null;
  },
  /**
   * 여러 분류의 최소 마진을 한 번에 저장. 바뀐 분류만 오늘 날짜로 기록 (빈칸·0 = 설정 안 함)
   * 값이 숫자·문자열이면 잔 최소 마진만 바꾸고 보틀은 그대로, {glass, bottle} 이면 적힌 것만 바꿈
   * @param {Record<string, string|number|{glass?: string|number, bottle?: string|number}>} values
   * @returns {string[]} 바뀐 분류
   */
  setMinMargins(values) {
    // 잘못된 값이 있으면 아무것도 저장하지 않음
    const parsed = Object.entries(values).map(([cat, v]) => {
      const o = v && typeof v === 'object' ? v : { glass: v };
      const cur = { glass: this.minMarginOf(cat) ?? 0, bottle: this.minMarginOf(cat, 'bottle') ?? 0 };
      return [cat, 'glass' in o ? parseMargin(o.glass) : cur.glass, 'bottle' in o ? parseMargin(o.bottle) : cur.bottle, cur];
    });
    const changed = [];
    for (const [cat, glass, bottle, cur] of parsed) {
      if (!data.menuCategories.includes(cat)) continue;
      if (cur.glass === glass && cur.bottle === bottle) continue;
      (data.minMargins[cat] ??= []).push({ value: glass, bottle, at: todayStr() });
      changed.push(cat);
    }
    if (changed.length) commit();
    return changed;
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
  /** 사용자가 장부를 바꿀 때마다 fn 호출 (서버에서 받아 바꾼 경우는 제외) */
  onLocalChange(fn) {
    changeListeners.add(fn);
    return () => changeListeners.delete(fn);
  },
  /** 서버에 올릴 장부 (그대로의 데이터) */
  snapshot() {
    return data;
  },
  /** 서버에서 받은 장부로 바꿈 (이 기기에도 저장, '바뀜'으로 치지 않음) */
  replaceData(raw) {
    data = migrate(raw);
    index = null;
    rev++;
    persistNow();
    notify();
  },
  importData(json) {
    const parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.purchases)) throw new Error('올바른 백업 파일이 아닙니다.');
    data = migrate(parsed);
    commit();
  },
};
