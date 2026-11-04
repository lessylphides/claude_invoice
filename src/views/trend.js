// 가격 추이: 같은 품목의 매입 단가 그래프·요약·이력 (거래처별로 거르기)
import { esc, normKey, num, shortDate, won } from '../lib/format.js';
import { pricePoints, priceStats } from '../lib/aggregate.js';
import { renderTrendChart } from '../ui/chart.js';
import { openSheet } from '../ui/sheet.js';
import { store } from '../store.js';
import { view, goToMonth } from '../state.js';
import { openDay } from './day.js';

/** @param {string|null} vendor 날짜 화면에서 그 거래처 품목을 눌렀으면 그 거래처 기준으로 시작 */
export function openTrend(name, vendor = null) {
  const sameVendor = (v) => normKey(v) === normKey(scope);
  let scope = 'all';
  if (vendor && pricePoints(store.index, name).some((p) => normKey(p.vendor) !== normKey(vendor))) scope = vendor;

  openSheet({
    title: `${name} 가격 추이`,
    live: true,
    render(body, close, redraw) {
      const all = pricePoints(store.index, name);
      const vendors = [...new Set(all.map((p) => p.vendor))];
      const pts = scope === 'all' ? all : all.filter((p) => sameVendor(p.vendor));
      const s = priceStats(pts);
      const dir = s.diff > 0 ? 'up' : s.diff < 0 ? 'down' : '';

      body.innerHTML = `
        ${
          vendors.length > 1
            ? `<div class="chips" role="group" aria-label="거래처 선택">
            <button class="chip" aria-pressed="${scope === 'all'}" data-scope="all">전체 거래처</button>
            ${vendors.map((v) => `<button class="chip" aria-pressed="${scope !== 'all' && sameVendor(v)}" data-scope="${esc(v)}">${esc(v)}</button>`).join('')}
          </div>`
            : ''
        }
        <div class="stats">
          <div><p>최근 단가</p><b>${s.last ? won(s.last.price) : '-'}</b>${
            s.prev ? `<small class="${dir}">${s.diff > 0 ? '▲' : s.diff < 0 ? '▼' : '−'} ${num(Math.abs(s.diff))}원 (${s.diffPct.toFixed(1)}%)</small>` : ''
          }</div>
          <div><p>평균</p><b>${won(s.avg)}</b></div>
          <div><p>최저</p><b>${s.min == null ? '-' : won(s.min)}</b></div>
          <div><p>최고</p><b>${s.max == null ? '-' : won(s.max)}</b></div>
        </div>
        <div class="chart-host"></div>
        <p class="muted small center">그래프를 누르면 날짜별 단가를 볼 수 있습니다 · 쿠폰·할인을 뺀 실제 매입 단가(수량 1당) 기준</p>
        <table class="hist">
          <caption class="sr-only">${esc(name)} 매입 이력</caption>
          <thead><tr><th scope="col">날짜</th><th scope="col">거래처</th><th scope="col">수량</th><th scope="col">단가</th><th scope="col">금액</th></tr></thead>
          <tbody>${[...pts]
            .reverse()
            .map(
              (p) => `<tr><td><button class="link" data-date="${p.date}">${shortDate(p.date)}</button></td><td>${esc(p.vendor)}</td><td>${p.qty ? num(p.qty) + esc(p.unit || '') : ''}</td><td>${num(p.price)}${
                p.discount ? `<small class="disc">정가 ${num(p.listPrice)}<br>-${num(p.discount)}</small>` : ''
              }</td><td>${num(p.amount)}</td></tr>`,
            )
            .join('')}</tbody>
        </table>`;
      renderTrendChart(body.querySelector('.chart-host'), pts);
      body.addEventListener('click', (e) => {
        const t = e.target.closest('[data-scope],[data-date]');
        if (!t) return;
        if (t.dataset.scope) {
          scope = t.dataset.scope;
          redraw();
        } else if (t.dataset.date !== view.selectedDate) {
          goToMonth(t.dataset.date);
          openDay(t.dataset.date);
        }
      });
    },
  });
}
