// 원가 탭 → 운영비 · 투자 회수
// 고정비·투자 항목·예상 판매 잔 수를 넣으면 '잔당 최소 마진'을 계산하고, 분류별 최소 마진이 충분한지 알려 줌
// 월 매출을 넣으면 실제 남은 돈과 투자금 실제 회수율도
import { esc, num, uid, todayStr } from '../lib/format.js';
import { openSheet, toast } from '../ui/sheet.js';
import { store } from '../store.js';
import { opsSummary, investMonthly, investPlanned, actualRecovery, investCandidates, DEFAULT_MONTHS, sanitizeOps } from '../lib/ops.js';

const won = (n) => `${num(n)}원`;
const thisMonth = () => todayStr().slice(0, 7);
const ymLabel = (ym) => `${Number(ym.slice(0, 4))}년 ${Number(ym.slice(5, 7))}월`;
const prevMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

/** 원가 탭에 보이는 한 줄 요약 */
export function opsLine() {
  const o = store.ops;
  const s = opsSummary(o, thisMonth());
  const text = s.need
    ? `운영비: 한 달 <b>${won(s.need)}</b>${s.perGlass ? ` · 잔당 최소 <b>${won(s.perGlass)}</b>` : ''}`
    : '운영비·투자 회수: 아직 안 넣음 <span class="muted">(월세·인테리어·잔 등을 마진으로 회수하는 계산)</span>';
  return `<section class="ops-line"><p>${text}</p><button class="btn ghost small-btn" data-cost="ops">운영비</button></section>`;
}

export function openOps() {
  let o = structuredClone(store.ops);
  const ym = thisMonth();
  openSheet({
    title: '운영비 · 투자 회수',
    render(body, close) {
      const cands = investCandidates(store.purchases, o);
      body.innerHTML = `
        <form class="ops" novalidate>
          <section class="set-card set-pad ops-sum" aria-live="polite"></section>

          <section>
            <h3 class="set-title">고정비 <small>매달 나가는 돈</small></h3>
            <div class="set-card set-pad ops-list" data-list="fixed"></div>
            <button type="button" class="btn ghost small-btn" data-add="fixed">+ 고정비 추가</button>
          </section>

          <section>
            <h3 class="set-title">투자 항목 <small>한 번에 쓴 큰돈을 몇 달에 걸쳐 회수</small></h3>
            <div class="set-card set-pad ops-list" data-list="invests"></div>
            <div class="btn-row-wrap">
              <button type="button" class="btn ghost small-btn" data-add="invest">+ 투자 추가</button>
              <button type="button" class="btn ghost small-btn" data-add="ongoing">+ 계속 나가는 비용 (잔 깨짐 등)</button>
            </div>
            ${
              cands.length
                ? `<div class="set-card set-pad ops-cands"><p class="small"><b>영수증에서 찾은 비품·시설 ${cands.length}건</b> — 투자 항목으로 넣을까요?</p><ul>${cands
                    .slice(0, 8)
                    .map((c) => `<li><span class="grow">${esc(c.name)}<small>${c.date.slice(5).replace('-', '/')} ${esc(c.vendor)} · ${esc(c.category)}</small></span><b>${won(c.amount)}</b><button type="button" class="btn ghost small-btn" data-cand="${esc(c.key)}">넣기</button></li>`)
                    .join('')}</ul></div>`
                : '<p class="set-note">매입 장부에서 잔·집기는 <b>비품·집기</b>, 인테리어·장비는 <b>시설·장비</b>로 분류하면 여기서 바로 투자 항목으로 넣을 수 있어요.</p>'
            }
          </section>

          <section>
            <h3 class="set-title">판매량</h3>
            <div class="set-card set-pad ops-goal">
              <label>한 달 예상 판매 (잔·접시)<input name="monthlyGlasses" type="number" inputmode="numeric" value="${o.monthlyGlasses || ''}" placeholder="예: 1500"></label>
              <p class="set-note">판매량은 넉넉하지 않게(조금 적게) 잡는 게 안전해요. 손님이 적은 달에도 맞출 수 있게요.</p>
            </div>
          </section>

          <section class="ops-check" aria-live="polite"></section>

          <section>
            <h3 class="set-title">월 매출 <small>넣으면 실제 남은 돈·회수율</small></h3>
            <div class="set-card set-pad ops-goal">
              ${[ym, prevMonth(ym)]
                .map((m) => `<label>${ymLabel(m)} 매출 (원)<input data-sales="${m}" type="number" inputmode="numeric" value="${o.sales[m] || ''}" placeholder="포스·카드 매출 합계"></label>`)
                .join('')}
            </div>
            <div class="ops-actual" aria-live="polite"></div>
          </section>

          <div class="actions">
            <button type="button" class="btn ghost cancel">닫기</button>
            <button type="submit" class="btn primary">저장</button>
          </div>
        </form>`;

      const form = body.querySelector('form');
      const listEl = (k) => body.querySelector(`[data-list="${k}"]`);

      const drawLists = () => {
        listEl('fixed').innerHTML = o.fixed.length
          ? o.fixed
              .map(
                (f, i) => `<div class="ops-row" data-i="${i}" data-k="fixed">
                  <input data-f="name" value="${esc(f.name)}" placeholder="이름 (예: 월세)" aria-label="고정비 이름">
                  <input data-f="amount" type="number" inputmode="numeric" value="${f.amount || ''}" placeholder="금액" aria-label="월 금액">
                  <button type="button" class="icon-btn del" data-del aria-label="삭제">✕</button></div>`,
              )
              .join('')
          : '<p class="muted small">월세, 인건비, 전기·가스·수도, 통신·카드 수수료 같은 것을 넣어요.</p>';
        listEl('invests').innerHTML = o.invests.length
          ? o.invests
              .map((v, i) => {
                const p = investPlanned(v, ym);
                return `<div class="ops-inv" data-i="${i}" data-k="invests">
                  <div class="ops-row"><input data-f="name" value="${esc(v.name)}" placeholder="이름 (예: 인테리어)" aria-label="투자 이름"><button type="button" class="icon-btn del" data-del aria-label="삭제">✕</button></div>
                  ${
                    v.ongoing
                      ? `<div class="ops-row"><span>매달</span><input data-f="monthly" type="number" inputmode="numeric" value="${v.monthly || ''}" placeholder="월 금액" aria-label="월 금액"><span>원 (계속)</span></div>`
                      : `<div class="ops-row"><input data-f="amount" type="number" inputmode="numeric" value="${v.amount || ''}" placeholder="금액" aria-label="투자 금액"><span>원</span></div>
                      <div class="ops-row"><span>회수</span><input data-f="months" type="number" inputmode="numeric" value="${v.months}" aria-label="회수 개월" class="ops-months"><span>개월 · 시작</span><input data-f="start" type="month" value="${v.start}" aria-label="시작한 달"></div>
                      <p class="ops-prog"><span>월 ${won(investMonthly(v, ym))}</span><i><b style="width:${Math.round((p?.ratio || 0) * 100)}%"></b></i><small>${p ? (p.finished ? '회수 기간 끝' : `${p.done}/${p.months}개월 · 계획 ${Math.round(p.ratio * 100)}%`) : ''}</small></p>`
                  }
                </div>`;
              })
              .join('')
          : '<p class="muted small">인테리어, 냉장고·제빙기, 잔·집기처럼 한 번에 산 것을 넣어요.</p>';
      };

      // 계산 결과만 다시 그림 (입력 중 포커스 유지)
      const drawSummary = () => {
        const clean = sanitizeOps(o);
        const s = opsSummary(clean, ym);
        body.querySelector('.ops-sum').innerHTML = `
          <p class="ops-need"><span>한 달에 필요한 돈</span><b>${won(s.need)}</b></p>
          <p class="ops-sub">고정비 ${won(s.fixed)} · 투자 회수 ${won(s.invest)}</p>
          <p class="ops-per">${s.perGlass ? `잔당 최소 마진 <b>${won(s.perGlass)}</b> <small>(${won(s.need)} ÷ ${num(clean.monthlyGlasses)}잔)</small>` : '<small>아래 <b>한 달 예상 판매</b>를 넣으면 잔당 최소 마진을 계산해요.</small>'}</p>`;
        // 분류별 최소 마진 점검 (가게 전체 평균과 비교)
        const cats = store.menuCategories.filter((c) => store.menus.some((m) => (m.category || '') === c));
        body.querySelector('.ops-check').innerHTML = s.perGlass && cats.length
          ? `<h3 class="set-title">분류별 최소 마진 점검 <small>가게 평균 잔당 ${won(s.perGlass)}과 비교</small></h3>
             <div class="set-card list">${cats
               .map((c) => {
                 const v = store.minMarginOf(c);
                 const ok = v != null && v >= s.perGlass;
                 return `<div class="set-row ops-cat"><span class="grow">${esc(c)}<small>${v != null ? `지금 최소 마진 ${won(v)}` : '최소 마진 없음'}</small></span>${
                   ok ? '<b class="ok">✓ 충분</b>' : `<b class="warn">⚠ 부족</b><button type="button" class="btn ghost small-btn" data-raise="${esc(c)}">${num(s.perGlass)}원으로</button>`
                 }</div>`;
               })
               .join('')}</div>
             <p class="set-note">잔당 최소 마진은 <b>가게 전체 평균</b>이에요. 커피처럼 싼 메뉴는 조금 낮고 위스키처럼 비싼 메뉴가 더 남겨서 평균을 맞춰도 돼요. 올리면 메뉴 편집의 <b>잔 가격 추천</b>도 같이 올라가요.</p>`
          : '';
        // 월 매출 → 실제
        const a = actualRecovery(clean, store.purchases);
        body.querySelector('.ops-actual').innerHTML = a.rows.length
          ? `<div class="set-card set-pad"><ul class="ops-rows">${a.rows
              .slice(-6)
              .reverse()
              .map((r) => `<li><span class="grow">${ymLabel(r.ym)}<small>매출 ${won(r.sales)} − 매입 ${won(r.purchase)} − 고정비 ${won(r.fixed)}</small></span><b class="${r.left < 0 ? 'warn' : 'ok'}">${r.left < 0 ? '−' : ''}${won(Math.abs(r.left))}</b></li>`)
              .join('')}</ul>${
              a.total ? `<p class="ops-prog"><span>투자 실제 회수</span><i><b style="width:${Math.round((a.ratio || 0) * 100)}%"></b></i><small>${won(a.recovered)} / ${won(a.total)} · ${Math.round((a.ratio || 0) * 100)}%</small></p>` : ''
            }<p class="set-note">매입은 비품·시설 분류를 뺀 금액이에요(그건 투자 회수로 따로 셈). 남은 돈이 쌓이는 만큼 투자금이 실제로 회수돼요.</p></div>`
          : '';
      };

      drawLists();
      drawSummary();

      form.addEventListener('input', (e) => {
        const t = e.target;
        if (t.dataset.sales) {
          o.sales[t.dataset.sales] = Number(t.value) || 0;
        } else if (t.name === 'monthlyGlasses') {
          o[t.name] = Number(t.value) || 0;
        } else if (t.dataset.f) {
          const row = t.closest('[data-k]');
          const item = o[row.dataset.k][Number(row.dataset.i)];
          item[t.dataset.f] = ['name', 'start'].includes(t.dataset.f) ? t.value : Number(t.value) || 0;
        }
        drawSummary();
      });
      form.addEventListener('change', (e) => {
        if (e.target.dataset.f === 'months' || e.target.dataset.f === 'start' || e.target.dataset.f === 'amount') drawLists(), drawSummary();
      });
      body.addEventListener('click', (e) => {
        const add = e.target.closest('[data-add]');
        const del = e.target.closest('[data-del]');
        const cand = e.target.closest('[data-cand]');
        const raise = e.target.closest('[data-raise]');
        if (add) {
          const k = add.dataset.add;
          if (k === 'fixed') o.fixed.push({ id: uid(), name: '', amount: 0 });
          else o.invests.push({ id: uid(), name: k === 'ongoing' ? '잔 깨짐 보충' : '', amount: 0, months: 24, start: ym, ongoing: k === 'ongoing', monthly: 0, from: '' });
          drawLists();
          const list = listEl(k === 'fixed' ? 'fixed' : 'invests');
          list.lastElementChild?.querySelector('input')?.focus();
        } else if (del) {
          const row = del.closest('[data-k]');
          o[row.dataset.k].splice(Number(row.dataset.i), 1);
          drawLists();
          drawSummary();
        } else if (cand) {
          const c = investCandidates(store.purchases, o).find((x) => x.key === cand.dataset.cand);
          if (!c) return;
          o.invests.push({ id: uid(), name: c.name, amount: c.amount, months: DEFAULT_MONTHS[c.category] || 24, start: c.date.slice(0, 7), ongoing: false, monthly: 0, from: c.key });
          const card = cand.closest('.ops-cands');
          cand.closest('li').remove();
          if (!card.querySelector('li')) card.remove(); // 다 넣었으면 후보 칸도 치움
          drawLists();
          drawSummary();
          toast(`'${c.name}'을(를) 투자 항목에 넣었어요. 저장을 눌러 주세요.`);
        } else if (raise) {
          const s = opsSummary(sanitizeOps(o), ym);
          store.setMinMargins({ [raise.dataset.raise]: s.perGlass });
          toast(`${raise.dataset.raise} 최소 마진을 ${won(s.perGlass)}으로 올렸어요.`);
          drawSummary();
        }
      });
      body.querySelector('.cancel').addEventListener('click', close);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        store.saveOps(o);
        o = structuredClone(store.ops);
        toast('운영비를 저장했어요.');
        close();
      });
    },
  });
}
