// 원가 탭 메뉴 분류: 편집(추가·이름 바꾸기·삭제·순서) 적용, 분류별 묶기
import { UNCATEGORIZED, sanitizeMenuCategories } from './model.js';

/**
 * 분류 편집 결과를 메뉴에 적용.
 * @param {Array} menus
 * @param {Array<{orig: string|null, name: string}>} entries 편집 화면의 줄 (orig: 원래 이름, 새로 추가한 줄은 null), 이 순서가 새 순서
 * @param {string[]} before 편집 전 분류 목록
 * @returns {{categories: string[], menus: Array, moved: number}} moved: 지운 분류에서 미분류로 옮겨진 메뉴 수
 */
export function applyCategoryEdit(menus, entries, before) {
  const categories = sanitizeMenuCategories(entries.map((e) => e.name));
  const rename = new Map();
  for (const e of entries) {
    const name = String(e.name ?? '').trim();
    if (e.orig && categories.includes(name)) rename.set(e.orig, name);
  }
  let moved = 0;
  const next = menus.map((m) => {
    if (!m.category) return m;
    if (rename.has(m.category)) return rename.get(m.category) === m.category ? m : { ...m, category: rename.get(m.category) };
    if (before.includes(m.category) || !categories.includes(m.category)) {
      moved++;
      return { ...m, category: '' };
    }
    return m;
  });
  return { categories, menus: next, moved };
}

/**
 * 원가 탭 '전체' 보기: 분류 순서대로 묶고, 미분류는 맨 뒤. 메뉴가 없는 분류는 뺌.
 * @param {Array<{m}>} rows  (원가율 순으로 정렬된 상태 그대로 유지)
 */
export function groupRowsByCategory(rows, categories) {
  const groups = categories.map((name) => ({ name, rows: rows.filter((r) => r.m.category === name) }));
  const known = new Set(categories);
  groups.push({ name: UNCATEGORIZED, rows: rows.filter((r) => !r.m.category || !known.has(r.m.category)) });
  return groups.filter((g) => g.rows.length);
}

/** 분류 칩 필터: '전체' 또는 분류 이름 또는 '미분류' */
export function filterMenus(menus, filter, categories) {
  if (!filter || filter === '전체') return menus;
  if (filter === UNCATEGORIZED) return menus.filter((m) => !m.category || !categories.includes(m.category));
  return menus.filter((m) => m.category === filter);
}
