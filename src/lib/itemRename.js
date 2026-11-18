// 품목 이름 고치기 (오타 수정): 매입 기록·메뉴 재료·같은 품목 묶기에 있는 같은 이름을 한 번에 바꿈
// '같은 이름'은 공백·(주) 같은 표기 차이를 무시한 이름(normKey)이 같은 것. 묶인 다른 이름(별칭)은 그대로 둠
import { normKey } from './format.js';
import { sanitizeLinks, pairKey } from './itemLinks.js';

/** 바꾸면 영향을 받는 곳 개수 (바꾸기 전에 물어볼 때) */
export function renameCounts(data, oldName, { exceptPurchaseId = null } = {}) {
  const k = normKey(oldName);
  let purchases = 0;
  for (const p of data.purchases) if (p.id !== exceptPurchaseId && p.items.some((i) => normKey(i.name) === k)) purchases++;
  const menus = data.menus.filter((m) => (m.ingredients || []).some((g) => g.type === 'item' && normKey(g.itemName) === k)).length;
  return { purchases, menus };
}

/**
 * data 를 직접 고침. @returns {{purchases:number, items:number, menus:number}} 바꾼 개수
 */
export function renameItemInData(data, oldName, newName) {
  const k = normKey(oldName);
  const name = String(newName ?? '').trim();
  const out = { purchases: 0, items: 0, menus: 0 };
  if (!k || !name || normKey(name) === k) return out;
  for (const p of data.purchases) {
    let hit = false;
    for (const i of p.items)
      if (normKey(i.name) === k) {
        i.name = name;
        out.items++;
        hit = true;
      }
    if (hit) out.purchases++;
  }
  for (const m of data.menus) {
    let hit = false;
    for (const g of m.ingredients || [])
      if (g.type === 'item' && normKey(g.itemName) === k) {
        g.itemName = name;
        hit = true;
      }
    if (hit) out.menus++;
  }
  // 묶음: 대표 이름이 옛 이름이면 새 이름으로, 옛 이름이 별칭이면 새 이름이 그 자리를 이어받음 (자기 자신을 가리키면 정리됨)
  const nk = normKey(name);
  const links = {};
  for (const [key, v] of Object.entries(data.itemLinks || {})) links[key === k ? nk : key] = normKey(v) === k ? name : v;
  data.itemLinks = sanitizeLinks(links);
  data.itemNotSame = [...new Set((data.itemNotSame || []).map((pk) => { const [a, b] = pk.split('|'); return pairKey(a === k ? nk : a, b === k ? nk : b); }).filter((pk) => { const [a, b] = pk.split('|'); return a !== b; }))];
  return out;
}
