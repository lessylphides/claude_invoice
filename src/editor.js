// 매입 내역 입력/수정 폼 (촬영 인식 결과 검토 포함)

import { esc, num, won, todayStr, uid } from './format.js';
import { store, purchaseTotal } from './store.js';
import { openSheet, toast } from './sheet.js';
import { payChoiceHTML } from './payui.js';

/**
 * @param {object} draft 초기값 (purchase 형식, id 가 있으면 수정)
 * @param {{imageFile?:File, note?:string}} opts
 * @returns {Promise<object|null>} 저장된 purchase 또는 null(취소)
 */
export function openEditor(draft, { imageFile, note } = {}) {
  const isEdit = !!(draft.id && store.get(draft.id));
  const p = structuredClone({
    date: todayStr(), vendor: '', payType: '', taxIssued: false, memo: '', items: [], ...draft,
  });
  if (!p.items.length) p.items.push(blankItem());
  p.items.forEach((i) => (i.id ||= uid()));
  const imgUrl = imageFile ? URL.createObjectURL(imageFile) : null;

  return new Promise((resolve) => {
    let saved = null;
    openSheet({
      title: isEdit ? '매입 내역 수정' : '매입 내역 확인',
      onClose: () => {
        if (imgUrl) URL.revokeObjectURL(imgUrl);
        resolve(saved);
      },
      render(body, close) {
        const cats = store.categories;
        body.innerHTML = `
          ${note ? `<p class="notice">${esc(note)}</p>` : ''}
          ${imgUrl ? `<details class="photo"><summary>촬영한 사진 보기</summary><img src="${imgUrl}" alt="촬영한 영수증"></details>` : ''}
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
                <input data-f="amount" type="number" inputmode="numeric" placeholder="금액" value="${it.amount ?? ''}" aria-label="금액">
              </div>
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
          const numeric = ['qty', 'unitPrice', 'amount'].includes(f);
          it[f] = numeric ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value;
          if (f === 'qty' || f === 'unitPrice') {
            const a = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
            if (a) {
              it.amount = Math.round(a);
              row.querySelector('[data-f=amount]').value = it.amount;
            }
          }
          updateSum();
        });
        itemsEl.addEventListener('change', (e) => {
          if (e.target.dataset.f === 'category') p.items[+e.target.closest('.item-edit').dataset.idx].category = e.target.value;
        });
        itemsEl.addEventListener('click', (e) => {
          if (!e.target.closest('.del')) return;
          p.items.splice(+e.target.closest('.item-edit').dataset.idx, 1);
          if (!p.items.length) p.items.push(blankItem());
          drawItems();
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
  return { id: uid(), name: '', category: '기타', qty: 1, unit: '', unitPrice: '', amount: '' };
}

/** Claude 인식 결과(JSON) → purchase 초안 */
export function draftFromOcr(r, fallbackDate) {
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') ? r.date : fallbackDate;
  const items = (r.items || []).map((i) => ({
    id: uid(),
    name: i.name,
    category: i.category,
    qty: i.qty || 1,
    unit: i.unit || '',
    unitPrice: i.unitPrice || (i.qty ? Math.round(i.amount / i.qty) : i.amount),
    amount: i.amount || (i.qty || 1) * (i.unitPrice || 0),
  }));
  if (!items.length && r.total) items.push({ id: uid(), name: '합계', category: '기타', qty: 1, unit: '', unitPrice: r.total, amount: r.total });

  const notes = [];
  if (validDate !== r.date) notes.push('날짜를 읽지 못해 선택한 날짜로 넣었습니다.');
  const sum = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  if (r.total && Math.abs(sum - r.total) > 1) notes.push(`품목 합계(${num(sum)}원)와 문서 합계(${num(r.total)}원)가 다릅니다. 확인해 주세요.`);

  return {
    draft: {
      date: validDate,
      vendor: r.vendor || '',
      payType: r.paymentHint === 'card' ? 'card' : r.paymentHint === 'tax' || r.documentType === '세금계산서' ? 'tax' : '',
      taxIssued: r.documentType === '세금계산서',
      items,
    },
    note: notes.join(' '),
  };
}
