// 레벨·포인트: 장부 내용으로 계산 (앱과 서버가 같은 규칙을 씀)
// 기록을 지우면 포인트도 빠지고, 서버는 레벨업 선물을 줄 때 서버에 저장된 장부로 다시 계산함

import { normKey } from './format.js';
import { missionsOf, weekOf } from './missions.js';

export const POINTS = { receipt: 10, menu: 20, ingredient: 5, link: 5, streak3: 15, streak7: 50 };
/** 하루에 영수증으로 받을 수 있는 최대 포인트 (영수증 10건) */
export const DAILY_RECEIPT_CAP = 100;

export const MAX_LEVEL = 99;

/**
 * 레벨 n → n+1 에 필요한 포인트
 * - Lv.10 까지: 50, 70, 90 … (빨리 오르는 재미)
 * - Lv.10부터: 230 에서 8씩 늘어남
 *   하루 영수증 3장 꾸준히 → Lv.50 약 1년, Lv.90 약 2.8년, Lv.99 약 3.4년
 */
export const levelGap = (n) => (n < 10 ? 50 + 20 * (n - 1) : 230 + 8 * (n - 10));

const STARTS = [0, 0];
for (let n = 1; n < MAX_LEVEL; n++) STARTS[n + 1] = STARTS[n] + levelGap(n);
/** 레벨 n 이 되는 데 필요한 누적 포인트: Lv.2 50, Lv.3 120, Lv.4 210 … */
export const levelStart = (n) => (n <= 1 ? 0 : STARTS[Math.min(n, MAX_LEVEL)]);

export function levelOf(points) {
  let n = 1;
  while (n < MAX_LEVEL && points >= levelStart(n + 1)) n++;
  return n;
}

const NAMES = [
  [1, '새내기 사장'],
  [2, '영수증 모으는 사장'],
  [3, '장부 입문자'],
  [4, '꼼꼼한 사장'],
  [5, '장부 습관러'],
  [6, '거래처 관리인'],
  [7, '매입 탐정'],
  [8, '가격 추적자'],
  [9, '원가 계산러'],
  [10, '원가 고수'],
  [12, '마진 지킴이'],
  [15, '메뉴 설계자'],
  [20, '원가 장인'],
  [25, '장부의 달인'],
  [30, '원가 마스터'],
  [40, '동네 소문난 사장'],
  [50, '골목의 전설'],
  [60, '장사의 신'],
  [70, '원가의 현자'],
  [80, '장부의 지배자'],
  [90, '전설의 사장님'],
  [99, '명예의 전당'],
];
export const levelName = (n) => NAMES.filter(([lv]) => lv <= n).at(-1)[1];

/** 그 레벨에 오르면 받는 추가 인식 장수: Lv.2~4 3장, 5~9 5장, 10~19 10장, 20부터는 5레벨마다 20장, Lv.99 50장 */
export const rewardFor = (n) =>
  n < 2 || n > MAX_LEVEL ? 0 : n <= 4 ? 3 : n <= 9 ? 5 : n <= 19 ? 10 : n === MAX_LEVEL ? 50 : n % 5 === 0 ? 20 : 0;
/** n 보다 높은 레벨 중 선물이 있는 가장 가까운 레벨 */
export const nextGiftLevel = (n) => {
  for (let k = n + 1; k <= MAX_LEVEL; k++) if (rewardFor(k)) return k;
  return null;
};
/** from 레벨 다음부터 to 레벨까지 오르며 받는 선물 합계 */
export const rewardsBetween = (from, to) => {
  let s = 0;
  for (let n = from + 1; n <= to; n++) s += rewardFor(n);
  return s;
};

const kstDay = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
const dayNum = (ymd) => Math.round(Date.parse(`${ymd}T00:00:00Z`) / 86400000);
const totalOf = (p) => (p.items || []).reduce((s, i) => s + (Number(i.amount) || 0), 0);

/**
 * 장부 → 포인트·레벨·연속 기록
 * @param {{purchases?: Array, menus?: Array, itemLinks?: object}} data
 * @param {number} now 연속 기록(오늘·어제까지 이어졌는지) 계산용
 */
export function computeLevel(data, now = Date.now()) {
  const purchases = [...(data?.purchases || [])].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const seen = new Set();
  const perDay = new Map();
  const days = new Set();
  const vendors = new Set();
  const months = new Map(); // 영수증 날짜의 달 → 건수
  const weeks = new Map(); // 기록한 주 → {receipts, days}
  let receipts = 0;
  for (const p of purchases) {
    const total = Math.round(totalOf(p));
    if (!total) continue;
    // 같은 영수증을 두 번 올린 건 한 번만 (같은 날짜·합계·거래처)
    const key = `${p.date}|${total}|${normKey(p.vendor)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const day = kstDay(p.createdAt || 0);
    days.add(day);
    const got = perDay.get(day) || 0;
    if (got >= DAILY_RECEIPT_CAP) continue;
    perDay.set(day, got + POINTS.receipt);
    receipts++;
    if (normKey(p.vendor)) vendors.add(normKey(p.vendor));
    const mon = String(p.date || day).slice(0, 7);
    months.set(mon, (months.get(mon) || 0) + 1);
    const wk = weekOf(dayNum(day));
    const w = weeks.get(wk) || { receipts: 0, days: new Set() };
    w.receipts++;
    w.days.add(day);
    weeks.set(wk, w);
  }

  let menus = 0;
  let ingredients = 0;
  let costedMenus = 0;
  for (const m of data?.menus || []) {
    // 판매가(잔 또는 보틀)를 넣은 메뉴만 인정: 이름만 있는 빈 메뉴로 점수를 받지 않게
    if (!(Number(m.price) > 0 || Number(m.bottlePrice) > 0)) continue;
    menus++;
    const keys = new Set((m.ingredients || []).filter((g) => g.type !== 'manual' && g.itemName).map((g) => normKey(g.itemName)));
    ingredients += keys.size;
    if (keys.size) costedMenus++;
  }
  const links = Object.keys(data?.itemLinks || {}).length;

  // 연속 기록: 영수증을 저장한 날이 하루도 빠짐없이 이어진 구간마다 3일째·6일째… +15, 7일째·14일째… +50
  const sorted = [...days].map(dayNum).sort((a, b) => a - b);
  let streakBonus = 0;
  let run = 0;
  let prev = null;
  for (const d of sorted) {
    run = prev != null && d === prev + 1 ? run + 1 : 1;
    if (run % 3 === 0) streakBonus += POINTS.streak3;
    if (run % 7 === 0) streakBonus += POINTS.streak7;
    prev = d;
  }
  const today = dayNum(kstDay(now));
  let streak = 0;
  if (sorted.length && today - sorted.at(-1) <= 1) {
    streak = 1;
    for (let i = sorted.length - 1; i > 0 && sorted[i] - sorted[i - 1] === 1; i--) streak++;
  }

  const missions = missionsOf(
    { receipts, pricedMenus: menus, costedMenus, links, vendors: vendors.size, bestMonth: Math.max(0, ...months.values()), weeks },
    weekOf(today),
  );
  const points =
    receipts * POINTS.receipt +
    menus * POINTS.menu +
    ingredients * POINTS.ingredient +
    links * POINTS.link +
    streakBonus +
    missions.bonus;
  const level = levelOf(points);
  const max = level >= MAX_LEVEL;
  const start = levelStart(level);
  const next = levelStart(level + 1);
  return {
    points,
    level,
    max,
    name: levelName(level),
    progress: max ? 1 : (points - start) / (next - start),
    toNext: max ? 0 : next - points,
    streak,
    parts: { receipts, menus, ingredients, links, streakBonus, missions: missions.bonus },
    missions,
  };
}
