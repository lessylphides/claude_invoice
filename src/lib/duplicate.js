// 같은 영수증을 두 번 올렸는지: 같은 날짜 + 같은 합계 + 같은(비슷한) 거래처
import { normKey } from './format.js';
import { purchaseTotal } from './model.js';
import { nameSimilarity } from './itemLinks.js';

function sameVendor(a, b) {
  const ka = normKey(a);
  const kb = normKey(b);
  if (!ka || !kb) return false;
  if (ka === kb || ka.includes(kb) || kb.includes(ka)) return true; // (주)코스트코코리아 양재점 ↔ 코스트코코리아
  return nameSimilarity(a, b) >= 0.8;
}

/**
 * 이미 저장된 매입 중 같은 영수증으로 보이는 것 (없으면 null)
 * @param {Array} purchases 저장된 매입
 * @param {{id?, date, vendor, items}} p 지금 입력 중인 매입 (수정 중이면 자기 자신은 뺌)
 */
export function findDuplicate(purchases, p) {
  const total = purchaseTotal(p);
  if (!p.date || !total) return null;
  return (
    purchases.find((x) => x.id !== p.id && x.date === p.date && Math.abs(purchaseTotal(x) - total) < 1 && sameVendor(x.vendor, p.vendor)) ?? null
  );
}
