// 매입 내역 입력/수정 폼 (촬영 인식 결과 검토 포함)

import { esc, num, shortDate, won, todayStr, uid } from '../lib/format.js';
import { purchaseTotal, itemAmount } from '../lib/model.js';
import { fillSpec } from '../lib/draft.js';
import { findSimilar, isSureSame } from '../lib/itemLinks.js';
import { openSheet, toast } from '../ui/sheet.js';
import { payChoiceHTML } from '../ui/payui.js';
import { unitSelectHTML } from '../ui/units.js';
import { store } from '../store.js';
import { notifyCostImpact } from './costImpact.js';
import { findDuplicate } from '../lib/duplicate.js';

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
  const beforeIndex = store.index; // 저장 뒤 원가가 바뀐 메뉴를 찾으려고 지금 상태를 기억

  return new Promise((resolve) => {
    let saved = null;
    let suggestions = [];
    openSheet({
      title: isEdit ? '매입 내역 수정' : '매입 내역 확인',
      onClose: async () => {
        imgUrls.forEach((u) => URL.revokeObjectURL(u));
        // 저장한 새 품목 이름이 기존 품목과 비슷하면 같은 물건인지 물어봄 (다음 영수증 확인 전에)
        // 이름·용량이 확실히 같으면(서울우유 1L ↔ 1000ml) 묻지 않고 바로 묶음
        const sure = suggestions.filter((x) => x.sure);
        if (saved && sure.length) {
          sure.forEach(({ name, match }) => store.linkItems(name, match));
          toast(`같은 품목으로 묶었어요: ${sure.map((x) => `${x.name} → ${x.match}`).join(', ')} (가격 추이에서 풀 수 있어요)`, 4500);
        }
        const ask = suggestions.filter((x) => !x.sure);
        if (saved && ask.length) await askSameItems(ask, saved.vendor);
        // 이번 매입으로 메뉴 원가가 바뀌었으면 알림 (다음 영수증 확인 전에)
        if (saved) await notifyCostImpact(beforeIndex, saved);
        resolve(saved);
      },
      render(body, close) {
        const cats = store.categories;
        // 새로 넣는 매입이 이미 등록된 영수증과 같아 보이면 맨 위에 안내
        const dup = isEdit ? null : findDuplicate(store.purchases, p);
        body.innerHTML = `
          ${
            dup
              ? `<p class="notice warn-notice dup-notice">⚠ <b>이미 등록된 영수증</b>일 수 있어요: ${esc(shortDate(dup.date))} ${esc(dup.vendor)} ${num(purchaseTotal(dup))}원 (같은 날짜·거래처·합계). 같은 영수증이면 저장하지 말고 닫아 주세요.</p>`
              : ''
          }
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
          // 저장 직전에도 한 번 더 (날짜·거래처·금액을 고쳤을 수 있음)
          const twin = findDuplicate(store.purchases, p);
          if (twin && !confirm(`이미 등록된 영수증 같아요.\n${shortDate(twin.date)} ${twin.vendor} ${num(purchaseTotal(twin))}원\n\n같은 날 실제로 한 번 더 산 거라면 [확인]을 눌러 저장하세요.`)) return;
          suggestions = similarSuggestions(p.items);
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

/** 처음 보는 품목 이름 중 기존 품목과 비슷한 것: [{name, match}] (저장 전에 계산) */
function similarSuggestions(items) {
  const candidates = store.index.pickList().map((i) => i.name);
  const out = [];
  for (const it of items) {
    const name = String(it.name || '').trim();
    if (!name || store.index.history(name).length) continue; // 이미 아는 품목(또는 묶음)
    const key = store.itemKey(name);
    if (out.some((s) => store.itemKey(s.name) === key)) continue;
    const best = findSimilar(name, candidates, (c) => store.itemKey(c) === key || store.isNotSame(name, c));
    if (best) out.push({ name, match: best.name, sure: isSureSame(name, best.name) });
  }
  return out;
}

/** '같은 품목인가요?' 확인. 답한 것만 기록하고, 닫으면 끝 (나중에 가격 추이에서도 묶을 수 있음) */
function askSameItems(list, vendor) {
  return new Promise((resolve) => {
    const answered = new Map(); // name → 'same' | 'diff'
    openSheet({
      title: '같은 품목인가요?',
      onClose: () => resolve(),
      render(body, close, redraw) {
        body.innerHTML = `
          <p class="muted small">이번에 저장한 품목 중 기존 품목과 이름이 비슷한 것이 있습니다. 같은 물건이면 묶어서 가격 추이와 원가를 함께 계산합니다(원가는 가장 최근 매입가). 영수증의 원래 이름은 그대로 둡니다.</p>
          <ul class="same-ask">${list
            .map(({ name, match }, i) => {
              const last = store.index.history(match).find((r) => r.name !== name) ?? store.index.history(match)[0];
              const a = answered.get(name);
              return `<li>
                <p><b>${esc(name)}</b> <small class="muted">${esc(vendor)} · 이번 영수증</small></p>
                <p class="same-arrow">↔ <b>${esc(match)}</b> ${last ? `<small class="muted">${esc(last.vendor)} · 최근 ${num(last.price)}원 (${shortDate(last.date)})</small>` : ''}</p>
                ${
                  a
                    ? `<p class="${a === 'same' ? 'ok' : 'muted'} small">${a === 'same' ? '✔ 같은 품목으로 묶었습니다' : '다른 품목으로 기억합니다'}</p>`
                    : `<div class="same-actions"><button type="button" class="btn ghost small-btn" data-diff="${i}">다른 품목</button><button type="button" class="btn primary small-btn" data-same="${i}">같은 품목</button></div>`
                }
              </li>`;
            })
            .join('')}</ul>
          <div class="actions"><button type="button" class="btn ghost done">${answered.size === list.length ? '완료' : '나중에'}</button></div>`;
        body.addEventListener('click', (e) => {
          const same = e.target.closest('[data-same]');
          const diff = e.target.closest('[data-diff]');
          if (same || diff) {
            const { name, match } = list[+(same ?? diff).dataset[same ? 'same' : 'diff']];
            if (same) store.linkItems(name, match);
            else store.markNotSame(name, match);
            answered.set(name, same ? 'same' : 'diff');
            if (answered.size === list.length) return close();
            redraw();
          } else if (e.target.closest('.done')) close();
        });
      },
    });
  });
}
