// 원가 탭: 메뉴별 1잔(1조각) 원가와 원가율
// 매입 내역의 '가장 최근 매입 단가(할인 반영)'로 자동 계산하므로, 새 영수증이 들어오면 원가율도 바로 바뀝니다.

import { dotDate, esc, num, pct, pctShort, shortDate, uid, won } from '../lib/format.js';
import { guessPack, UNCATEGORIZED } from '../lib/model.js';
import { menuCost, priceForTarget, priceForMargin, judgeMenu, judgeBottle, bottleCost, bottleRefs, summarizeMenus } from '../lib/cost.js';
import { filterMenus, groupRowsByCategory } from '../lib/menuCategories.js';
import { view, setCostFilter } from '../state.js';
import { unitSelectHTML } from '../ui/units.js';
import { openSheet, toast } from '../ui/sheet.js';
import { store } from '../store.js';
import { openTrend } from './trend.js';
import { pickItem } from './itemPicker.js';


const costOf = (m) => menuCost(m, store.index);
const specOf = (name) => store.index.spec(name);

// ───────────────────────── 원가 탭 화면 ─────────────────────────

/** 지금 고른 분류 (지워진 분류를 보고 있었으면 '전체'로) */
function currentFilter() {
  const f = view.costFilter;
  const cats = store.menuCategories;
  if (f === '전체' || cats.includes(f)) return f;
  if (f === UNCATEGORIZED && store.menus.some((m) => !m.category || !cats.includes(m.category))) return f;
  return '전체';
}

/** 목표 원가율 아래: 분류별 최소 마진 요약 (분류를 고르고 있으면 그 분류 값) */
function marginLine(filter) {
  const cats = store.menuCategories;
  let text;
  const bottleOf = (c) => store.minMarginOf(c, 'bottle');
  if (cats.includes(filter)) {
    const v = store.minMarginOf(filter);
    const b = bottleOf(filter);
    const last = store.minMarginLast(filter);
    text =
      v || b
        ? `${esc(filter)} 최소 마진 ${v ? `<b>${won(v)}</b>` : '잔 없음'}${b ? ` · 보틀 <b>${won(b)}</b>` : ''} <span class="muted">· ${dotDate(last.at)}</span>`
        : `${esc(filter)}: 최소 마진 없음 (원가율로만 판정)`;
  } else {
    const set = cats.filter((c) => store.minMarginOf(c) || bottleOf(c));
    text = set.length
      ? `최소 마진: ${set.map((c) => `${esc(c)} <b>${store.minMarginOf(c) ? num(store.minMarginOf(c)) : '-'}</b>${bottleOf(c) ? `<small>/보틀 ${num(bottleOf(c))}</small>` : ''}`).join(' · ')}`
      : '분류별 최소 마진: 설정 안 함';
  }
  return `<section class="margin-line"><p>${text}</p><button class="btn ghost small-btn" data-cost="margins">최소 마진</button></section>`;
}

function filterChips(filter) {
  const cats = store.menuCategories;
  const count = (f) => filterMenus(store.menus, f, cats).length;
  const uncategorized = count(UNCATEGORIZED);
  const chip = (f) =>
    `<button class="chip" aria-pressed="${filter === f}" data-cost-filter="${esc(f)}">${esc(f)} <small>${count(f)}</small></button>`;
  return `<div class="chips cat-chips" role="group" aria-label="메뉴 분류">
    ${chip('전체')}${cats.map(chip).join('')}${uncategorized ? chip(UNCATEGORIZED) : ''}
    <button class="chip chip-edit" data-cost="edit-cats" aria-label="메뉴 분류 편집">✎ 편집</button>
  </div>`;
}

export function renderCostTab() {
  const target = store.costTarget;
  const filter = currentFilter();
  const menus = filterMenus(store.menus, filter, store.menuCategories);
  const { rows, over, byMargin, avg } = summarizeMenus(menus, store.index, target.value, store.minMargins);
  const scale = Math.max(50, target.value * 2);
  const cards = (list) => list.map(({ m, c, j, jb }) => menuCard(m, c, j, jb, target.value, scale)).join('');

  let body;
  if (!store.menus.length)
    body = `<section class="summary"><p class="empty-msg">파는 메뉴를 등록하면<br>최근 매입가로 <b>한 잔(조각) 원가</b>와 <b>원가율</b>을 자동 계산합니다.<br><br>
             <span class="muted small">예) 몽키숄더 한 잔: 700ml 한 병 중 30ml 사용<br>바스크 치즈케이크: 1개를 7조각으로</span></p></section>`;
  else if (!rows.length) body = `<section class="summary"><p class="empty-msg">${esc(filter)} 분류에 메뉴가 없습니다.<br>아래 <b>메뉴 추가</b>로 등록하세요.</p></section>`;
  else
    body = `<p class="cost-summary">${filter === '전체' ? '' : `${esc(filter)} · `}메뉴 ${rows.length}개 · ${
      over ? `<b class="warn">⚠ 목표 초과 ${over}개</b>` : '<b class="ok">모두 목표 이내</b>'
    }${byMargin ? ` · <b class="ok">마진 기준 충족 ${byMargin}개</b>` : ''} · 평균 ${pct(avg)}</p>
      ${
        filter === '전체'
          ? groupRowsByCategory(rows, store.menuCategories)
              .map((g) => `<section class="menu-group" aria-label="${esc(g.name)}"><h2 class="group-title">${esc(g.name)} <small>${g.rows.length}</small></h2><div class="menu-list">${cards(g.rows)}</div></section>`)
              .join('')
          : `<section class="menu-list">${cards(rows)}</section>`
      }`;

  return `
    <header class="top">
      <h1 class="month-title static">원가율</h1>
      <button class="icon-btn settings" data-act="settings" aria-label="설정">⚙</button>
    </header>

    <section class="hero target-card">
      <div>
        <p class="hero-label">목표 원가율</p>
        <p class="hero-num">${pctShort(target.value)}</p>
        <p class="hero-sub">${dotDate(target.at)} ${target.note === '기본값' ? '기본값으로 설정' : '변경'}</p>
      </div>
      <button class="btn ghost" data-cost="target">변경</button>
    </section>
    ${marginLine(filter)}

    ${filterChips(filter)}
    ${body}

    <div class="fab-wrap">
      <button class="fab" data-cost="add">＋<span>메뉴 추가</span></button>
    </div>`;
}

function menuCard(m, c, j, jb, target, scale) {
  const over = j.status === 'over' || jb?.status === 'over';
  const w = c.rate == null ? 0 : Math.min(100, (c.rate / scale) * 100);
  const delta = Math.round(c.delta);
  return `
    <button class="menu-card ${over ? 'over' : ''} ${!over && (j.status === 'margin' || jb?.status === 'margin') ? 'by-margin' : ''}" data-cost-open="${m.id}">
      <span class="mc-top">
        <span class="mc-name">${over ? '⚠ ' : ''}${esc(m.name)}</span>
        <span class="mc-rate ${j.status === 'over' ? 'over' : ''}">${c.rate == null ? '<small>계산 불가</small>' : pct(c.rate)}</span>
      </span>
      <span class="mc-sub">
        판매 ${num(m.price)} · 원가 ${num(c.cost)} · 마진 ${num(j.margin)}${c.missing ? ' <em class="warn">(일부 재료 미계산)</em>' : ''}
        ${delta ? `<em class="${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'}${num(Math.abs(delta))}</em>` : ''}
      </span>
      ${jb ? bottleLine(m, jb) : ''}
      ${j.status === 'margin' ? `<span class="mc-badge">✔ 마진 기준 충족 (최소 ${num(j.minMargin)}원)</span>` : ''}
      <span class="mc-bar" aria-hidden="true"><i style="width:${w}%"></i><b style="left:${(target / scale) * 100}%"></b></span>
    </button>`;
}

/** 카드의 보틀 줄: 보틀 판매가 · 원가율 · 마진 */
function bottleLine(m, jb) {
  const mark = jb.status === 'over' ? '⚠ ' : '';
  const tail =
    jb.status === 'unknown'
      ? '<small>원가 계산 불가 (매입 기록 없음)</small>'
      : `원가율 <b>${pct(jb.rate)}</b> · 마진 ${num(jb.margin)}${jb.status === 'margin' ? ' <span class="ok">✔ 마진 기준</span>' : ''}`;
  return `<span class="mc-bottle ${jb.status === 'over' ? 'over' : ''}">${mark}보틀 ${num(m.bottlePrice)} · ${tail}</span>`;
}

export function handleCostClick(e) {
  const t = e.target.closest('[data-cost],[data-cost-open],[data-cost-filter]');
  if (!t) return false;
  if (t.dataset.costFilter) setCostFilter(t.dataset.costFilter);
  else if (t.dataset.costOpen) openMenuDetail(t.dataset.costOpen);
  else if (t.dataset.cost === 'add') {
    // 보고 있던 분류로 미리 골라 둠
    const f = currentFilter();
    openMenuEditor({ category: store.menuCategories.includes(f) ? f : '' });
  } else if (t.dataset.cost === 'target') openTargetSheet();
  else if (t.dataset.cost === 'edit-cats') openCategoryEditor();
  else if (t.dataset.cost === 'margins') openMarginSheet();
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
            (h, i) => `<li class="${i === 0 ? 'cur' : ''}"><b>${pctShort(h.value)}</b><span>${dotDate(h.at)}${h.note ? ` · ${esc(h.note)}` : ''}${i === 0 ? ' · 현재' : ''}</span></li>`,
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
      const c = costOf(m);
      const target = store.costTarget.value;
      const j = judgeMenu(c, m.price, target, store.minMarginOf(m.category));
      const overT = j.status === 'over';
      body.innerHTML = `
        <h2 class="detail-name">${esc(m.name)}</h2>
        <div class="stats">
          <div><p>판매가</p><b>${won(m.price)}</b></div>
          <div><p>원가</p><b>${won(c.cost)}</b></div>
          <div class="${c.rate != null && c.rate > target ? 'over' : ''}"><p>원가율</p><b>${pct(c.rate)}</b><small>목표 ${target}%</small></div>
          <div class="${j.status === 'margin' ? 'good' : ''}"><p>마진</p><b>${won(j.margin)}</b>${j.minMargin ? `<small>최소 ${num(j.minMargin)}</small>` : ''}</div>
        </div>
        ${detailNotice(m, c, j, target)}
        ${bottleSection(m, target)}
        <h3 class="sub">재료별 원가</h3>
        <ul class="ing-list">${c.parts.map((p) => ingLi(p, c.cost)).join('')}</ul>
        <p class="muted small">매입 품목 재료는 가장 최근 매입 단가(쿠폰·할인 반영)로 계산합니다. ▲▼는 직전 매입 대비 변화입니다.</p>
        <div class="actions">
          <button class="btn ghost danger-text" data-del>삭제</button>
          <button class="btn primary" data-edit>수정</button>
        </div>`;
      body.querySelectorAll('[data-ing-trend]').forEach((b) => b.addEventListener('click', () => openTrend(b.dataset.ingTrend)));
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
      <small>${p.pack ? `${num(p.pack)}${esc(p.unit)} 중 ${num(g.use)}${esc(p.unit)}` : ''}${
        p.source ? ` · 최근 ${num(p.source.price)}원 (${shortDate(p.source.date)} ${esc(p.source.vendor)})` : ''
      }</small>
      ${p.cost == null ? `<small class="warn">${esc(p.reason)}</small>` : ''}
    </span>
    <span class="iamt">${p.cost == null ? '-' : won(p.cost)}${d ? `<em class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}${num(Math.abs(d))}</em>` : ''}<span class="chev">📈</span></span>
  </button></li>`;
}

function detailNotice(m, c, j, target) {
  if (j.status === 'margin')
    return `<p class="notice ok-notice">원가율은 목표(${target}%)보다 높지만, 한 잔 마진 <b>${won(j.margin)}</b>이 ${esc(m.category)} 최소 마진 ${won(j.minMargin)} 이상이라 합격입니다.</p>`;
  if (j.status !== 'over') return '';
  const byRate = priceForTarget(c.cost, target);
  const lines = [`원가율 ${target}% 기준: <b>${won(byRate)}</b> 이상`];
  if (j.minMargin) lines.push(`최소 마진 ${won(j.minMargin)} 기준: <b>${won(priceForMargin(c.cost, j.minMargin))}</b> 이상`);
  return `<div class="notice">
    <p>${j.minMargin ? `목표 원가율 ${target}%를 넘었고, 최소 마진 ${won(j.minMargin)}도 못 채웁니다.` : `목표 원가율 ${target}%를 넘었습니다.${m.category ? ` (${esc(m.category)}은 최소 마진이 없어 원가율로만 판정)` : ''}`}</p>
    <p class="suggest-title">추천 판매가</p>
    <ul class="suggest">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
  </div>`;
}

/** 메뉴 상세의 보틀 판매: 판매가·원가·원가율·마진, 합격 안내 또는 추천 판매가 */
function bottleSection(m, target) {
  if (!m.bottlePrice) return '';
  const jb = judgeBottle(m, store.index, target, store.minMarginOf(m.category, 'bottle'));
  const b = jb.b;
  if (!b)
    return `<h3 class="sub">보틀 판매</h3><p class="notice">보틀 판매가 ${won(m.bottlePrice)} · 첫 번째 재료의 매입 기록이 없어 보틀 원가를 계산할 수 없습니다.</p>`;
  const refs = bottleRefs(b, m.price);
  const lines = [];
  if (jb.status === 'over') {
    lines.push(`원가율 ${target}% 기준: <b>${won(priceForTarget(b.cost, target))}</b> 이상`);
    if (jb.minMargin) lines.push(`보틀 최소 마진 ${won(jb.minMargin)} 기준: <b>${won(priceForMargin(b.cost, jb.minMargin))}</b> 이상`);
  }
  const refLines = [
    refs.glassSum70 ? `잔 합계의 70%: ${won(refs.glassSum70)} <small class="muted">(${refs.glasses}잔 × ${num(m.price)} = ${num(refs.glassSum)})</small>` : '',
    `원가 × 3배: ${won(refs.x3)}`,
  ].filter(Boolean);
  const head =
    jb.status === 'margin'
      ? `<p class="notice ok-notice">원가율은 목표(${target}%)보다 높지만, 보틀 마진 <b>${won(jb.margin)}</b>이 보틀 최소 마진 ${won(jb.minMargin)} 이상이라 합격입니다.</p>`
      : jb.status === 'over'
        ? `<div class="notice"><p>${jb.minMargin ? `보틀 원가율이 목표 ${target}%를 넘었고, 보틀 최소 마진 ${won(jb.minMargin)}도 못 채웁니다.` : `보틀 원가율이 목표 ${target}%를 넘었습니다.${m.category ? ` (${esc(m.category)}은 보틀 최소 마진이 없어 원가율로만 판정)` : ''}`}</p>
            <p class="suggest-title">추천 보틀 판매가</p><ul class="suggest">${lines.map((l) => `<li>${l}</li>`).join('')}</ul></div>`
        : '';
  return `<section class="bottle-sec">
    <h3 class="sub">보틀 판매</h3>
    <div class="stats">
      <div><p>보틀 판매가</p><b>${won(m.bottlePrice)}</b></div>
      <div><p>1병 원가</p><b>${won(b.cost)}</b></div>
      <div class="${jb.rate > target ? 'over' : ''}"><p>원가율</p><b>${pct(jb.rate)}</b><small>목표 ${target}%</small></div>
      <div class="${jb.status === 'margin' ? 'good' : ''}"><p>마진</p><b>${won(jb.margin)}</b>${jb.minMargin ? `<small>최소 ${num(jb.minMargin)}</small>` : ''}</div>
    </div>
    <p class="muted small">${esc(b.itemName)} 최근 ${num(b.cost)}원 (${shortDate(b.source.date)} ${esc(b.source.vendor)})${b.glasses ? ` · 1병 ≈ ${Math.floor(b.glasses)}잔` : ''}</p>
    ${head}
    <p class="suggest-title">참고 가격</p>
    <ul class="suggest ref">${refLines.map((l) => `<li>${l}</li>`).join('')}</ul>
  </section>`;
}

// ───────────────────────── 분류별 최소 마진 ─────────────────────────

function openMarginSheet() {
  openSheet({
    title: '분류별 최소 마진',
    live: true,
    render(body, close) {
      const cats = store.menuCategories;
      const hist = cats
        .flatMap((c) => (store.minMargins[c] ?? []).map((h, i) => ({ c, i, ...h })))
        .sort((a, b) => b.at.localeCompare(a.at) || b.i - a.i) // 같은 날이면 나중에 바꾼 것이 위
        .slice(0, 30);
      body.innerHTML = `
        <p class="muted small">한 잔(한 조각)·보틀 하나에 최소 이만큼은 남겨야 하는 금액입니다. 원가율이 목표를 넘어도 이 금액 이상 남으면 '마진 기준 충족'으로 봅니다.
          비싼 위스키·와인처럼 원가율로만 가격을 정하기 어려운 분류에 쓰세요. 비워 두면 원가율로만 판정합니다. 보틀은 보틀 판매가를 적은 메뉴에만 씁니다.</p>
        ${
          cats.length
            ? `<form class="editor margin-form" novalidate>
          <ul class="margin-list">${cats
            .map((c) => {
              const v = store.minMarginOf(c);
              const b = store.minMarginOf(c, 'bottle');
              const last = store.minMarginLast(c);
              const input = (name, val, label) =>
                `<input name="${esc(name)}" type="number" inputmode="numeric" min="0" step="100" placeholder="없음" value="${val ?? ''}" aria-label="${esc(c)} ${label} 최소 마진(원)">`;
              return `<li><span class="mname">${esc(c)}</span>
                <span class="mpair">
                  <label class="minput"><span class="mk">잔</span>${input(c, v, '잔')}<span>원</span></label>
                  <label class="minput"><span class="mk">보틀</span>${input(`${c}::bottle`, b, '보틀')}<span>원</span></label>
                </span>
                <span class="muted small mdate">${last ? `${dotDate(last.at)} ${last.value || last.bottle ? '설정' : '해제'}` : '설정 안 함'}</span></li>`;
            })
            .join('')}</ul>
          <div class="actions"><button type="button" class="btn ghost cancel">닫기</button><button class="btn primary" type="submit">저장</button></div>
        </form>`
            : '<p class="empty-msg">먼저 메뉴 분류를 만들어 주세요.</p>'
        }
        ${
          hist.length
            ? `<h3 class="sub">변경 기록</h3><ul class="target-hist">${hist
                .map(
                  (h) =>
                    `<li><b>${esc(h.c)} ${h.value || h.bottle ? h.bottle ? `${h.value ? `잔 ${won(h.value)}` : '잔 없음'} · 보틀 ${won(h.bottle)}` : won(h.value) : '해제'}</b><span>${dotDate(h.at)}</span></li>`,
                )
                .join('')}</ul>`
            : ''
        }`;
      const form = body.querySelector('.margin-form');
      body.querySelector('.cancel')?.addEventListener('click', close);
      form?.addEventListener('submit', (e) => {
        e.preventDefault();
        const values = Object.fromEntries(cats.map((c) => [c, { glass: form.elements[c].value, bottle: form.elements[`${c}::bottle`].value }]));
        try {
          const changed = store.setMinMargins(values);
          toast(changed.length ? `${changed.join(', ')} 최소 마진을 저장했습니다.` : '바뀐 값이 없습니다.');
        } catch (err) {
          toast(err.message);
        }
      });
    },
  });
}

// ───────────────────────── 메뉴 등록/수정 ─────────────────────────

function openMenuEditor(menu) {
  const m = structuredClone({ name: '', price: '', bottlePrice: 0, category: '', ingredients: [], ...menu });
  const isEdit = !!(menu.id && store.getMenu(menu.id));
  const catOptions = ['', ...store.menuCategories];

  openSheet({
    title: isEdit ? '메뉴 수정' : '메뉴 추가',
    render(body, close) {
      body.innerHTML = `
        <form class="editor menu-editor" novalidate>
          <div class="row2">
            <label>메뉴 이름<input name="name" required placeholder="예: 몽키숄더 한 잔" value="${esc(m.name)}"></label>
            <label>판매가 (잔, 원)<input name="price" type="number" inputmode="numeric" required placeholder="12000" value="${m.price || ''}"></label>
          </div>
          <label class="bottle-price">보틀 판매가 (원, 선택)
            <input name="bottlePrice" type="number" inputmode="numeric" placeholder="보틀로 안 팔면 비워 두세요" value="${m.bottlePrice || ''}">
          </label>
          <fieldset class="cat-pick">
            <legend>분류</legend>
            <div class="chips">${catOptions
              .map(
                (c) => `<label class="chip radio-chip"><input type="radio" name="category" value="${esc(c)}" ${(m.category || '') === c ? 'checked' : ''}>${esc(c || UNCATEGORIZED)}</label>`,
              )
              .join('')}</div>
          </fieldset>
          <h3 class="sub">재료 <span class="muted small">— 한 잔(한 조각)에 들어가는 양</span></h3>
          <div class="ings"></div>
          <div class="btn-row">
            <button type="button" class="btn ghost" data-add="item">+ 매입 품목 재료</button>
            <button type="button" class="btn ghost" data-add="manual">+ 직접 입력 재료</button>
          </div>
          <div class="total-bar"><span>잔 원가 · 원가율</span><strong class="sum"></strong></div>
          <div class="total-bar bottle-bar" hidden><span>보틀 원가 · 원가율</span><strong class="bsum"></strong></div>
          <p class="muted small bottle-info" hidden></p>
          <div class="actions">
            <button type="button" class="btn ghost cancel">취소</button>
            <button type="submit" class="btn primary">저장</button>
          </div>
        </form>`;
      const form = body.querySelector('form');
      const ingsEl = body.querySelector('.ings');
      const sumEl = body.querySelector('.sum');

      const updateSum = () => {
        const c = costOf({ ...m, price: Number(form.elements.price.value) || 0 });
        const t = store.costTarget.value;
        const price = Number(form.elements.price.value) || 0;
        const cat = form.elements.category?.value ?? m.category;
        const j = judgeMenu(c, price, t, store.minMarginOf(cat));
        sumEl.innerHTML = `${won(c.cost)} · <span class="${j.status === 'over' ? 'warn' : j.status === 'margin' ? 'ok' : ''}">${pct(c.rate)}</span>${
          price ? `<small class="sum-margin">마진 ${won(j.margin)}${j.status === 'margin' ? ' ✔' : ''}</small>` : ''
        }`;
        // 보틀: 첫 번째 매입 품목 한 병 기준. 판매가를 안 적었어도 참고 가격은 보여 줌
        const bottlePrice = Number(form.elements.bottlePrice.value) || 0;
        const b = bottleCost(m, store.index);
        const bBar = body.querySelector('.bottle-bar');
        const bInfo = body.querySelector('.bottle-info');
        bBar.hidden = !(bottlePrice && b);
        if (bottlePrice && b) {
          const jb = judgeBottle({ ...m, bottlePrice }, store.index, t, store.minMarginOf(cat, 'bottle'));
          body.querySelector('.bsum').innerHTML = `${won(b.cost)} · <span class="${jb.status === 'over' ? 'warn' : jb.status === 'margin' ? 'ok' : ''}">${pct(jb.rate)}</span><small class="sum-margin">마진 ${won(jb.margin)}${jb.status === 'margin' ? ' ✔' : ''}</small>`;
        }
        bInfo.hidden = !b;
        if (b) {
          const refs = bottleRefs(b, price);
          bInfo.innerHTML = `보틀 기준: ${esc(b.itemName)} 1병 ${won(b.cost)}${refs.glasses ? ` · 1병 ≈ ${refs.glasses}잔` : ''}<br>참고 보틀가: ${
            refs.glassSum70 ? `잔 합계 70% <b>${won(refs.glassSum70)}</b> · ` : ''
          }원가 × 3 <b>${won(refs.x3)}</b>`;
        }
        ingsEl.querySelectorAll('.ing-edit').forEach((row) => {
          const p = c.parts[+row.dataset.idx];
          const info = row.querySelector('.ing-info');
          if (!info || !p) return;
          info.innerHTML =
            p.g.type === 'manual'
              ? ''
              : p.source
                ? `최근 매입 ${num(p.source.price)}원 · ${shortDate(p.source.date)} ${esc(p.source.vendor)}${p.cost != null ? ` → <b>1잔 ${won(p.cost)}</b>` : ''}`
                : p.g.itemName
                  ? '<span class="warn">이 이름의 매입 기록이 없습니다. 목록에서 골라 주세요.</span>'
                  : '';
        });
      };

      const draw = () => {
        ingsEl.innerHTML = m.ingredients.length ? '' : '<p class="muted small ings-empty">아래 버튼으로 재료를 추가하세요. 매입 품목은 목록에서 고르면 됩니다.</p>';
        ingsEl.innerHTML += m.ingredients
          .map((g, idx) =>
            g.type === 'manual'
              ? `<div class="ing-edit" data-idx="${idx}">
                   <div class="row-name"><input data-f="name" placeholder="재료 이름 (예: 시럽, 라임)" value="${esc(g.name)}"><button type="button" class="icon-btn del" aria-label="재료 삭제">✕</button></div>
                   <div class="ing-row"><span>1잔당 원가</span><input data-f="cost" type="number" inputmode="numeric" placeholder="원" value="${g.cost || ''}"><span>원</span></div>
                 </div>`
              : (() => {
                  const spec = g.itemName ? specOf(g.itemName) : null;
                  const u = g.unit || spec?.packUnit || '';
                  return `<div class="ing-edit" data-idx="${idx}">
                   <div class="row-name"><button type="button" class="pick-btn ${g.itemName ? '' : 'empty'}" data-pick>${g.itemName ? esc(g.itemName) : '매입 품목 선택'}<span aria-hidden="true">▾</span></button><button type="button" class="icon-btn del" aria-label="재료 삭제">✕</button></div>
                   <div class="ing-row">
                     <span>1개 용량</span><input data-f="packSize" type="number" inputmode="decimal" step="any" placeholder="${spec ? spec.packSize : '700'}" value="${g.packSize || ''}">
                     ${unitSelectHTML('data-f="unit"', g.unit, spec?.packUnit ? `${spec.packUnit}` : '단위')}
                     <span>중</span><input data-f="use" type="number" inputmode="decimal" step="any" placeholder="30" value="${g.use || ''}">
                     <span class="unit-echo">${esc(u)}</span>
                   </div>
                   ${spec && !g.packSize ? `<p class="muted small spec-note">1개 용량은 매입 기록(${num(spec.packSize)}${esc(spec.packUnit)})을 사용합니다. 매입 기록에서 바꾸면 여기도 따라 바뀝니다.</p>` : ''}
                   <p class="ing-info muted small"></p>
                 </div>`;
                })(),
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
        if (f === 'unit') return; // 단위는 change 에서 처리
        g[f] = ['packSize', 'use', 'cost'].includes(f) ? Number(e.target.value) || 0 : e.target.value;
        updateSum();
      });
      // 품목을 고르면: 매입 기록에 용량이 있으면 그걸 쓰고(빈칸 유지), 없으면 이름의 용량(700ML, 2L)으로 채움
      const applyItem = (g, name) => {
        g.itemName = name;
        if (!specOf(name)) {
          const guess = guessPack(name);
          g.packSize = guess ? guess.packSize : 0;
          g.unit = guess ? guess.packUnit : '';
        } else {
          g.packSize = 0;
          g.unit = '';
        }
      };
      ingsEl.addEventListener('change', (e) => {
        if (e.target.dataset.f !== 'unit') return;
        const row = e.target.closest('.ing-edit');
        const g = m.ingredients[+row.dataset.idx];
        g.unit = e.target.value;
        row.querySelector('.unit-echo').textContent = g.unit || specOf(g.itemName)?.packUnit || '';
        updateSum();
      });
      ingsEl.addEventListener('click', async (e) => {
        const row = e.target.closest('.ing-edit');
        if (!row) return;
        const g = m.ingredients[+row.dataset.idx];
        if (e.target.closest('.del')) {
          m.ingredients.splice(+row.dataset.idx, 1);
          draw();
        } else if (e.target.closest('[data-pick]')) {
          const name = await pickItem(g.itemName);
          if (name) {
            applyItem(g, name);
            draw();
          }
        }
      });
      body.querySelectorAll('[data-add]').forEach((b) =>
        b.addEventListener('click', async () => {
          if (b.dataset.add === 'manual') {
            m.ingredients.push({ id: uid(), type: 'manual', name: '', cost: 0 });
            draw();
            ingsEl.lastElementChild.querySelector('input').focus();
            return;
          }
          // 매입 품목 재료: 바로 품목 목록을 열고, 고르면 재료 줄을 추가
          const name = await pickItem('');
          if (!name) return;
          const g = blankItemIng();
          applyItem(g, name);
          m.ingredients.push(g);
          draw();
          ingsEl.lastElementChild.querySelector('[data-f=use]')?.focus();
        }),
      );
      form.elements.price.addEventListener('input', updateSum);
      form.elements.bottlePrice.addEventListener('input', updateSum);
      form.querySelector('.cat-pick')?.addEventListener('change', updateSum); // 분류마다 최소 마진이 다름
      body.querySelector('.cancel').addEventListener('click', close);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        m.name = form.elements.name.value.trim();
        m.price = Number(form.elements.price.value) || 0;
        m.bottlePrice = Number(form.elements.bottlePrice.value) || 0;
        m.category = form.elements.category?.value ?? '';
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
  return { id: uid(), type: 'item', itemName: '', packSize: 0, unit: '', use: 0 };
}

// ───────────────────────── 메뉴 분류 편집 ─────────────────────────

/** 분류 추가·이름 바꾸기·삭제·순서 바꾸기 (저장을 눌러야 반영) */
function openCategoryEditor() {
  // 편집 중인 줄: orig = 원래 이름(새 줄은 null). 이름을 바꿔도 orig 로 메뉴를 따라가게 함
  let rows = store.menuCategories.map((name) => ({ orig: name, name }));
  const countOf = (orig) => (orig ? store.menus.filter((m) => m.category === orig).length : 0);

  openSheet({
    title: '메뉴 분류 편집',
    render(body, close, redraw) {
      body.innerHTML = `
        <p class="muted small">↑↓로 순서를 바꾸고, 이름을 눌러 고칠 수 있습니다. 분류를 지워도 메뉴는 지워지지 않고 '미분류'로 옮겨집니다.</p>
        <ol class="cat-edit">${rows
          .map(
            (r, i) => `<li data-i="${i}">
              <input data-f="name" value="${esc(r.name)}" aria-label="분류 이름 ${i + 1}" placeholder="분류 이름">
              <span class="muted small cat-count">${countOf(r.orig)}개</span>
              <button type="button" class="icon-btn" data-move="-1" aria-label="${esc(r.name)} 위로" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button type="button" class="icon-btn" data-move="1" aria-label="${esc(r.name)} 아래로" ${i === rows.length - 1 ? 'disabled' : ''}>↓</button>
              <button type="button" class="icon-btn del" data-del aria-label="${esc(r.name)} 삭제">✕</button>
            </li>`,
          )
          .join('')}</ol>
        <form class="cat-add">
          <input name="newCat" placeholder="새 분류 이름 (예: 와인)" aria-label="새 분류 이름">
          <button class="btn ghost" type="submit">추가</button>
        </form>
        <div class="actions">
          <button type="button" class="btn ghost cancel">취소</button>
          <button type="button" class="btn primary save">저장</button>
        </div>`;

      const list = body.querySelector('.cat-edit');
      list.addEventListener('input', (e) => {
        if (e.target.dataset.f === 'name') rows[+e.target.closest('li').dataset.i].name = e.target.value;
      });
      list.addEventListener('click', (e) => {
        const li = e.target.closest('li');
        if (!li) return;
        const i = +li.dataset.i;
        const mv = e.target.closest('[data-move]');
        if (mv) {
          const j = i + Number(mv.dataset.move);
          if (j < 0 || j >= rows.length) return;
          [rows[i], rows[j]] = [rows[j], rows[i]];
          redraw();
          body.querySelector(`li[data-i="${j}"] [data-move="${mv.dataset.move}"]:not([disabled])`)?.focus() ??
            body.querySelector(`li[data-i="${j}"] [data-move]:not([disabled])`)?.focus();
        } else if (e.target.closest('[data-del]')) {
          const n = countOf(rows[i].orig);
          if (n && !confirm(`'${rows[i].name}' 분류의 메뉴 ${n}개는 '미분류'로 옮겨집니다. 지울까요?`)) return;
          rows.splice(i, 1);
          redraw();
        }
      });
      body.querySelector('.cat-add').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = e.target.elements.newCat.value.trim();
        if (!name) return;
        if (name === '전체' || name === UNCATEGORIZED) return toast(`'${name}'은(는) 분류 이름으로 쓸 수 없습니다.`);
        if (rows.some((r) => r.name.trim() === name)) return toast('이미 있는 분류입니다.');
        rows.push({ orig: null, name });
        redraw();
        body.querySelector('.cat-add input').focus();
      });
      body.querySelector('.cancel').addEventListener('click', close);
      body.querySelector('.save').addEventListener('click', () => {
        const names = rows.map((r) => r.name.trim());
        if (names.some((n) => !n)) return toast('빈 분류 이름이 있습니다.');
        if (new Set(names).size !== names.length) return toast('같은 이름의 분류가 두 개 있습니다.');
        const moved = store.saveMenuCategories(rows);
        toast(moved ? `저장했습니다. 메뉴 ${moved}개를 '미분류'로 옮겼습니다.` : '저장했습니다.');
        close();
      });
    },
  });
}
