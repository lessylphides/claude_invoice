// 화면 상태(어느 달·어느 탭을 보고 있는지)와 다시 그리기
import { pad } from './lib/format.js';

const now = new Date();

function readTab() {
  try {
    return localStorage.getItem('maeip.tab') === 'cost' ? 'cost' : 'purchase';
  } catch {
    return 'purchase';
  }
}

export const view = {
  year: now.getFullYear(),
  month: now.getMonth() + 1, // 1-12
  summary: 'vendor', // 월 요약: vendor | category | pay
  expanded: new Set(), // 월 요약에서 펼친 줄
  selectedDate: null, // 열려 있는 날짜 상세
  tab: readTab(), // purchase | cost
};

let renderFn = () => {};
export const setRenderer = (fn) => (renderFn = fn);
export const rerender = () => renderFn();

export const monthKey = () => `${view.year}-${pad(view.month)}`;

export function setTab(tab) {
  view.tab = tab;
  try {
    localStorage.setItem('maeip.tab', tab);
  } catch {}
  rerender();
}

export function shiftMonth(delta) {
  const d = new Date(view.year, view.month - 1 + delta, 1);
  view.year = d.getFullYear();
  view.month = d.getMonth() + 1;
  rerender();
}

/** 이번 달로 (앱을 켜 둔 채 날짜가 바뀌어도 맞도록 매번 오늘을 다시 구함) */
export function goToday() {
  const d = new Date();
  view.year = d.getFullYear();
  view.month = d.getMonth() + 1;
  rerender();
}

/** 'YYYY-MM-DD' 가 속한 달로 이동 */
export function goToMonth(date) {
  const [y, m] = date.split('-').map(Number);
  if (y !== view.year || m !== view.month) {
    view.year = y;
    view.month = m;
    rerender();
  }
}
