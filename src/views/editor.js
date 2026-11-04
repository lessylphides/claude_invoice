// 매입 내역 입력/수정 폼 (촬영 인식 결과 검토 포함)

import { esc, num, won, todayStr, uid } from '../lib/format.js';
import { purchaseTotal, itemAmount } from '../lib/model.js';
import { fillSpec } from '../lib/draft.js';
import { openSheet, toast } from '../ui/sheet.js';
import { payChoiceHTML } from '../ui/payui.js';
import { unitSelectHTML } from '../ui/units.js';
import { store } from '../store.js';

const specOf = (name) => store.index.spec(name);

/**
 * @param {object} draft 초기값 (purchase 형식, id 가 있으면 수정)
 * @param {{imageFiles?:File[], note?:string}} opts
 * @returns {Promise<object|null>} 저장된 purchase 또는 null(취소)
 */
export function openEditor(draft, { imageFiles = [], note } = {}) {
  const isEdit = !!(draft.id && store.get(draft.id));
  const p = structuredClone({
    date: todayStr(), vendor: '', payType: '', taxIssued: false, memo: '', items: [], ...draft,
  });
  if (!p.items.length) p.items.push(blankItem());
  p.items.forEach((i) => (i.id ||= uid()));
  const imgUrls = imageFiles.map((f) => URL.createObjectURL(f));

  return new Promise((resolve) => {
    let saved = null;
    openSheet({
      title: isEdit ? '매입 내역 수정' : '매입 내역 확인',
      onClose: () => {
        imgUrls.forEach((u) => URL.revokeObjectURL(u));
        resolve(saved);
      },
      render(body, close) {
        const cats = store.categories;
        body.innerHTML = `
          ${note ? `<p class="notice">${esc(note)}</p>` : ''}
          ${
            imgUrls.length
              ? `<details class="photo"><summary>촬영한 사진 보기${imgUrls.length > 1 ? ` (${imgUrls.length}장)` : ''}</summary>${imgUrls
                  .map((u, i) => `<img src="${u}" alt="영수증 사진 ${i + 1}">`)
                  .join('')}</details>`
              : ''
          }
          <form class="editor" novalidate>
            <div class="row2">
              <label>날짜<input type="date" name="date" required value="${esc(p.date)}"></label>
              <label>거래처<input name="vendor" list="vendor-list" required placeholder="상호명" value="${esc(p.vendor)}"></label>
            </div>
            <datalist id="vendor-list">${store.vendorNames().map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
            <fieldset class="pay">
              <legend>결제 구분</legend>
              <div class="pay-slot"></div>
            </fieldset>
            <h3 class="sub">품목</h3>
            <div class="row-nums item-head" aria-hidden="true"><span>분류</span><span>수량</span><span>단위</span><span>단가</span><span>금액</span></div>
            <div class="items"></div>
            <button type="button" class="btn ghost add-item">+ 품목 추가</button>
            <label>메모<input name="memo" value="${esc(p.memo)}" placeholder="선택"></label>
            <div class="total-bar"><span>합계</span><strong class="sum"></strong></div>
            <div class="actions">
              <button type="button" class="btn ghost cancel">취소</button>
              <button type="submit" class="btn primary">저장</button>
            </div>
          </form>`;

        const form = body.querySelector('form');
        const itemsEl = body.querySelector('.items');
        const sumEl = body.querySelector('.sum');
        const updateSum = () => (sumEl.textContent = won(purchaseTotal(p)));

        const drawItems = () => {
          itemsEl.innerHTML = p.items
            .map(
              (it, idx) => `
            <div class="item-edit" data-idx="${idx}">
              <div class="row-name">
                <input data-f="name" placeholder="품목명" value="${esc(it.name)}" aria-label="품목명">
                <button type="button" class="icon-btn del" aria-label="품목 삭제">✕</button>
              </div>
              <div class="row-nums">
                <select data-f="category" aria-label="분류">${[...new Set([...cats, it.category].filter(Boolean))]
                  .map((c) => `<option ${c === it.category ? 'selected' : ''}>${esc(c)}</option>`)
                  .join('')}</select>
                <input data-f="qty" type="number" inputmode="decimal" step="any" placeholder="수량" value="${it.qty ?? ''}" aria-label="수량">
                <input data-f="unit" placeholder="단위" value="${esc(it.unit)}" aria-label="단위">
                <input data-f="unitPrice" type="number" inputmode="numeric" placeholder="단가" value="${it.unitPrice ?? ''}" aria-label="단가">
                <input data-f="amount" type="number" inputmode="numeric" placeholder="금액" value="${it.amount ?? ''}" aria-label="금액(할인 후)">
              </div>
              <div class="row-spec">
                <span class="spec-label">1개 용량</span>
                <input data-f="packSize" type="number" inputmode="decimal" step="any" min="0" placeholder="예: 700" value="${it.packSize || ''}" aria-label="1개 용량">
                ${unitSelectHTML('data-f="packUnit"', it.packUnit || '')}
                ${it._specFrom === 'history' ? '<em class="spec-tag">이전 기록</em>' : ''}
                ${Number(it.discount) || it._showDisc ? '' : '<button type="button" class="link add-disc">+ 쿠폰·할인</button>'}
              </div>
              ${
                Number(it.discount) || it._showDisc
                  ? `<div class="row-disc">
                       <span class="disc-label">└ 할인</span>
                       <input data-f="discount" type="number" inputmode="numeric" min="0" placeholder="할인액" value="${it.discount || ''}" aria-label="할인 금액">
                       <span class="disc-net">정가 ${num((Number(it.qty) || 0) * (Number(it.unitPrice) || 0))}원</span>
                       <button type="button" class="link danger rm-disc">빼기</button>
                     </div>`
                  : ''
              }
            </div>`,
            )
            .join('');
          updateSum();
        };
        drawItems();

        itemsEl.addEventListener('input', (e) => {
          const f = e.target.dataset.f;
          if (!f) return;
          const row = e.target.closest('.item-edit');
          const it = p.items[+row.dataset.idx];
          const numeric = ['qty', 'unitPrice', 'amount', 'discount', 'packSize'].includes(f);
          it[f] = numeric ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value;
          if (f === 'packSize' || f === 'packUnit') {
            it._specFrom = '';
            row.querySelector('.spec-tag')?.remove();
          }
          if (f === 'qty' || f === 'unitPrice' || f === 'discount') {
            // 금액 = 수량 × 정가 단가 - 할인 (수량·단가가 없으면 적어 둔 금액 유지)
            const a = itemAmount(it.qty, it.unitPrice, it.discount);
            if (a != null) {
              it.amount = a;
              row.querySelector('[data-f=amount]').value = a;
            }
            const net = row.querySelector('.disc-net');
            if (net) net.textContent = `정가 ${num(itemAmount(it.qty, it.unitPrice) ?? 0)}원`;
          }
          updateSum();
        });
        itemsEl.addEventListener('change', (e) => {
          const it = p.items[+e.target.closest('.item-edit')?.dataset.idx];
          if (!it) return;
          if (e.target.dataset.f === 'category') it.category = e.target.value;
          // 품목명을 입력하면 같은 품목의 이전 용량 기록(없으면 이름의 700ML 등)으로 용량을 채움
          // (목록을 다시 그리지 않고 그 줄의 용량 칸만 바꿔서, 다음 칸으로 넘어갈 때 포커스가 끊기지 않게 함)
          if (e.target.dataset.f === 'name' && !Number(it.packSize) && fillSpec(it, specOf)) {
            const row = e.target.closest('.item-edit');
            row.querySelector('[data-f=packSize]').value = it.packSize || '';
            row.querySelector('[data-f=packUnit]').outerHTML = unitSelectHTML('data-f="packUnit"', it.packUnit || '');
            if (it._specFrom === 'history' && !row.querySelector('.spec-tag'))
              row.querySelector('[data-f=packUnit]').insertAdjacentHTML('afterend', '<em class="spec-tag">이전 기록</em>');
          }
        });
        itemsEl.addEventListener('click', (e) => {
          const row = e.target.closest('.item-edit');
          if (!row) return;
          const idx = +row.dataset.idx;
          const it = p.items[idx];
          if (e.target.closest('.del')) {
            p.items.splice(idx, 1);
            if (!p.items.length) p.items.push(blankItem());
            drawItems();
          } else if (e.target.closest('.add-disc')) {
            it._showDisc = true;
            drawItems();
            itemsEl.querySelector(`[data-idx="${idx}"] [data-f=discount]`).focus();
          } else if (e.target.closest('.rm-disc')) {
            it.amount = itemAmount(it.qty, it.unitPrice) ?? (Number(it.amount) || 0) + (Number(it.discount) || 0);
            it.discount = 0;
            it._showDisc = false;
            drawItems();
          }
        });
        body.querySelector('.add-item').addEventListener('click', () => {
          p.items.push(blankItem());
          drawItems();
          itemsEl.lastElementChild.querySelector('input').focus();
        });

        // 결제 구분: 세금계산서를 고르면 그 안쪽에 '발행 받음'이 나타남
        const paySlot = body.querySelector('.pay-slot');
        const drawPay = () => (paySlot.innerHTML = payChoiceHTML({ payType: p.payType, issued: p.taxIssued }));
        drawPay();
        paySlot.addEventListener('change', (e) => {
          const kind = e.target.dataset.pay;
          if (kind === 'tax' || kind === 'card') {
            p.payType = e.target.checked ? kind : '';
            if (p.payType !== 'tax') p.taxIssued = false;
          } else if (kind === 'issued') p.taxIssued = e.target.checked;
          drawPay();
          paySlot.querySelector(`[data-pay="${kind}"]`)?.focus();
        });

        body.querySelector('.cancel').addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          p.date = form.elements.date.value;
          p.vendor = form.elements.vendor.value.trim();
          p.memo = form.elements.memo.value;
          if (!p.date) return toast('날짜를 입력해 주세요.');
          if (!p.vendor) return toast('거래처를 입력해 주세요.');
          p.items = p.items.filter((i) => String(i.name || '').trim() || Number(i.amount));
          if (!p.items.length) return toast('품목을 하나 이상 입력해 주세요.');
          saved = store.upsert(p);
          toast('저장했습니다.');
          close();
        });
      },
    });
  });
}

function blankItem() {
  return { id: uid(), name: '', category: '기타', qty: 1, unit: '', unitPrice: '', discount: 0, amount: '', packSize: '', packUnit: '' };
}
