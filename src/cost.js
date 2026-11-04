// 원가 탭: 메뉴별 1잔(1조각) 원가와 원가율
// 매입 내역의 '가장 최근 매입 단가(할인 반영)'로 자동 계산하므로, 새 영수증이 들어오면 원가율도 바로 바뀝니다.

import { esc, normKey, num, shortDate, uid, won } from './format.js';
import { store, netUnitPrice } from './store.js';
import { openSheet, toast } from './sheet.js';

let hooks = { openTrend: () => {} };
export function initCost(h) {
  hooks = { ...hooks, ...h };
}

const UNITS = ['ml', 'g', '개', '조각', '잔', '병', '캔', '봉'];

// ───────────────────────── 계산 ─────────────────────────

/** 품목 이름으로 매입 기록 찾기 (최근 순) */
function itemPurchases(itemName) {
  const k = normKey(itemName);
  const rows = [];
  for (const p of store.purchases)
    for (const i of p.items)
      if (normKey(i.name) === k) rows.push({ date: p.date, createdAt: p.createdAt, vendor: p.vendor, unitPrice: netUnitPrice(i), discount: Number(i.discount) || 0 });
  return rows.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

/** 재료 1개의 1잔당 원가. cost=null 이면 계산 불가(사유 reason) */
function ingredientCost(g) {
  if (g.type === 'manual') return { cost: Number(g.cost) || 0, prevCost: Number(g.cost) || 0, source: null };
  const hist = itemPurchases(g.itemName);
  if (!hist.length) return { cost: null, reason: '매입 기록 없음' };
  if (!g.packSize || !g.use) return { cost: null, reason: '용량·사용량 미입력', source: hist[0] };
  const per = (price) => (price * g.use) / g.packSize;
  return { cost: per(hist[0].unitPrice), prevCost: per((hist[1] || hist[0]).unitPrice), source: hist[0], prev: hist[1] };
}

export function menuCost(m) {
  let cost = 0, prevCost = 0, missing = 0;
  const parts = m.ingredients.map((g) => {
    const r = ingredientCost(g);
    if (r.cost == null) missing++;
    else {
      cost += r.cost;
      prevCost += r.prevCost;
    }
    return { g, ...r };
  });
  const rate = m.price ? (cost / m.price) * 100 : null;
  return { cost, prevCost, delta: cost - prevCost, rate, missing, parts };
}

/** 품목 이름에서 용량 추정: '몽키숄더700ML' → 700 ml, '휘핑크림 2L' → 2000 ml, '블루베리510G' → 510 g */
function guessPack(name) {
  const all = [...String(name).matchAll(/(\d+(?:\.\d+)?)\s*(ml|l|kg|g)(?![a-z])/gi)];
  if (!all.length) return null;
  const [, n, u] = all.at(-1);
  const v = Number(n), unit = u.toLowerCase();
  if (unit === 'l') return { packSize: v * 1000, unit: 'ml' };
  if (unit === 'kg') return { packSize: v * 1000, unit: 'g' };
  return { packSize: v, unit };
}

const pct = (v) => (v == null ? '-' : `${(Math.round(v * 10) / 10).toFixed(1)}%`);
const dot = (d) => d.replaceAll('-', '.');

// ───────────────────────── 원가 탭 화면 ─────────────────────────

export function renderCostTab() {
  const target = store.costTarget;
  const rows = store.menus.map((m) => ({ m, c: menuCost(m) }));
  rows.sort((a, b) => (b.c.rate ?? -1) - (a.c.rate ?? -1));
  const over = rows.filter((r) => r.c.rate != null && r.c.rate > target.value).length;
  const valid = rows.filter((r) => r.c.rate != null);
  const avg = valid.length ? valid.reduce((s, r) => s + r.c.rate, 0) / valid.length : null;
  const scale = Math.max(50, target.value * 2);

  return `
    <header class="top">
      <h1 class="month-title static">원가율</h1>
      <button class="icon-btn settings" data-act="settings" aria-label="설정">⚙</button>
    </header>

    <section class="hero target-card">
      <div>
        <p class="hero-label">목표 원가율</p>
        <p class="hero-num">${pct(target.value).replace('.0%', '%')}</p>
        <p class="hero-sub">${dot(target.at)} ${target.note === '기본값' ? '기본값으로 설정' : '변경'}</p>
      </div>
      <button class="btn ghost" data-cost="target">변경</button>
    </section>

    ${
      rows.length
        ? `<p class="cost-summary">메뉴 ${rows.length}개 · ${over ? `<b class="warn">⚠ 목표 초과 ${over}개</b>` : '<b class="ok">모두 목표 이내</b>'} · 평균 ${pct(avg)}</p>
           <section class="menu-list">${rows.map(({ m, c }) => menuCard(m, c, target.value, scale)).join('')}</section>`
        : `<section class="summary"><p class="empty-msg">파는 메뉴를 등록하면<br>최근 매입가로 <b>한 잔(조각) 원가</b>와 <b>원가율</b>을 자동 계산합니다.<br><br>
             <span class="muted small">예) 몽키숄더 한 잔: 700ml 한 병 중 30ml 사용<br>바스크 치즈케이크: 1개를 7조각으로</span></p></section>`
    }

    <div class="fab-wrap">
      <button class="fab" data-cost="add">＋<span>메뉴 추가</span></button>
    </div>`;
}

function menuCard(m, c, target, scale) {
  const overT = c.rate != null && c.rate > target;
  const w = c.rate == null ? 0 : Math.min(100, (c.rate / scale) * 100);
  const delta = Math.round(c.delta);
  return `
    <button class="menu-card ${overT ? 'over' : ''}" data-cost-open="${m.id}">
      <span class="mc-top">
        <span class="mc-name">${overT ? '⚠ ' : ''}${esc(m.name)}</span>
        <span class="mc-rate">${c.missing && c.rate == null ? '<small>계산 불가</small>' : pct(c.rate)}</span>
      </span>
      <span class="mc-sub">
        판매 ${num(m.price)} · 원가 ${num(c.cost)}${c.missing ? ' <em class="warn">(일부 재료 미계산)</em>' : ''}
        ${delta ? `<em class="${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'}${num(Math.abs(delta))}</em>` : ''}
      </span>
      <span class="mc-bar" aria-hidden="true"><i style="width:${w}%"></i><b style="left:${(target / scale) * 100}%"></b></span>
    </button>`;
}

export function handleCostClick(e) {
  const t = e.target.closest('[data-cost],[data-cost-open]');
  if (!t) return false;
  if (t.dataset.costOpen) openMenuDetail(t.dataset.costOpen);
  else if (t.dataset.cost === 'add') openMenuEditor({});
  else if (t.dataset.cost === 'target') openTargetSheet();
  return true;
}

// ───────────────────────── 목표 원가율 ─────────────────────────

function openTargetSheet() {
  openSheet({
    title: '목표 원가율',
    live: true,
    render(body, close) {
      const cur = store.costTarget;
      const hist = [...store.costTargetHistory].reverse();
      body.innerHTML = `
        <form class="editor target-form">
          <label>새 목표 원가율 (%)
            <input name="v" type="number" inputmode="decimal" step="0.1" min="1" max="99" value="${cur.value}" required>
          </label>
          <p class="muted small">이 값을 넘는 메뉴는 원가 탭에서 ⚠ 로 표시됩니다. 바꾼 날짜가 아래 기록에 남습니다.</p>
          <div class="actions"><button type="button" class="btn ghost cancel">닫기</button><button class="btn primary" type="submit">저장</button></div>
        </form>
        <h3 class="sub">변경 기록</h3>
        <ul class="target-hist">${hist
          .map(
            (h, i) => `<li class="${i === 0 ? 'cur' : ''}"><b>${pct(h.value).replace('.0%', '%')}</b><span>${dot(h.at)}${h.note ? ` · ${esc(h.note)}` : ''}${i === 0 ? ' · 현재' : ''}</span></li>`,
          )
          .join('')}</ul>`;
      const form = body.querySelector('form');
      body.querySelector('.cancel').addEventListener('click', close);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = Number(form.elements.v.value);
        if (v === cur.value) return toast('현재 목표와 같습니다.');
        try {
          store.setCostTarget(v);
          toast(`목표 원가율을 ${v}%로 바꿨습니다.`);
        } catch (err) {
          toast(err.message);
        }
      });
    },
  });
}

// ───────────────────────── 메뉴 상세 ─────────────────────────

function openMenuDetail(id) {
  openSheet({
    title: '메뉴 원가',
    live: true,
    render(body, close) {
      const m = store.getMenu(id);
      if (!m) return close();
      const c = menuCost(m);
      const target = store.costTarget.value;
      const overT = c.rate != null && c.rate > target;
      body.innerHTML = `
        <h2 class="detail-name">${esc(m.name)}</h2>
        <div class="stats">
          <div><p>판매가</p><b>${won(m.price)}</b></div>
          <div><p>원가</p><b>${won(c.cost)}</b></div>
          <div class="${overT ? 'over' : ''}"><p>원가율</p><b>${pct(c.rate)}</b><small>목표 ${target}%</small></div>
          <div><p>마진</p><b>${won(m.price - c.cost)}</b></div>
        </div>
        ${overT ? `<p class="notice">목표 원가율 ${target}%를 넘었습니다. 목표에 맞추려면 판매가 약 ${won(Math.ceil(c.cost / (target / 100) / 100) * 100)} 이상이 필요합니다.</p>` : ''}
        <h3 class="sub">재료별 원가</h3>
        <ul class="ing-list">${c.parts.map((p) => ingLi(p, c.cost)).join('')}</ul>
        <p class="muted small">매입 품목 재료는 가장 최근 매입 단가(쿠폰·할인 반영)로 계산합니다. ▲▼는 직전 매입 대비 변화입니다.</p>
        <div class="actions">
          <button class="btn ghost danger-text" data-del>삭제</button>
          <button class="btn primary" data-edit>수정</button>
        </div>`;
      body.querySelectorAll('[data-ing-trend]').forEach((b) => b.addEventListener('click', () => hooks.openTrend(b.dataset.ingTrend)));
      body.querySelector('[data-edit]').addEventListener('click', () => openMenuEditor(m));
      body.querySelector('[data-del]').addEventListener('click', () => {
        if (confirm(`'${m.name}' 메뉴를 삭제할까요?`)) {
          store.removeMenu(m.id);
          close();
        }
      });
    },
  });
}

function ingLi(p, total) {
  const g = p.g;
  const share = p.cost != null && total ? Math.round((p.cost / total) * 100) : null;
  if (g.type === 'manual')
    return `<li><span class="iname">${esc(g.name)}<small>직접 입력 원가</small></span><span class="iamt">${won(p.cost)}${share != null ? `<small>${share}%</small>` : ''}</span></li>`;
  const d = p.prev && p.cost != null ? Math.round(p.cost - p.prevCost) : 0;
  return `<li><button class="item-btn" data-ing-trend="${esc(g.itemName)}">
    <span class="iname">${esc(g.itemName)}
      <small>${g.packSize ? `${num(g.packSize)}${esc(g.unit)} 중 ${num(g.use)}${esc(g.unit)}` : ''}${
        p.source ? ` · 최근 ${num(p.source.unitPrice)}원 (${shortDate(p.source.date)} ${esc(p.source.vendor)})` : ''
      }</small>
      ${p.cost == null ? `<small class="warn">${esc(p.reason)}</small>` : ''}
    </span>
    <span class="iamt">${p.cost == null ? '-' : won(p.cost)}${d ? `<em class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}${num(Math.abs(d))}</em>` : ''}<span class="chev">📈</span></span>
  </button></li>`;
}

// ───────────────────────── 메뉴 등록/수정 ─────────────────────────

function openMenuEditor(menu) {
  const m = structuredClone({ name: '', price: '', ingredients: [], ...menu });
  if (!m.ingredients.length) m.ingredients.push(blankItemIng());
  const isEdit = !!(menu.id && store.getMenu(menu.id));

  openSheet({
    title: isEdit ? '메뉴 수정' : '메뉴 추가',
    render(body, close) {
      body.innerHTML = `
        <form class="editor menu-editor" novalidate>
          <div class="row2">
            <label>메뉴 이름<input name="name" required placeholder="예: 몽키숄더 한 잔" value="${esc(m.name)}"></label>
            <label>판매가 (원)<input name="price" type="number" inputmode="numeric" required placeholder="12000" value="${m.price || ''}"></label>
          </div>
          <h3 class="sub">재료 <span class="muted small">— 한 잔(한 조각)에 들어가는 양</span></h3>
          <datalist id="item-names">${store.itemNames().map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
          <datalist id="unit-list">${UNITS.map((u) => `<option value="${u}">`).join('')}</datalist>
          <div class="ings"></div>
          <div class="btn-row">
            <button type="button" class="btn ghost" data-add="item">+ 매입 품목 재료</button>
            <button type="button" class="btn ghost" data-add="manual">+ 직접 입력 재료</button>
          </div>
          <div class="total-bar"><span>원가 · 원가율</span><strong class="sum"></strong></div>
          <div class="actions">
            <button type="button" class="btn ghost cancel">취소</button>
            <button type="submit" class="btn primary">저장</button>
          </div>
        </form>`;
      const form = body.querySelector('form');
      const ingsEl = body.querySelector('.ings');
      const sumEl = body.querySelector('.sum');

      const updateSum = () => {
        const c = menuCost({ ...m, price: Number(form.elements.price.value) || 0 });
        const t = store.costTarget.value;
        sumEl.innerHTML = `${won(c.cost)} · <span class="${c.rate != null && c.rate > t ? 'warn' : ''}">${pct(c.rate)}</span>`;
        ingsEl.querySelectorAll('.ing-edit').forEach((row) => {
          const p = c.parts[+row.dataset.idx];
          const info = row.querySelector('.ing-info');
          if (!info || !p) return;
          info.innerHTML =
            p.g.type === 'manual'
              ? ''
              : p.source
                ? `최근 매입 ${num(p.source.unitPrice)}원 · ${shortDate(p.source.date)} ${esc(p.source.vendor)}${p.cost != null ? ` → <b>1잔 ${won(p.cost)}</b>` : ''}`
                : p.g.itemName
                  ? '<span class="warn">이 이름의 매입 기록이 없습니다. 목록에서 골라 주세요.</span>'
                  : '';
        });
      };

      const draw = () => {
        ingsEl.innerHTML = m.ingredients
          .map((g, idx) =>
            g.type === 'manual'
              ? `<div class="ing-edit" data-idx="${idx}">
                   <div class="row-name"><input data-f="name" placeholder="재료 이름 (예: 시럽, 라임)" value="${esc(g.name)}"><button type="button" class="icon-btn del" aria-label="재료 삭제">✕</button></div>
                   <div class="ing-row"><span>1잔당 원가</span><input data-f="cost" type="number" inputmode="numeric" placeholder="원" value="${g.cost || ''}"><span>원</span></div>
                 </div>`
              : `<div class="ing-edit" data-idx="${idx}">
                   <div class="row-name"><input data-f="itemName" list="item-names" placeholder="매입 품목 검색 (예: 몽키숄더)" value="${esc(g.itemName)}"><button type="button" class="icon-btn del" aria-label="재료 삭제">✕</button></div>
                   <div class="ing-row">
                     <span>1개 용량</span><input data-f="packSize" type="number" inputmode="decimal" step="any" placeholder="700" value="${g.packSize || ''}">
                     <input data-f="unit" list="unit-list" class="unit" placeholder="ml" value="${esc(g.unit)}">
                     <span>중</span><input data-f="use" type="number" inputmode="decimal" step="any" placeholder="30" value="${g.use || ''}">
                     <span class="unit-echo">${esc(g.unit)}</span>
                   </div>
                   <p class="ing-info muted small"></p>
                 </div>`,
          )
          .join('');
        updateSum();
      };
      draw();

      ingsEl.addEventListener('input', (e) => {
        const f = e.target.dataset.f;
        if (!f) return;
        const row = e.target.closest('.ing-edit');
        const g = m.ingredients[+row.dataset.idx];
        g[f] = ['packSize', 'use', 'cost'].includes(f) ? Number(e.target.value) || 0 : e.target.value;
        if (f === 'unit') row.querySelector('.unit-echo').textContent = g.unit;
        updateSum();
      });
      // 품목을 고르면 이름의 용량(700ML, 2L, 510G)으로 1개 용량을 미리 채움
      ingsEl.addEventListener('change', (e) => {
        if (e.target.dataset.f !== 'itemName') return;
        const g = m.ingredients[+e.target.closest('.ing-edit').dataset.idx];
        const guess = guessPack(g.itemName);
        if (guess && !g.packSize) {
          Object.assign(g, guess);
          draw();
        }
      });
      ingsEl.addEventListener('click', (e) => {
        if (!e.target.closest('.del')) return;
        m.ingredients.splice(+e.target.closest('.ing-edit').dataset.idx, 1);
        draw();
      });
      body.querySelectorAll('[data-add]').forEach((b) =>
        b.addEventListener('click', () => {
          m.ingredients.push(b.dataset.add === 'manual' ? { id: uid(), type: 'manual', name: '', cost: 0 } : blankItemIng());
          draw();
          ingsEl.lastElementChild.querySelector('input').focus();
        }),
      );
      form.elements.price.addEventListener('input', updateSum);
      body.querySelector('.cancel').addEventListener('click', close);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        m.name = form.elements.name.value.trim();
        m.price = Number(form.elements.price.value) || 0;
        if (!m.name) return toast('메뉴 이름을 입력해 주세요.');
        if (!m.price) return toast('판매가를 입력해 주세요.');
        m.ingredients = m.ingredients.filter((g) => (g.type === 'manual' ? g.name || g.cost : g.itemName));
        if (!m.ingredients.length) return toast('재료를 하나 이상 넣어 주세요.');
        store.upsertMenu(m);
        toast('저장했습니다.');
        close();
      });
    },
  });
}

function blankItemIng() {
  return { id: uid(), type: 'item', itemName: '', packSize: 0, unit: 'ml', use: 0 };
}
