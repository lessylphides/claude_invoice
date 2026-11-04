// 품목 색인: 이름이 같은 품목(공백·(주) 등 표기 차이 무시)의 매입 기록을 한 번에 모아 둠.
// 가격 추이·용량 기록·원가 계산·품목 고르기가 매번 전체 매입을 훑지 않도록, 데이터가 바뀔 때 한 번만 만듭니다.

import { normKey } from './format.js';
import { netUnitPrice } from './model.js';

const newestFirst = (a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt;

export function buildItemIndex(purchases) {
  /** @type {Map<string, Array<{name, item, purchase, date, createdAt, vendor, price}>>} */
  const byKey = new Map();
  for (const p of purchases)
    for (const item of p.items) {
      const k = normKey(item.name);
      if (!k) continue;
      let rows = byKey.get(k);
      if (!rows) byKey.set(k, (rows = []));
      rows.push({ name: item.name, item, purchase: p, date: p.date, createdAt: p.createdAt, vendor: p.vendor, price: netUnitPrice(item) });
    }
  for (const rows of byKey.values()) rows.sort(newestFirst);

  const specCache = new Map();

  return {
    /** 같은 품목의 매입 기록 (최근 순) */
    history(name) {
      return byKey.get(normKey(name)) ?? [];
    },
    /** 같은 품목의 가장 최근 용량 기록 {packSize, packUnit} (없으면 null) */
    spec(name) {
      const k = normKey(name);
      if (!specCache.has(k)) {
        const row = (byKey.get(k) ?? []).find((r) => r.item.packSize);
        specCache.set(k, row ? { packSize: row.item.packSize, packUnit: row.item.packUnit } : null);
      }
      return specCache.get(k);
    },
    /** 고를 수 있는 품목 목록: 품목마다 가장 최근 정상 매입(금액>0) 한 건, 최근 순 */
    pickList() {
      const out = [];
      for (const rows of byKey.values()) {
        const r = rows.find((x) => x.item.amount > 0);
        if (r) out.push({ name: r.name, category: r.item.category || '기타', price: r.price, date: r.date, createdAt: r.createdAt, spec: this.spec(r.name) });
      }
      return out.sort(newestFirst);
    },
  };
}
