// 매입 탭: 월 합계, 달력(날짜별 합계), 월 요약(거래처별·항목별·세금계산서·카드)
import { compact, dotDate, esc, num, pad, todayStr, won } from '../lib/format.js';
import { backupReminder, addDays, SNOOZE_DAYS } from '../lib/backup.js';
import { saveFile } from '../ui/download.js';
import { toast } from '../ui/sheet.js';
import { purchaseTotal } from '../lib/model.js';
import { groupByVendor, groupByCategory, paySummary, aggregateItems } from '../lib/aggregate.js';
import { payBreakdownHTML } from '../ui/payui.js';
import { store } from '../store.js';
import { view, monthKey, rerender, shiftMonth, goToday } from '../state.js';
import { openDay } from './day.js';
import { openTrend } from './trend.js';
import { openCaptureMenu } from './capture.js';

export const monthPurchases = () => {
  const k = monthKey();
  return store.purchases.filter((p) => p.date.startsWith(k));
};

export function renderPurchaseTab() {
  const mp = monthPurchases();
  const total = mp.reduce((s, p) => s + purchaseTotal(p), 0);
  const pay = paySummary(mp);

  return `
    <header class="top">
      <button class="icon-btn" data-act="prev" aria-label="이전 달">‹</button>
      <button class="month-title" data-act="today" title="이번 달로">${view.year}년 ${view.month}월</button>
      <button class="icon-btn" data-act="next" aria-label="다음 달">›</button>
      <button class="icon-btn settings" data-act="settings" aria-label="설정">⚙</button>
    </header>

    <section class="hero">
      <p class="hero-label">${view.month}월 총 매입 금액</p>
      <p class="hero-num">${won(total)}</p>
      <p class="hero-sub">${mp.length}건 · 세금계산서 미발행 <b class="${pay.taxPending ? 'warn' : ''}">${won(pay.taxPending)}</b></p>
    </section>
    ${backupBanner()}

    <section class="calendar" aria-label="${view.year}년 ${view.month}월 달력">
      <div class="dow" aria-hidden="true">${['일', '월', '화', '수', '목', '금', '토'].map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="days">${calendarCells(mp)}</div>
    </section>

    <section class="summary">
      <div class="seg" role="tablist" aria-label="월 매입 보기">
        ${[['vendor', '거래처별'], ['category', '항목별'], ['pay', '세금계산서·카드']]
          .map(([k, l]) => `<button role="tab" aria-selected="${view.summary === k}" data-summary="${k}">${l}</button>`)
          .join('')}
      </div>
      <div class="summary-body">${summaryBody(mp, total, pay)}</div>
    </section>

    <div class="fab-wrap">
      <button class="fab" data-act="capture" aria-label="영수증 촬영">📷<span>영수증 촬영</span></button>
    </div>`;
}

function backupBanner() {
  const { lastBackupAt, backupSnoozeUntil } = store.settings;
  const r = backupReminder({ count: store.purchases.length, lastBackupAt, snoozeUntil: backupSnoozeUntil, today: todayStr() });
  if (!r) return '';
  return `<section class="backup-banner" role="status">
    <p><b>데이터는 이 휴대폰에만 있어요.</b> ${r.days == null ? '아직 백업한 적이 없습니다.' : `마지막 백업 ${dotDate(lastBackupAt)} (${r.days}일 전)`}</p>
    <div class="backup-actions">
      <button class="btn ghost small-btn" data-act="backup-later">나중에</button>
      <button class="btn primary small-btn" data-act="backup-now">지금 백업</button>
    </div>
  </section>`;
}

/** 전체 백업 파일 저장 (설정 화면과 백업 알림에서 함께 사용). 저장을 취소하면 백업한 것으로 치지 않음 */
export async function backupNow() {
  const r = await saveFile(`매입장부_백업_${todayStr()}.json`, store.exportData(), 'application/json');
  if (r === 'cancelled') return toast('백업을 취소했습니다.');
  store.markBackedUp();
  toast(r === 'shared' ? '백업 파일을 저장했습니다.' : '백업 파일을 내려받았습니다. 파일 앱에 있는지 확인해 주세요.', 3500);
}

function calendarCells(mp) {
  const first = new Date(view.year, view.month - 1, 1);
  const days = new Date(view.year, view.month, 0).getDate();
  const totals = {};
  const pending = {};
  for (const p of mp) {
    totals[p.date] = (totals[p.date] || 0) + purchaseTotal(p);
    if (p.payType === 'tax' && !p.taxIssued) pending[p.date] = true;
  }
  const today = todayStr();
  let html = '<span class="cell empty" aria-hidden="true"></span>'.repeat(first.getDay());
  for (let d = 1; d <= days; d++) {
    const date = `${monthKey()}-${pad(d)}`;
    const dow = (first.getDay() + d - 1) % 7;
    const t = totals[date];
    const cls = ['cell', dow === 0 ? 'sun' : dow === 6 ? 'sat' : '', date === today ? 'today' : '', t ? 'has' : ''].filter(Boolean).join(' ');
    html += `<button class="${cls}" data-date="${date}" aria-label="${view.month}월 ${d}일${t ? ` ${num(t)}원` : ''}${pending[date] ? ', 세금계산서 미발행 있음' : ''}"${date === today ? ' aria-current="date"' : ''}>
      <span class="d">${d}${pending[date] ? '<i class="pend" aria-hidden="true"></i>' : ''}</span>
      ${t ? `<span class="amt">${compact(t)}</span>` : ''}
    </button>`;
  }
  return html;
}

function barRow(g, total, key) {
  const pct = total ? (g.total / total) * 100 : 0;
  const open = view.expanded.has(key);
  return `
    <div class="sum-row ${open ? 'open' : ''}">
      <button class="sum-head" data-expand="${esc(key)}" aria-expanded="${open}">
        <span class="name">${esc(g.name)}</span>
        <span class="val">${won(g.total)} <small>${pct.toFixed(1)}%</small></span>
        <span class="bar" aria-hidden="true"><i style="width:${pct}%"></i></span>
      </button>
      ${open ? `<ul class="item-list">${aggregateItems(g.items, store.index.key).map(itemAggLi).join('')}</ul>` : ''}
    </div>`;
}

function itemAggLi(a) {
  return `<li><button class="item-btn" data-trend="${esc(a.name)}">
    <span class="iname">${esc(a.name)}<small>${a.qty ? ` ${num(a.qty)}${esc(a.unit || '')}` : ''} · ${[...a.vendors].map(esc).join(', ')}</small>${
      a.discount ? `<span class="disc">└ 할인 -${num(a.discount)}원</span>` : ''
    }</span>
    <span class="iamt">${won(a.amount)}<span class="chev" aria-hidden="true">📈</span></span>
  </button></li>`;
}

function summaryBody(mp, total, pay) {
  if (!mp.length) return `<p class="empty-msg">이번 달 매입 내역이 없습니다.<br>아래 <b>영수증 촬영</b> 버튼으로 시작하세요.</p>`;
  if (view.summary === 'vendor') return groupByVendor(mp).map((g) => barRow(g, total, `v:${g.key}`)).join('');
  if (view.summary === 'category') return groupByCategory(mp).map((g) => barRow(g, total, `c:${g.key}`)).join('');
  return payPanel(pay, total);
}

function payPanel(pay, total) {
  const pv = [...pay.pendingVendors.values()].sort((a, b) => b.total - a.total);
  return `
    ${payBreakdownHTML(pay, { total })}
    ${
      pv.length
        ? `<h3 class="sub">세금계산서 미발행 거래처</h3>
           <ul class="pending-list">${pv
             .map(
               (v) => `<li><span>${esc(v.name)}<small>${[...v.dates]
                 .sort()
                 .map((d) => `<button class="link" data-date="${d}">${+d.slice(8)}일</button>`)
                 .join(' ')}</small></span><b>${won(v.total)}</b></li>`,
             )
             .join('')}</ul>`
        : pay.tax
          ? '<p class="muted center">모든 세금계산서를 발행 받았습니다.</p>'
          : ''
    }`;
}

/** 매입 탭 클릭 처리. 처리했으면 true */
export function handlePurchaseClick(e, { openSettings }) {
  const t = e.target.closest('[data-act],[data-date],[data-summary],[data-expand],[data-trend]');
  if (!t) return false;
  if (t.dataset.date) openDay(t.dataset.date);
  else if (t.dataset.summary) {
    view.summary = t.dataset.summary;
    rerender();
  } else if (t.dataset.expand) {
    const k = t.dataset.expand;
    view.expanded.has(k) ? view.expanded.delete(k) : view.expanded.add(k);
    rerender();
  } else if (t.dataset.trend) openTrend(t.dataset.trend);
  else if (t.dataset.act === 'prev') shiftMonth(-1);
  else if (t.dataset.act === 'next') shiftMonth(1);
  else if (t.dataset.act === 'today') goToday();
  else if (t.dataset.act === 'settings') openSettings();
  else if (t.dataset.act === 'capture') openCaptureMenu();
  else if (t.dataset.act === 'backup-now') backupNow();
  else if (t.dataset.act === 'backup-later') store.snoozeBackup(addDays(todayStr(), SNOOZE_DAYS));
  else return false;
  return true;
}
