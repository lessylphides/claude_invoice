// 가격 추이: 같은 품목의 매입 단가 그래프·요약·이력 (거래처별로 거르기)
import { esc, normKey, num, shortDate, won } from '../lib/format.js';
import { pricePoints, priceStats, normalizePoints } from '../lib/aggregate.js';
import { renderTrendChart } from '../ui/chart.js';
import { openSheet, toast } from '../ui/sheet.js';
import { store } from '../store.js';
import { view, goToMonth } from '../state.js';
import { openDay } from './day.js';
import { pickItem } from './itemPicker.js';

/** 1000ml → 1L, 12000ml → 12L, 500g → 500g */
const packLabel = ({ packSize, packUnit }) =>
  packUnit === 'ml' && packSize >= 1000 ? `${num(packSize / 1000)}L` : packUnit === 'g' && packSize >= 1000 ? `${num(packSize / 1000)}kg` : `${num(packSize)}${packUnit}`;

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
      const raw = scope === 'all' ? all : all.filter((p) => sameVendor(p.vendor));
      // 병·박스처럼 용량이 다른 매입이 섞이면 최근 용량 기준으로 단가를 맞춰 비교
      const { points: pts, base } = normalizePoints(raw);
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
        ${base ? `<p class="notice small">용량이 다른 매입(낱개·박스)이 섞여 있어 <b>${packLabel(base)}</b> 기준으로 단가를 환산해 비교했어요.</p>` : ''}
        ${sameItemSection(name)}
        <table class="hist">
          <caption class="sr-only">${esc(name)} 매입 이력</caption>
          <thead><tr><th scope="col">날짜</th><th scope="col">거래처</th><th scope="col">수량</th><th scope="col">단가</th><th scope="col">금액</th></tr></thead>
          <tbody>${[...pts]
            .reverse()
            .map(
              (p) => `<tr><td><button class="link" data-date="${p.date}">${shortDate(p.date)}</button></td><td>${esc(p.vendor)}</td><td>${p.qty ? num(p.qty) + esc(p.unit || '') : ''}</td><td>${num(p.price)}${
                p.origPrice != null ? `<small class="disc">${packLabel(p)} ${num(p.origPrice)}원에서 환산</small>` : ''
              }${p.discount ? `<small class="disc">정가 ${num(p.listPrice)}<br>-${num(p.discount)}</small>` : ''}</td><td>${num(p.amount)}</td></tr>`,
            )
            .join('')}</tbody>
        </table>`;
      renderTrendChart(body.querySelector('.chart-host'), pts);
      body.addEventListener('click', async (e) => {
        const t = e.target.closest('[data-scope],[data-date],[data-link],[data-unlink]');
        if (!t) return;
        if (t.dataset.link !== undefined) {
          const key = store.itemKey(name);
          const other = await pickItem({
            title: '같은 품목으로 묶을 이름',
            hint: `거래처마다 이름이 다르게 적힌 같은 물건을 고르세요. 묶으면 가격 추이와 원가에서 '${esc(name)}'과 하나로 계산합니다(원가는 가장 최근 매입가). 영수증의 원래 이름은 그대로 둡니다.`,
            exclude: (n) => store.itemKey(n) === key,
          });
          if (other && store.linkItems(other, name)) toast(`'${other}'을(를) 같은 품목으로 묶었습니다.`);
        } else if (t.dataset.unlink) {
          if (store.unlinkItem(t.dataset.unlink)) toast(`'${t.dataset.unlink}'을(를) 묶음에서 뺐습니다.`);
        } else if (t.dataset.scope) {
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

/** 같은 품목으로 묶인 이름들: 대표 이름 + 연결 해제, 다른 이름 연결 */
function sameItemSection(name) {
  const names = store.index.names(name);
  const linked = names.filter((n) => store.isLinkedAlias(n));
  return `<section class="same-item">
    <h3 class="sub">같은 품목 ${linked.length ? `<small>${names.length}개 이름</small>` : ''}</h3>
    ${
      linked.length
        ? `<ul class="same-list">${names
            .map(
              (n) => `<li><span>${esc(n)}</span>${
                store.isLinkedAlias(n)
                  ? `<button type="button" class="link danger" data-unlink="${esc(n)}" aria-label="${esc(n)} 묶음에서 빼기">연결 해제</button>`
                  : '<em class="muted small">대표 이름</em>'
              }</li>`,
            )
            .join('')}</ul>`
        : '<p class="muted small">거래처마다 이름이 조금 다른 같은 물건이 있으면 묶어서 함께 볼 수 있습니다.</p>'
    }
    <button type="button" class="btn ghost small-btn" data-link>+ 같은 품목 연결</button>
  </section>`;
}
