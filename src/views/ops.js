// 원가 탭 → 운영비 · 투자 회수
// 고정비·투자 항목을 넣으면 '본전 매출'(한 달·하루)을 계산: 필요한 돈 ÷ (1 − 평균 원가율)
// 잔·접시 수가 아닌 돈으로 계산해 커피숍·바·식당 어디든 맞음
// 월 매출(운영자만)을 넣으면 실제 남은 돈과 투자금 실제 회수율도
import { esc, num, uid, todayStr } from '../lib/format.js';
import { openSheet, toast } from '../ui/sheet.js';
import { store } from '../store.js';
import { opsSummary, investMonthly, investPlanned, actualRecovery, investCandidates, monthPurchaseCost, averageCostRate, breakEven, exemptShareFromLedger, guessVat, DEFAULT_MONTHS, sanitizeOps } from '../lib/ops.js';
import { menuCost } from '../lib/cost.js';
import { openSalesImport, openSalesLinks, salesAnalysisHtml } from './salesImport.js';
import { billing } from '../billing.js';

const won = (n) => `${num(n)}원`;
const thisMonth = () => todayStr().slice(0, 7);
const ymLabel = (ym) => `${Number(ym.slice(0, 4))}년 ${Number(ym.slice(5, 7))}월`;
const prevMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

/** 가게 평균 원가율 (메뉴 3개 이상이면 메뉴 평균, 아니면 목표 원가율) */
export const shopCostRate = () => averageCostRate(store.menus.map((m) => menuCost(m, store.index).rate), store.costTarget.value);

/** 원가 탭에 보이는 한 줄 요약 */
export function opsLine() {
  const o = store.ops;
  const s = opsSummary(o, thisMonth());
  const be = breakEven(s, shopCostRate().rate, o);
  const text = s.need
    ? `운영비: 한 달 <b>${won(s.need)}</b>${be ? ` · 본전 매출 하루 <b>${won(be.day)}</b>` : ''}`
    : '운영비·투자 회수: 아직 안 넣음 <span class="muted">(월세·인테리어·잔 등을 마진으로 회수하는 계산)</span>';
  return `<section class="ops-line"><p>${text}</p><button class="btn ghost small-btn" data-cost="ops">운영비</button></section>`;
}

export function openOps() {
  let o = structuredClone(store.ops);
  for (const f of o.fixed) f.vatSet = !!f.name; // 이미 넣어 둔 고정비의 부가세 공제 선택은 이름을 고쳐도 그대로
  const ym = thisMonth();
  openSheet({
    title: '운영비 · 투자 회수',
    render(body, close) {
      const cands = investCandidates(store.purchases, o);
      body.innerHTML = `
        <form class="ops" novalidate>
          <section class="set-card set-pad ops-sum" aria-live="polite"></section>

          <section>
            <h3 class="set-title">고정비 <small>매출과 상관없이 매달 나가는 돈</small></h3>
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
            <h3 class="set-title">계산 기준 <small>매출에 따라 빠지는 돈</small></h3>
            <div class="set-card set-pad ops-goal ops-basis">
              <label>한 달 영업일 (일)<input name="workDays" type="number" inputmode="numeric" min="1" max="31" value="${o.workDays || 26}"></label>
              <label>카드·간편결제 수수료 (매출의 %)<input name="feeRate" type="number" inputmode="decimal" step="0.1" min="0" max="10" value="${o.feeRate ?? 2}"></label>
              <label>매출 중 카드·간편결제 비율 (%)<input name="cardShare" type="number" inputmode="numeric" min="0" max="100" value="${o.cardShare ?? 90}"></label>
              <label>재료 매입 중 면세 품목 비율 (%) <small>과일·채소·생고기 등 부가세 없는 것</small><input name="exemptShare" type="number" inputmode="numeric" min="0" max="100" value="${o.exemptShare ?? 0}"></label>
              <p class="set-note ops-exempt-hint"></p>
              <p class="set-note">일반과세자 기준이에요. 부가세는 <b>(매출 − 부가세 공제되는 매입·고정비) × 10/110</b>에서 카드 매출 공제(1.3%)를 뺀 추정이에요. 실제 신고액은 세무사 계산과 다를 수 있어요.</p>
            </div>
          </section>

          <section class="ops-sales" hidden>
            <h3 class="set-title">월 매출 <small>운영자 시험 기능 · 넣으면 실제 남은 돈·회수율</small></h3>
            <button type="button" class="btn ghost si-open" data-import>📄 포스·네이버 파일로 불러오기</button>
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
                (f, i) => `<div class="ops-fix" data-i="${i}" data-k="fixed"><div class="ops-row">
                  <input data-f="name" value="${esc(f.name)}" placeholder="이름 (예: 월세)" aria-label="고정비 이름">
                  <input data-f="amount" type="number" inputmode="numeric" value="${f.amount || ''}" placeholder="금액" aria-label="월 금액">
                  <button type="button" class="icon-btn del" data-del aria-label="삭제">✕</button></div>
                  <label class="ops-vat"><input type="checkbox" data-f="vat"${f.vat !== false ? ' checked' : ''}> 부가세 공제 받음 <small>(세금계산서·카드 결제)</small></label></div>`,
              )
              .join('')
          : '<p class="muted small">월세, 인건비(사장님 몫 포함), 전기·가스·수도, 통신·포스 이용료, 광고비, 세무사 비용 같은 것을 넣어요.</p>';
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
        const cr = shopCostRate();
        const be = breakEven(s, cr.rate, clean);
        body.querySelector('.ops-sum').innerHTML = `
          <p class="ops-need"><span>매달 고정으로 나가는 돈</span><b>${won(s.need)}</b></p>
          <p class="ops-sub">고정비 ${won(s.fixed)} · 투자 회수 ${won(s.invest)}</p>
          ${
            be
              ? `<div class="ops-per ops-be"><p class="ops-be-h">본전 매출 <small>최소 이만큼은 팔아야 해요</small></p>
                 <p>한 달 <b>${won(be.month)}</b> · 하루 <b>${won(be.day)}</b> <small>(${clean.workDays}일 영업)</small></p>
                 <ul class="ops-rows ops-be-parts">
                   <li><span class="grow">재료비<small>평균 원가율 ${cr.rate}% · ${cr.from === 'menus' ? `메뉴 ${cr.count}개 평균` : '메뉴가 적어서 목표 원가율'}</small></span><b>${won(be.material)}</b></li>
                   <li><span class="grow">부가세 (낼 것 추정)<small>남긴 부분에만 붙고 카드 매출 공제 뺌</small></span><b>${won(be.vat)}</b></li>
                   <li><span class="grow">결제 수수료<small>매출의 ${clean.feeRate}%</small></span><b>${won(be.fee)}</b></li>
                   <li><span class="grow">매달 고정으로 나가는 돈</span><b>${won(be.fixed)}</b></li>
                 </ul></div>`
              : '<p class="ops-per"><small>고정비나 투자 항목을 넣으면 <b>본전 매출</b>(한 달·하루)을 계산해요.</small></p>'
          }`;
        const ex = exemptShareFromLedger(store.purchases, ym);
        const hint = body.querySelector('.ops-exempt-hint');
        hint.innerHTML = ex != null && ex !== clean.exemptShare ? `장부 기준(최근 3달) 면세로 보이는 재료는 약 <b>${ex}%</b>예요. <button type="button" class="btn ghost small-btn" data-exempt="${ex}">${ex}%로</button>` : '';
        // 월 매출 → 실제
        const a = actualRecovery(clean, store.purchases);
        body.querySelector('.ops-actual').innerHTML = salesAnalysisHtml(clean, (m) => monthPurchaseCost(store.purchases, m)) + (a.rows.length
          ? `<div class="set-card set-pad"><ul class="ops-rows">${a.rows
              .slice(-6)
              .reverse()
              .map((r) => {
                const gap = be ? r.sales - be.month : null;
                return `<li><span class="grow">${ymLabel(r.ym)}<small>매출 ${won(r.sales)} − 매입 ${won(r.purchase)} − 고정비 ${won(r.fixed)}${r.opex ? ` − 광고·운영비 ${won(r.opex)}` : ''}</small>${
                  gap != null ? `<small class="${gap < 0 ? 'warn' : 'ok'}">본전 매출보다 ${won(Math.abs(gap))} ${gap < 0 ? '덜' : '더'} 팔았어요</small>` : ''
                }</span><b class="${r.left < 0 ? 'warn' : 'ok'}">${r.left < 0 ? '−' : ''}${won(Math.abs(r.left))}</b></li>`;
              })
              .join('')}</ul>${
              a.total ? `<p class="ops-prog"><span>투자 실제 회수</span><i><b style="width:${Math.round((a.ratio || 0) * 100)}%"></b></i><small>${won(a.recovered)} / ${won(a.total)} · ${Math.round((a.ratio || 0) * 100)}%</small></p>` : ''
            }<p class="set-note">매입은 비품·시설·광고 분류를 뺀 재료 금액이에요(투자는 회수로, 광고는 운영비로 따로 셈). 남은 돈이 쌓이는 만큼 투자금이 실제로 회수돼요.</p></div>`
          : '');
      };

      drawLists();
      drawSummary();
      // 월 매출(판매 파일 불러오기)은 포스마다 형식이 달라 아직 운영자만 다듬는 중 → 운영자 계정에서만 보임
      billing
        .status()
        .then((st) => {
          if (st?.owner && body.isConnected) body.querySelector('.ops-sales').hidden = false;
        })
        .catch(() => {});

      form.addEventListener('input', (e) => {
        const t = e.target;
        if (t.dataset.sales) {
          o.sales[t.dataset.sales] = Number(t.value) || 0;
        } else if (['workDays', 'feeRate', 'cardShare', 'exemptShare'].includes(t.name)) {
          o[t.name] = t.value === '' ? undefined : Number(t.value);
        } else if (t.dataset.f) {
          const row = t.closest('[data-k]');
          const item = o[row.dataset.k][Number(row.dataset.i)];
          item[t.dataset.f] = t.dataset.f === 'vat' ? t.checked : ['name', 'start'].includes(t.dataset.f) ? t.value : Number(t.value) || 0;
          if (t.dataset.f === 'vat') item.vatSet = true;
          // 고정비 이름을 쓰면 부가세 공제 여부를 짐작 (인건비·보험 등은 공제 없음). 직접 고른 뒤엔 그대로
          if (row.dataset.k === 'fixed' && t.dataset.f === 'name' && !item.vatSet) {
            item.vat = guessVat(t.value);
            const cb = row.querySelector('[data-f=vat]');
            if (cb) cb.checked = item.vat;
          }
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
        const imp = e.target.closest('[data-import]');
        const linksBtn = e.target.closest('[data-links]');
        if (linksBtn) {
          const m = linksBtn.dataset.links;
          openSalesLinks({
            ym: m,
            month: sanitizeOps(o).salesMonths[m],
            links: o.salesLinks || {},
            onDone: (links) => {
              o.salesLinks = links;
              store.saveOps({ salesLinks: links });
              drawSummary();
            },
          });
          return;
        }
        const exBtn = e.target.closest('[data-exempt]');
        if (exBtn) {
          o.exemptShare = Number(exBtn.dataset.exempt);
          form.elements.exemptShare.value = o.exemptShare;
          drawSummary();
          return;
        }
        if (imp) {
          openSalesImport({
            links: o.salesLinks || {},
            dayStart: o.dayStart ?? 6,
            onDone: ({ ym: m, month, links, dayStart }) => {
              o.sales[m] = month.sales;
              o.salesMonths = { ...(o.salesMonths || {}), [m]: month };
              o.salesLinks = links;
              o.dayStart = dayStart;
              // 불러온 판매는 바로 저장 (운영비 화면의 다른 입력은 그대로 둠)
              const cur = store.ops;
              store.saveOps({ sales: { ...cur.sales, [m]: month.sales }, salesMonths: o.salesMonths, salesLinks: links, dayStart });
              const inp = body.querySelector(`[data-sales="${m}"]`);
              if (inp) inp.value = month.sales;
              drawSummary();
            },
          });
          return;
        }
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
