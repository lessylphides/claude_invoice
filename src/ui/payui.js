// 결제 구분 UI (세금계산서 / 카드)
// '발행 받음'은 세금계산서에 딸린 하위 선택지이므로, 항상 세금계산서 상자 안쪽에 들여써서 보여줍니다.

import { won } from '../lib/format.js';

/**
 * 결제 구분 선택 상자
 * @param {{payType:'tax'|'card'|''|'mixed', issued:boolean, attrs?:string}} o
 *   attrs: 각 체크박스에 붙일 추가 속성 (예: data-ids="...")
 */
export function payChoiceHTML({ payType, issued, attrs = '' }) {
  const tax = payType === 'tax';
  const card = payType === 'card';
  return `
    <div class="pay-choice">
      <div class="pay-opt ${tax ? 'on' : ''}">
        <label class="pay-main"><input type="checkbox" data-pay="tax" ${attrs} ${tax ? 'checked' : ''}><span>세금계산서</span></label>
        ${
          tax
            ? `<label class="pay-sub ${issued ? 'ok' : 'warn'}">
                 <input type="checkbox" data-pay="issued" ${attrs} ${issued ? 'checked' : ''}><span>발행 받음</span>
                 <em>${issued ? '완료' : '미발행'}</em>
               </label>`
            : ''
        }
      </div>
      <div class="pay-opt ${card ? 'on' : ''}">
        <label class="pay-main"><input type="checkbox" data-pay="card" ${attrs} ${card ? 'checked' : ''}><span>카드</span></label>
      </div>
    </div>
    ${payType === 'mixed' ? '<p class="muted small pay-mixed">영수증마다 결제 구분이 다릅니다. 체크하면 모두 같게 바뀝니다.</p>' : ''}`;
}

/**
 * 결제 구분별 금액 (세금계산서 아래에 발행/미발행을 들여써서 표시)
 * @param {{tax:number, taxIssued:number, taxPending:number, card:number, none:number}} pay
 * @param {{total?:number, compact?:boolean}} o  compact=true 이면 0원인 줄은 숨김
 */
export function payBreakdownHTML(pay, { total, compact = false } = {}) {
  const show = (v) => !compact || v;
  const issuedPct = pay.tax ? (pay.taxIssued / pay.tax) * 100 : 0;
  return `
    <ul class="pay-break">
      ${
        show(pay.tax)
          ? `<li class="pb-group">
               <div class="pb-row"><span>세금계산서</span><b>${won(pay.tax)}</b></div>
               ${pay.tax ? `<div class="pb-bar" aria-hidden="true"><i class="ok" style="width:${issuedPct}%"></i><i class="warn" style="width:${100 - issuedPct}%"></i></div>` : ''}
               <ul class="pb-subs">
                 <li class="ok"><span>발행 받음</span><b>${won(pay.taxIssued)}</b></li>
                 <li class="warn"><span>미발행</span><b>${won(pay.taxPending)}</b></li>
               </ul>
             </li>`
          : ''
      }
      ${show(pay.card) ? `<li class="pb-group"><div class="pb-row"><span>카드</span><b>${won(pay.card)}</b></div></li>` : ''}
      ${show(pay.none) ? `<li class="pb-group muted"><div class="pb-row"><span>결제 구분 미지정</span><b>${won(pay.none)}</b></div></li>` : ''}
      ${total != null ? `<li class="pb-total"><span>합계</span><b>${won(total)}</b></li>` : ''}
    </ul>`;
}
