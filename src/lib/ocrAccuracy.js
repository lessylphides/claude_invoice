// 인식 정확도: 자동 인식 결과(초안)와 사용자가 실제로 저장한 내용을 비교해 "몇 군데 고쳤는지"만 셈
// 내용(거래처 이름, 품목 이름, 금액)은 보내지 않고 숫자만 보냄

const same = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();
const sameNum = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 1;
const sum = (items) => items.reduce((s, i) => s + (Number(i.amount) || 0), 0);

/** 비교 결과에 들어가는 숫자 항목 (서버도 이 목록만 받음) */
export const ACC_FIELDS = ['receipts', 'untouched', 'discarded', 'date', 'vendor', 'total', 'items', 'itemsAdded', 'itemsRemoved', 'name', 'category', 'qty', 'price'];

/**
 * @param {object} draft 자동 인식으로 만든 초안 (편집 전)
 * @param {object|null} saved 저장한 매입 (취소했으면 null)
 * @returns {Record<string, number>} 고친 곳 개수
 */
export function ocrEdits(draft, saved) {
  const out = Object.fromEntries(ACC_FIELDS.map((k) => [k, 0]));
  out.receipts = 1;
  const items = draft.items || [];
  if (!saved) {
    out.discarded = 1; // 저장하지 않고 닫음 (품목 수는 세지 않음: 정확도 분모는 저장한 영수증만)
    return out;
  }
  out.items = items.length;
  out.date = same(draft.date, saved.date) ? 0 : 1;
  out.vendor = same(draft.vendor, saved.vendor) ? 0 : 1;
  out.total = sameNum(sum(items), sum(saved.items || [])) ? 0 : 1;

  const byId = new Map((saved.items || []).map((i) => [i.id, i]));
  for (const d of items) {
    const s = byId.get(d.id);
    if (!s) {
      out.itemsRemoved++;
      continue;
    }
    byId.delete(d.id);
    if (!same(d.name, s.name)) out.name++;
    if (!same(d.category, s.category)) out.category++;
    if (!sameNum(d.qty, s.qty)) out.qty++;
    if (!sameNum(d.unitPrice, s.unitPrice) || !sameNum(d.amount, s.amount) || !sameNum(d.discount, s.discount)) out.price++;
  }
  out.itemsAdded = byId.size;
  const edits = out.date + out.vendor + out.total + out.itemsAdded + out.itemsRemoved + out.name + out.category + out.qty + out.price;
  out.untouched = edits === 0 ? 1 : 0;
  return out;
}
