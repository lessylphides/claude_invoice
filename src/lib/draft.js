// Claude 인식 결과(JSON) → 입력 화면 초안
import { isYmd, num, uid } from './format.js';
import { guessPack } from './model.js';

/**
 * 용량 채우기: 같은 품목의 이전 매입 기록 → 이름에서 추정(700ML 등) 순.
 * 이전 기록에서 가져오면 _specFrom='history' (화면에 '이전 기록' 표시). 채웠으면 true
 */
export function fillSpec(it, specOf) {
  const prev = specOf(it.name);
  if (prev) {
    Object.assign(it, prev, { _specFrom: 'history' });
    return true;
  }
  const g = guessPack(it.name);
  if (g) {
    Object.assign(it, g, { _specFrom: '' });
    return true;
  }
  return false;
}

/**
 * @param {object} r          Claude 가 돌려준 인식 결과
 * @param {string} fallbackDate 날짜를 못 읽었을 때 쓸 날짜
 * @param {(name:string)=>({packSize,packUnit}|null)} specOf  이전 용량 기록 조회
 * @returns {{draft: object, note: string}}
 */
export function draftFromOcr(r, fallbackDate, specOf = () => null) {
  const date = isYmd(r.date) ? r.date : fallbackDate;
  const items = (Array.isArray(r.items) ? r.items : []).map((i) => {
    const qty = Number(i.qty) || 1;
    const discount = Math.max(0, Math.round(Number(i.discount) || 0));
    const amount = Number(i.amount) || 0;
    const unitPrice = Number(i.unitPrice) || Math.round((amount + discount) / qty);
    const it = {
      id: uid(),
      name: i.name,
      category: i.category,
      qty,
      unit: i.unit || '',
      unitPrice,
      discount,
      amount: amount || qty * unitPrice - discount,
      packSize: Number(i.packSize) || 0,
      packUnit: Number(i.packSize) ? i.packUnit || '' : '',
    };
    // 같은 품목을 전에 산 적이 있으면 그때 확인한 용량을 우선 (없으면 인식값, 그것도 없으면 이름에서 추정)
    const prev = specOf(it.name);
    if (prev) Object.assign(it, prev, { _specFrom: 'history' });
    else if (!it.packSize) Object.assign(it, guessPack(it.name) ?? {});
    return it;
  });
  if (!items.length && r.total) items.push({ id: uid(), name: '합계', category: '기타', qty: 1, unit: '', unitPrice: r.total, discount: 0, amount: r.total, packSize: 0, packUnit: '' });

  const notes = [];
  if (date !== r.date) notes.push('날짜를 읽지 못해 선택한 날짜로 넣었습니다.');
  const sum = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  if (r.total && Math.abs(sum - r.total) > 1) notes.push(`품목 합계(${num(sum)}원)와 문서 합계(${num(r.total)}원)가 다릅니다. 확인해 주세요.`);

  return {
    draft: {
      date,
      vendor: r.vendor || '',
      payType: r.paymentHint === 'card' ? 'card' : r.paymentHint === 'tax' || r.documentType === '세금계산서' ? 'tax' : '',
      taxIssued: r.documentType === '세금계산서',
      items,
    },
    note: notes.join(' '),
  };
}
