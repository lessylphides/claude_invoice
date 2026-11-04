import './style.css';
import { compact, dateLabel, esc, normKey, num, pad, shortDate, todayStr, won } from './format.js';
import { store, purchaseTotal, MODELS } from './store.js';
import { openSheet, showBusy, toast } from './sheet.js';
import { openEditor, draftFromOcr } from './editor.js';
import { extractReceipt } from './ocr.js';
import { renderTrendChart } from './chart.js';
import { payChoiceHTML, payBreakdownHTML } from './payui.js';

const app = document.getElementById('app');
const now = new Date();
const view = {
  year: now.getFullYear(),
  month: now.getMonth() + 1, // 1-12
  summary: 'vendor', // vendor | category | pay
  expanded: new Set(),
  selectedDate: null,
};

const PAY_LABEL = { tax: '세금계산서', card: '카드', '': '미지정' };

// ───────────────────────── 집계 ─────────────────────────

const monthKey = () => `${view.year}-${pad(view.month)}`;
const monthPurchases = () => store.purchases.filter((p) => p.date.startsWith(monthKey()));
const dayPurchases = (date) => store.purchases.filter((p) => p.date === date);

/** 거래처별 묶음: [{key, name, total, purchases, items:[{item, purchase}]}] */
function groupByVendor(purchases) {
  const map = new Map();
  for (const p of purchases) {
    const k = normKey(p.vendor);
    if (!map.has(k)) map.set(k, { key: k, name: p.vendor, total: 0, purchases: [], items: [] });
    const g = map.get(k);
    g.purchases.push(p);
    g.total += purchaseTotal(p);
    p.items.forEach((item) => g.items.push({ item, purchase: p }));
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

/** 항목(분류)별 묶음 */
function groupByCategory(purchases) {
  const map = new Map();
  for (const p of purchases)
    for (const item of p.items) {
      const k = item.category || '기타';
      if (!map.has(k)) map.set(k, { key: k, name: k, total: 0, items: [] });
      const g = map.get(k);
      g.total += Number(item.amount) || 0;
      g.items.push({ item, purchase: p });
    }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function paySummary(purchases) {
  const s = { tax: 0, taxIssued: 0, taxPending: 0, card: 0, none: 0, pendingVendors: new Map() };
  for (const p of purchases) {
    const t = purchaseTotal(p);
    if (p.payType === 'tax') {
      s.tax += t;
      if (p.taxIssued) s.taxIssued += t;
      else {
        s.taxPending += t;
        const k = normKey(p.vendor);
        const v = s.pendingVendors.get(k) || { name: p.vendor, total: 0, dates: new Set() };
        v.total += t;
        v.dates.add(p.date);
        s.pendingVendors.set(k, v);
      }
    } else if (p.payType === 'card') s.card += t;
    else s.none += t;
  }
  return s;
}

/** 같은 품목 묶음(이름 기준)으로 수량·금액 합산 */
function aggregateItems(entries) {
  const map = new Map();
  for (const { item, purchase } of entries) {
    const k = normKey(item.name);
    const a = map.get(k) || { name: item.name, qty: 0, unit: item.unit, amount: 0, vendors: new Set(), count: 0 };
    a.qty += Number(item.qty) || 0;
    a.amount += Number(item.amount) || 0;
    a.vendors.add(purchase.vendor);
    a.count++;
    map.set(k, a);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

// ───────────────────────── 메인 화면 ─────────────────────────

function render() {
  const mp = monthPurchases();
  const total = mp.reduce((s, p) => s + purchaseTotal(p), 0);
  const pay = paySummary(mp);

  app.innerHTML = `
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

    <section class="calendar" aria-label="${view.year}년 ${view.month}월 달력">
      <div class="dow">${['일', '월', '화', '수', '목', '금', '토'].map((d) => `<span>${d}</span>`).join('')}</div>
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
    </div>
  `;
}

function calendarCells(mp) {
  const first = new Date(view.year, view.month - 1, 1);
  const days = new Date(view.year, view.month, 0).getDate();
  const totals = {}, pending = {};
  for (const p of mp) {
    totals[p.date] = (totals[p.date] || 0) + purchaseTotal(p);
    if (p.payType === 'tax' && !p.taxIssued) pending[p.date] = true;
  }
  const today = todayStr();
  let html = '<span class="cell empty"></span>'.repeat(first.getDay());
  for (let d = 1; d <= days; d++) {
    const date = `${monthKey()}-${pad(d)}`;
    const dow = (first.getDay() + d - 1) % 7;
    const t = totals[date];
    html += `<button class="cell ${dow === 0 ? 'sun' : dow === 6 ? 'sat' : ''} ${date === today ? 'today' : ''} ${t ? 'has' : ''}"
        data-date="${date}" aria-label="${view.month}월 ${d}일${t ? ` ${num(t)}원` : ''}${pending[date] ? ', 세금계산서 미발행 있음' : ''}">
      <span class="d">${d}${pending[date] ? '<i class="pend" aria-hidden="true"></i>' : ''}</span>
      ${t ? `<span class="amt">${compact(t)}</span>` : ''}
    </button>`;
  }
  return html;
}

function barRow(g, total, key, expandable = true) {
  const pct = total ? (g.total / total) * 100 : 0;
  const open = view.expanded.has(key);
  return `
    <div class="sum-row ${open ? 'open' : ''}">
      <button class="sum-head" data-expand="${esc(key)}" aria-expanded="${open}" ${expandable ? '' : 'disabled'}>
        <span class="name">${esc(g.name)}</span>
        <span class="val">${won(g.total)} <small>${pct.toFixed(1)}%</small></span>
        <span class="bar"><i style="width:${pct}%"></i></span>
      </button>
      ${open && g.items ? `<ul class="item-list">${aggregateItems(g.items).map(itemAggLi).join('')}</ul>` : ''}
    </div>`;
}

function itemAggLi(a) {
  return `<li><button class="item-btn" data-trend="${esc(a.name)}">
    <span class="iname">${esc(a.name)}<small>${a.qty ? ` ${num(a.qty)}${esc(a.unit || '')}` : ''} · ${[...a.vendors].map(esc).join(', ')}</small></span>
    <span class="iamt">${won(a.amount)}<span class="chev">📈</span></span>
  </button></li>`;
}

function summaryBody(mp, total, pay) {
  if (!mp.length) return `<p class="empty-msg">이번 달 매입 내역이 없습니다.<br>아래 <b>영수증 촬영</b> 버튼으로 시작하세요.</p>`;
  if (view.summary === 'vendor') return groupByVendor(mp).map((g) => barRow(g, total, 'v:' + g.key)).join('');
  if (view.summary === 'category') return groupByCategory(mp).map((g) => barRow(g, total, 'c:' + g.key)).join('');
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
               (v) => `<li><span>${esc(v.name)}<small>${[...v.dates].sort().map((d) => `<button class="link" data-date="${d}">${+d.slice(8)}일</button>`).join(' ')}</small></span><b>${won(v.total)}</b></li>`,
             )
             .join('')}</ul>`
        : pay.tax
          ? '<p class="muted center">모든 세금계산서를 발행 받았습니다.</p>'
          : ''
    }`;
}

// ───────────────────────── 날짜 상세 ─────────────────────────

function openDay(date) {
  view.selectedDate = date;
  let mode = 'vendor';
  openSheet({
    title: dateLabel(date),
    live: true,
    onClose: () => (view.selectedDate = null),
    render(body, close, redraw) {
      const ps = dayPurchases(date);
      const total = ps.reduce((s, p) => s + purchaseTotal(p), 0);
      const pay = paySummary(ps);
      body.innerHTML = `
        <div class="day-total"><span>이날 매입 합계</span><strong>${won(total)}</strong></div>
        ${ps.length ? `<div class="day-pay">${payBreakdownHTML(pay, { compact: true })}</div>` : ''}
        <div class="seg" role="tablist">
          <button role="tab" aria-selected="${mode === 'vendor'}" data-mode="vendor">매입처별</button>
          <button role="tab" aria-selected="${mode === 'category'}" data-mode="category">항목별</button>
        </div>
        <div class="day-list">${ps.length ? (mode === 'vendor' ? dayByVendor(ps) : dayByCategory(ps)) : '<p class="empty-msg">이날 매입 내역이 없습니다.</p>'}</div>
        <div class="actions">
          <button class="btn ghost" data-day-act="manual">+ 직접 입력</button>
          <button class="btn primary" data-day-act="capture">📷 영수증 촬영</button>
        </div>`;

      body.querySelectorAll('[data-mode]').forEach((b) =>
        b.addEventListener('click', () => {
          mode = b.dataset.mode;
          redraw();
        }),
      );
      body.addEventListener('change', onPayChange);
      body.addEventListener('click', (e) => {
        const t = e.target.closest('[data-trend],[data-edit],[data-del],[data-day-act]');
        if (!t) return;
        if (t.dataset.trend) openTrend(t.dataset.trend, t.dataset.vendor);
        else if (t.dataset.edit) openEditor(store.get(t.dataset.edit));
        else if (t.dataset.del) {
          const p = store.get(t.dataset.del);
          if (p && confirm(`${p.vendor} ${won(purchaseTotal(p))} 내역을 삭제할까요?`)) store.remove(p.id);
        } else if (t.dataset.dayAct === 'manual') openEditor({ date });
        else if (t.dataset.dayAct === 'capture') startCapture('camera', date);
      });
    },
  });
}

function onPayChange(e) {
  const box = e.target.closest('[data-pay]');
  if (!box) return;
  const ids = box.dataset.ids.split(',');
  const kind = box.dataset.pay;
  if (kind === 'tax') store.setPayment(ids, { payType: box.checked ? 'tax' : '' });
  else if (kind === 'card') store.setPayment(ids, { payType: box.checked ? 'card' : '' });
  else if (kind === 'issued') store.setPayment(ids, { taxIssued: box.checked });
}

function dayByVendor(ps) {
  return groupByVendor(ps)
    .map((g) => {
      const ids = g.purchases.map((p) => p.id).join(',');
      const types = new Set(g.purchases.map((p) => p.payType));
      const payType = types.size === 1 ? [...types][0] : 'mixed';
      const issued = g.purchases.every((p) => p.taxIssued);
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
              (p, i) => `<span class="receipt">${g.purchases.length > 1 ? `#${i + 1} ${won(purchaseTotal(p))}` : '영수증'}
                <button class="link" data-edit="${p.id}">수정</button><button class="link danger" data-del="${p.id}">삭제</button></span>`,
            )
            .join('')}
        </footer>
      </article>`;
    })
    .join('');
}

function dayByCategory(ps) {
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
  return `<li><button class="item-btn" data-trend="${esc(item.name)}" data-vendor="${esc(vendor)}">
    <span class="iname">${esc(item.name)}<small>${showVendor ? `${esc(vendor)} · ` : `${esc(item.category)} · `}${qty ? `${num(qty)}${esc(item.unit)} × ${num(item.unitPrice)}원` : ''}</small></span>
    <span class="iamt">${won(item.amount)}<span class="chev">📈</span></span>
  </button></li>`;
}

// ───────────────────────── 가격 추이 ─────────────────────────

function priceHistory(name) {
  const k = normKey(name);
  const pts = [];
  for (const p of store.purchases)
    for (const i of p.items) {
      if (normKey(i.name) !== k) continue;
      const qty = Number(i.qty) || 0;
      const price = Number(i.unitPrice) || (qty ? Math.round(i.amount / qty) : Number(i.amount) || 0);
      pts.push({ date: p.date, price, vendor: p.vendor, qty, unit: i.unit, amount: Number(i.amount) || 0 });
    }
  return pts.sort((a, b) => a.date.localeCompare(b.date));
}

function openTrend(name, vendor = null) {
  // 날짜 화면에서 거래처 품목을 눌렀으면 그 거래처 기준으로 먼저 보여줌 (칩으로 전체 비교 가능)
  let scope = vendor && priceHistory(name).some((p) => normKey(p.vendor) !== normKey(vendor)) ? vendor : 'all';
  openSheet({
    title: `${name} 가격 추이`,
    live: true,
    render(body, close, redraw) {
      const all = priceHistory(name);
      const vendors = [...new Set(all.map((p) => p.vendor))];
      const pts = scope === 'all' ? all : all.filter((p) => normKey(p.vendor) === normKey(scope));
      const isSel = (v) => scope !== 'all' && normKey(v) === normKey(scope);
      const prices = pts.map((p) => p.price);
      const last = pts.at(-1), prev = pts.at(-2);
      const diff = last && prev ? last.price - prev.price : 0;
      const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;

      body.innerHTML = `
        ${
          vendors.length > 1
            ? `<div class="chips">
            <button class="chip" aria-pressed="${scope === 'all'}" data-scope="all">전체 거래처</button>
            ${vendors.map((v) => `<button class="chip" aria-pressed="${isSel(v)}" data-scope="${esc(v)}">${esc(v)}</button>`).join('')}
          </div>`
            : ''
        }
        <div class="stats">
          <div><p>최근 단가</p><b>${last ? won(last.price) : '-'}</b>${
            prev ? `<small class="${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${diff > 0 ? '▲' : diff < 0 ? '▼' : '−'} ${num(Math.abs(diff))}원 (${prev.price ? ((diff / prev.price) * 100).toFixed(1) : 0}%)</small>` : ''
          }</div>
          <div><p>평균</p><b>${won(avg)}</b></div>
          <div><p>최저</p><b>${prices.length ? won(Math.min(...prices)) : '-'}</b></div>
          <div><p>최고</p><b>${prices.length ? won(Math.max(...prices)) : '-'}</b></div>
        </div>
        <div class="chart-host"></div>
        <p class="muted small center">그래프를 누르면 날짜별 단가를 볼 수 있습니다 · 단가 기준(수량 1당)</p>
        <table class="hist">
          <thead><tr><th>날짜</th><th>거래처</th><th>수량</th><th>단가</th><th>금액</th></tr></thead>
          <tbody>${[...pts]
            .reverse()
            .map(
              (p) => `<tr><td><button class="link" data-date="${p.date}">${shortDate(p.date)}</button></td><td>${esc(p.vendor)}</td><td>${p.qty ? num(p.qty) + esc(p.unit || '') : ''}</td><td>${num(p.price)}</td><td>${num(p.amount)}</td></tr>`,
            )
            .join('')}</tbody>
        </table>`;
      renderTrendChart(body.querySelector('.chart-host'), pts);
      body.querySelectorAll('[data-scope]').forEach((b) =>
        b.addEventListener('click', () => {
          scope = b.dataset.scope;
          redraw();
        }),
      );
      body.querySelectorAll('.hist [data-date]').forEach((b) =>
        b.addEventListener('click', () => {
          const d = b.dataset.date;
          if (d !== view.selectedDate) {
            goToMonth(d);
            openDay(d);
          }
        }),
      );
    },
  });
}

// ───────────────────────── 촬영 → 인식 → 검토 ─────────────────────────

let captureDate = null;

function startCapture(source, date = null) {
  captureDate = date;
  const input = document.getElementById(source === 'camera' ? 'cam' : 'gallery');
  input.value = '';
  input.click();
}

async function handleFiles(files) {
  if (!files.length) return;
  const { apiKey, model } = store.settings;
  const fallbackDate = captureDate || view.selectedDate || todayStr();

  if (!apiKey) {
    toast('API 키가 없어 자동 인식 없이 직접 입력합니다. (설정에서 키 입력)', 3500);
    for (const f of files) await openEditor({ date: fallbackDate }, { imageFile: f });
    return;
  }

  const busy = showBusy(`영수증 인식 중… (0/${files.length})`);
  let done = 0;
  const results = await Promise.allSettled(
    files.map((f) =>
      extractReceipt(f, { apiKey, model, categories: store.categories, knownVendors: store.vendorNames() }).finally(() =>
        busy.update(`영수증 인식 중… (${++done}/${files.length})`),
      ),
    ),
  );
  busy.done();

  let lastSaved = null;
  for (let i = 0; i < files.length; i++) {
    const r = results[i];
    let saved;
    if (r.status === 'fulfilled') {
      const { draft, note } = draftFromOcr(r.value, fallbackDate);
      saved = await openEditor(draft, { imageFile: files[i], note });
    } else {
      saved = await openEditor({ date: fallbackDate }, { imageFile: files[i], note: `자동 인식 실패: ${r.reason?.message || r.reason}` });
    }
    if (saved) lastSaved = saved;
  }
  if (lastSaved && !view.selectedDate) goToMonth(lastSaved.date);
}

function goToMonth(date) {
  const [y, m] = date.split('-').map(Number);
  if (y !== view.year || m !== view.month) {
    view.year = y;
    view.month = m;
    render();
  }
}

function openCaptureMenu() {
  openSheet({
    title: '매입 내역 추가',
    render(body, close) {
      body.innerHTML = `
        <div class="menu">
          <button class="menu-btn" data-src="camera"><span>📷</span>카메라로 촬영<small>영수증·거래명세서를 바로 찍기</small></button>
          <button class="menu-btn" data-src="gallery"><span>🖼</span>앨범에서 선택<small>여러 장을 한 번에 인식</small></button>
          <button class="menu-btn" data-src="manual"><span>✍️</span>직접 입력</button>
        </div>
        ${store.settings.apiKey ? '' : '<p class="notice">자동 인식을 쓰려면 ⚙ 설정에서 Claude API 키를 입력하세요.</p>'}`;
      body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-src]');
        if (!b) return;
        close();
        if (b.dataset.src === 'manual') openEditor({ date: todayStr() });
        else startCapture(b.dataset.src);
      });
    },
  });
}

// ───────────────────────── 설정 ─────────────────────────

function openSettings() {
  openSheet({
    title: '설정',
    render(body, close) {
      const s = store.settings;
      body.innerHTML = `
        <form class="settings">
          <h3 class="sub">영수증 자동 인식 (Claude API)</h3>
          <label>API 키<input name="apiKey" type="password" autocomplete="off" placeholder="sk-ant-..." value="${esc(s.apiKey)}"></label>
          <p class="muted small">키는 이 기기의 브라우저에만 저장되고 Anthropic API 로만 전송됩니다. 키는 console.anthropic.com 에서 발급받을 수 있습니다.</p>
          <label>인식 모델<select name="model">${MODELS.map((m) => `<option value="${m.id}" ${m.id === s.model ? 'selected' : ''}>${m.label}</option>`).join('')}</select></label>

          <h3 class="sub">항목(분류) 목록</h3>
          <textarea name="cats" rows="6" aria-label="분류 목록, 한 줄에 하나">${esc(store.categories.join('\n'))}</textarea>
          <p class="muted small">한 줄에 하나씩. 촬영 시 품목이 이 분류 중 하나로 자동 분류됩니다.</p>
          <div class="actions"><button class="btn primary" type="submit">저장</button></div>

          <h3 class="sub">데이터</h3>
          <div class="btn-col">
            <button class="btn ghost" type="button" data-act="csv">이번 달 CSV 내보내기 (엑셀)</button>
            <button class="btn ghost" type="button" data-act="backup">전체 백업 파일 저장</button>
            <button class="btn ghost" type="button" data-act="restore">백업 파일 불러오기</button>
          </div>
          <input type="file" accept="application/json,.json" hidden class="restore-file">
          <p class="muted small">데이터는 이 기기에만 저장됩니다. 기기를 바꾸거나 브라우저 데이터를 지우기 전에 백업하세요.</p>
        </form>`;
      const form = body.querySelector('form');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        store.saveSettings({ apiKey: form.elements.apiKey.value.trim(), model: form.elements.model.value });
        store.setCategories(form.elements.cats.value.split('\n'));
        toast('설정을 저장했습니다.');
        close();
      });
      body.querySelector('[data-act=csv]').addEventListener('click', exportCsv);
      body.querySelector('[data-act=backup]').addEventListener('click', () =>
        download(`매입장부_백업_${todayStr()}.json`, store.exportData(), 'application/json'),
      );
      const rf = body.querySelector('.restore-file');
      body.querySelector('[data-act=restore]').addEventListener('click', () => rf.click());
      rf.addEventListener('change', async () => {
        const f = rf.files[0];
        if (!f || !confirm('현재 데이터를 백업 파일 내용으로 바꿉니다. 계속할까요?')) return;
        try {
          store.importData(await f.text());
          toast('불러왔습니다.');
          close();
        } catch (err) {
          alert(`불러오기 실패: ${err.message}`);
        }
      });
    },
  });
}

function exportCsv() {
  const rows = [['날짜', '거래처', '결제구분', '세금계산서발행', '품목', '분류', '수량', '단위', '단가', '금액']];
  for (const p of [...monthPurchases()].sort((a, b) => a.date.localeCompare(b.date)))
    for (const i of p.items)
      rows.push([p.date, p.vendor, PAY_LABEL[p.payType], p.payType === 'tax' ? (p.taxIssued ? '발행' : '미발행') : '', i.name, i.category, i.qty, i.unit, i.unitPrice, i.amount]);
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  download(`매입_${monthKey()}.csv`, '﻿' + csv, 'text/csv');
}

function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ───────────────────────── 이벤트 ─────────────────────────

app.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act],[data-date],[data-summary],[data-expand],[data-trend]');
  if (!t) return;
  if (t.dataset.date) return openDay(t.dataset.date);
  if (t.dataset.summary) {
    view.summary = t.dataset.summary;
    return render();
  }
  if (t.dataset.expand) {
    const k = t.dataset.expand;
    view.expanded.has(k) ? view.expanded.delete(k) : view.expanded.add(k);
    return render();
  }
  if (t.dataset.trend) return openTrend(t.dataset.trend);
  switch (t.dataset.act) {
    case 'prev':
      view.month === 1 ? ((view.month = 12), view.year--) : view.month--;
      return render();
    case 'next':
      view.month === 12 ? ((view.month = 1), view.year++) : view.month++;
      return render();
    case 'today':
      view.year = now.getFullYear();
      view.month = now.getMonth() + 1;
      return render();
    case 'settings':
      return openSettings();
    case 'capture':
      return openCaptureMenu();
  }
});

document.getElementById('cam').addEventListener('change', (e) => handleFiles([...e.target.files]));
document.getElementById('gallery').addEventListener('change', (e) => handleFiles([...e.target.files]));

// 좌우 스와이프로 달 이동
let touchX = null;
app.addEventListener('touchstart', (e) => e.target.closest('.calendar') && (touchX = e.touches[0].clientX), { passive: true });
app.addEventListener('touchend', (e) => {
  if (touchX == null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) < 60) return;
  app.querySelector(`[data-act=${dx < 0 ? 'next' : 'prev'}]`).click();
});

store.subscribe(render);
render();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
