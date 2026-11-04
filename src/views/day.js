// 날짜 상세: 그날 합계, 결제 구분별 금액, 매입처별(결제 체크)/항목별 품목, 수정·삭제
import { dateLabel, esc, num, won } from '../lib/format.js';
import { purchaseTotal } from '../lib/model.js';
import { groupByVendor, groupByCategory, paySummary } from '../lib/aggregate.js';
import { payChoiceHTML, payBreakdownHTML } from '../ui/payui.js';
import { openSheet } from '../ui/sheet.js';
import { store } from '../store.js';
import { view } from '../state.js';
import { openEditor } from './editor.js';
import { openTrend } from './trend.js';
import { openCaptureMenu } from './capture.js';

const dayPurchases = (date) => store.purchases.filter((p) => p.date === date);

export function openDay(date) {
  view.selectedDate = date;
  let mode = 'vendor';
  openSheet({
    title: dateLabel(date),
    live: true,
    onClose: () => (view.selectedDate = null),
    render(body, close, redraw) {
      const ps = dayPurchases(date);
      const total = ps.reduce((s, p) => s + purchaseTotal(p), 0);
      body.innerHTML = `
        <div class="day-total"><span>이날 매입 합계</span><strong>${won(total)}</strong></div>
        ${ps.length ? `<div class="day-pay">${payBreakdownHTML(paySummary(ps), { compact: true })}</div>` : ''}
        <div class="seg" role="tablist" aria-label="이날 매입 보기">
          <button role="tab" aria-selected="${mode === 'vendor'}" data-mode="vendor">매입처별</button>
          <button role="tab" aria-selected="${mode === 'category'}" data-mode="category">항목별</button>
        </div>
        <div class="day-list">${ps.length ? (mode === 'vendor' ? byVendor(ps) : byCategory(ps)) : '<p class="empty-msg">이날 매입 내역이 없습니다.</p>'}</div>
        <div class="actions">
          <button class="btn primary" data-day-act="add">📷 이 날짜에 매입 추가</button>
        </div>`;

      body.addEventListener('change', onPayChange);
      body.addEventListener('click', (e) => {
        const t = e.target.closest('[data-mode],[data-trend],[data-edit],[data-del],[data-day-act]');
        if (!t) return;
        if (t.dataset.mode) {
          mode = t.dataset.mode;
          redraw();
        } else if (t.dataset.trend) openTrend(t.dataset.trend, t.dataset.vendor);
        else if (t.dataset.edit) openEditor(store.get(t.dataset.edit));
        else if (t.dataset.del) {
          const p = store.get(t.dataset.del);
          if (p && confirm(`${p.vendor} ${won(purchaseTotal(p))} 내역을 삭제할까요?`)) store.remove(p.id);
        } else if (t.dataset.dayAct === 'add') openCaptureMenu(date);
      });
    },
  });
}

/** 매입처 카드의 결제 체크 → 그 거래처의 그날 영수증 모두에 적용 */
function onPayChange(e) {
  const box = e.target.closest('[data-pay]');
  if (!box) return;
  const ids = box.dataset.ids.split(',');
  const kind = box.dataset.pay;
  if (kind === 'tax' || kind === 'card') store.setPayment(ids, { payType: box.checked ? kind : '' });
  else if (kind === 'issued') store.setPayment(ids, { taxIssued: box.checked });
}

function byVendor(ps) {
  return groupByVendor(ps)
    .map((g) => {
      const ids = g.purchases.map((p) => p.id).join(',');
      const types = new Set(g.purchases.map((p) => p.payType));
      const payType = types.size === 1 ? [...types][0] : 'mixed';
      const issued = g.purchases.every((p) => p.taxIssued);
      const many = g.purchases.length > 1;
      return `
      <article class="card vendor-card">
        <header>
          <h3>${esc(g.name)}</h3>
          <strong>${won(g.total)}</strong>
        </header>
        <div class="pay-checks">${payChoiceHTML({ payType, issued, attrs: `data-ids="${ids}"` })}</div>
        <ul class="item-list">${g.items.map(({ item }) => itemLi(item, g.name)).join('')}</ul>
        <footer class="receipts">
          ${g.purchases
            .map(
              (p, i) => `<span class="receipt">${many ? `#${i + 1} ${won(purchaseTotal(p))}` : '영수증'}
                <button class="link" data-edit="${p.id}" aria-label="${esc(g.name)} 영수증${many ? ` ${i + 1}` : ''} 수정">수정</button><button class="link danger" data-del="${p.id}" aria-label="${esc(g.name)} 영수증${many ? ` ${i + 1}` : ''} 삭제">삭제</button></span>`,
            )
            .join('')}
        </footer>
      </article>`;
    })
    .join('');
}

function byCategory(ps) {
  return groupByCategory(ps)
    .map(
      (g) => `
      <article class="card">
        <header><h3>${esc(g.name)}</h3><strong>${won(g.total)}</strong></header>
        <ul class="item-list">${g.items.map(({ item, purchase }) => itemLi(item, purchase.vendor, true)).join('')}</ul>
      </article>`,
    )
    .join('');
}

function itemLi(item, vendor, showVendor = false) {
  const qty = Number(item.qty) || 0;
  const disc = Number(item.discount) || 0;
  const pack = item.packSize ? `(${num(item.packSize)}${esc(item.packUnit)})` : '';
  return `<li><button class="item-btn" data-trend="${esc(item.name)}" data-vendor="${esc(vendor)}">
    <span class="iname">${esc(item.name)}<small>${showVendor ? esc(vendor) : esc(item.category)} · ${qty ? `${num(qty)}${esc(item.unit)}${pack} × ${num(item.unitPrice)}원` : ''}</small>${
      disc ? `<span class="disc">└ 쿠폰·할인 -${num(disc)}원</span>` : ''
    }</span>
    <span class="iamt">${disc ? `<s>${num(item.amount + disc)}</s>` : ''}${won(item.amount)}<span class="chev" aria-hidden="true">📈</span></span>
  </button></li>`;
}
