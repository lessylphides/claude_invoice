// 요금제 화면: 고르기 → 카드 등록(토스페이먼츠) → 첫 결제 / 바꾸기 · 해지 · 카드 변경
import { esc, num } from '../lib/format.js';
import { PLANS, PLAN_ORDER, TRIAL } from '../lib/plans.js';
import { openSheet, toast } from '../ui/sheet.js';
import { billing } from '../billing.js';
import { auth } from '../auth.js';

const won = (n) => `${num(n)}원`;
const md = (ms) => new Date(ms).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
const dayOfMonth = (ms) => new Date(ms).toLocaleDateString('ko-KR', { day: 'numeric' });
const limitText = (p) => (p.month == null ? `한 달 무제한 (하루 ${p.day}장까지)` : `한 달 ${num(p.month)}장 (하루 ${p.day}장)`);

/** 지금 구독 상태 한 줄 */
function currentBox(sub) {
  if (!sub || (sub.status !== 'active' && sub.status !== 'past_due')) return '';
  const p = PLANS[sub.plan];
  const card = sub.card?.number ? ` · ${esc(sub.card.company ?? '')} ${esc(sub.card.number)}` : '';
  let line;
  if (sub.status === 'past_due')
    line = `<b class="warn">결제에 실패했어요.</b> ${esc(sub.lastError ?? '')} 카드를 다시 등록하면 바로 결제돼요. (며칠 안에 결제되지 않으면 구독이 끝나요)`;
  else if (sub.cancelAtPeriodEnd) line = `<b>${md(sub.periodEnd)}</b>에 구독이 끝나요. 그때까지는 그대로 쓸 수 있어요.`;
  else if (sub.nextPlan) line = `다음 결제일 <b>${md(sub.periodEnd)}</b>부터 ${esc(PLANS[sub.nextPlan].name)} 요금제(${won(PLANS[sub.nextPlan].price)})로 바뀌어요.`;
  else line = `다음 결제일 <b>${md(sub.periodEnd)}</b> · ${won(p.price)}`;
  return `<div class="plan-current">
    <p><b>${esc(p.name)} 요금제</b> 이용 중${card}</p>
    <p class="small">${line}</p>
  </div>`;
}

function paymentsList(sub) {
  if (!sub?.payments?.length) return '';
  return `<h3 class="sub">결제 내역</h3>
    <ul class="pay-list">${sub.payments
      .map(
        (x) => `<li><span>${new Date(x.at).toLocaleDateString('ko-KR')} · ${esc(x.orderName)}</span><span>${won(x.amount)}${
          x.receipt ? ` <a href="${esc(x.receipt)}" target="_blank" rel="noopener">영수증</a>` : ''
        }</span></li>`,
      )
      .join('')}</ul>`;
}

function render(body, st, close) {
  const sub = st.subscription;
  const active = sub && (sub.status === 'active' || sub.status === 'past_due');
  const cur = active ? sub.plan : null;
  const pick = body.dataset.pick || (active ? sub.nextPlan || sub.plan : 'basic');
  const p = PLANS[pick];

  let action = '';
  let agree = '';
  if (!active) {
    agree = `<label class="agree"><input type="checkbox" name="agree"><span>매달 ${dayOfMonth(Date.now())}에 ${won(p.price)}이 등록한 카드로 자동 결제되는 것과 <a href="https://costnote.co.kr/terms" target="_blank" rel="noopener">이용약관</a>·<a href="https://costnote.co.kr/refund" target="_blank" rel="noopener">환불정책</a>에 동의합니다 (필수)</span></label>`;
    action = `<button class="btn primary" data-act="start">카드 등록하고 ${esc(p.name)} 시작 (월 ${won(p.price)})</button>`;
  } else if (pick !== cur) {
    const up = p.price > PLANS[cur].price;
    action = up
      ? `<button class="btn primary" data-act="change">지금 차액 ${won(p.price - PLANS[cur].price)} 결제하고 ${esc(p.name)} 요금제로 바꾸기</button>
         <p class="muted small">바로 적용되고, 결제일은 그대로예요. 다음 결제부터 월 ${won(p.price)}이에요.</p>`
      : `<button class="btn primary" data-act="change">다음 결제일부터 ${esc(p.name)} 요금제로 바꾸기</button>
         <p class="muted small">${md(sub.periodEnd)}까지는 지금 요금제를 그대로 써요.</p>`;
  } else if (sub.nextPlan && sub.nextPlan !== cur) {
    action = `<button class="btn ghost" data-act="change">요금제 변경 취소 (${esc(PLANS[cur].name)} 유지)</button>`;
  }

  const ent = st.entitlement;
  const trialLine =
    !active && ent.kind === 'trial'
      ? `<p class="small">무료 체험: 영수증 자동 인식 ${TRIAL.total}장 중 <b>${num(Math.min(st.usage?.total ?? 0, TRIAL.total))}장</b> 사용</p>`
      : '';

  body.innerHTML = `
    <div class="plans">
      ${st.mode === 'test' ? '<p class="plan-test">지금은 <b>시험 결제</b> 기간이에요. 카드를 등록해도 실제로 돈이 빠져나가지 않아요.</p>' : ''}
      ${currentBox(sub)}
      ${trialLine}
      <p class="muted small">장부·원가 계산·동기화는 모든 요금제가 같아요. 영수증 자동 인식 횟수만 달라요. 요금은 부가세 포함이에요.</p>
      <div class="plan-list" role="radiogroup" aria-label="요금제">
        ${PLAN_ORDER.map((id) => {
          const x = PLANS[id];
          const tags = [id === cur ? '이용 중' : '', active && id === sub.nextPlan && id !== cur ? '다음 결제일부터' : ''].filter(Boolean);
          return `<label class="plan-opt${id === pick ? ' on' : ''}">
            <input type="radio" name="plan" value="${id}"${id === pick ? ' checked' : ''}>
            <span class="plan-main"><b>${esc(x.name)}</b>${tags.map((t) => ` <span class="tag">${t}</span>`).join('')}<br><span class="small">${limitText(x)}</span><br><span class="small muted">${esc(x.hint)}</span></span>
            <span class="plan-price">${won(x.price)}<small>/월</small></span>
          </label>`;
        }).join('')}
      </div>
      ${agree}
      <p class="plan-err warn small" role="alert" hidden></p>
      <div class="btn-col">${action}</div>
      ${
        active
          ? `<div class="btn-row plan-manage">
               <button class="btn ghost" data-act="card">카드 ${sub.status === 'past_due' ? '다시 등록' : '변경'}</button>
               ${sub.cancelAtPeriodEnd ? '<button class="btn ghost" data-act="resume">해지 취소</button>' : '<button class="btn ghost" data-act="cancel">구독 해지</button>'}
             </div>`
          : ''
      }
      ${paymentsList(sub)}
      <p class="muted small">카드 정보는 토스페이먼츠 결제창에만 입력되고 코스트노트에는 저장되지 않아요. 환불은 <a href="https://costnote.co.kr/refund" target="_blank" rel="noopener">환불정책</a>을 따르며, 문의는 hanguk.soek@me.com 으로 해 주세요.</p>
    </div>`;

  const err = body.querySelector('.plan-err');
  const showErr = (m) => {
    err.textContent = m;
    err.hidden = false;
  };
  const busy = async (btn, fn) => {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    err.hidden = true;
    try {
      await fn();
    } catch (e) {
      showErr(e?.message || String(e));
    } finally {
      if (btn.isConnected) {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
      }
    }
  };
  const update = (next, msg) => {
    if (msg) toast(msg, 3500);
    Object.assign(st, next);
    if (body.isConnected) render(body, st, close);
  };

  body.querySelectorAll('input[name=plan]').forEach((r) =>
    r.addEventListener('change', () => {
      body.dataset.pick = r.value;
      render(body, st, close);
      body.querySelector('input[name=plan]:checked')?.focus();
    }),
  );
  body.querySelector('[data-act=start]')?.addEventListener('click', (e) =>
    busy(e.currentTarget, async () => {
      if (!body.querySelector('[name=agree]').checked) throw new Error('자동 결제와 약관·환불정책에 동의해 주세요.');
      await billing.registerCard({ plan: pick, customerKey: st.customerKey, email: auth.user?.email });
    }),
  );
  body.querySelector('[data-act=card]')?.addEventListener('click', (e) =>
    busy(e.currentTarget, () => billing.registerCard({ plan: cur, customerKey: st.customerKey, email: auth.user?.email })),
  );
  body.querySelector('[data-act=change]')?.addEventListener('click', (e) =>
    busy(e.currentTarget, async () => {
      const target = PLANS[pick];
      const up = target.price > PLANS[cur].price;
      if (up && !confirm(`${target.name} 요금제로 바꾸고 차액 ${won(target.price - PLANS[cur].price)}을 지금 결제할까요?`)) return;
      const next = await billing.change(pick);
      delete body.dataset.pick;
      update(
        next,
        pick === cur ? '요금제 변경을 취소했어요.' : up ? `${target.name} 요금제로 바꿨어요.` : `${md(sub.periodEnd)}부터 ${target.name} 요금제로 바뀌어요.`,
      );
    }),
  );
  body.querySelector('[data-act=cancel]')?.addEventListener('click', (e) =>
    busy(e.currentTarget, async () => {
      if (!confirm(`구독을 해지할까요?\n${md(sub.periodEnd)}까지는 그대로 쓸 수 있고, 그 뒤로는 결제되지 않아요. 장부는 지워지지 않아요.`)) return;
      update(await billing.cancel(), `해지했어요. ${md(sub.periodEnd)}까지 쓸 수 있어요.`);
    }),
  );
  body.querySelector('[data-act=resume]')?.addEventListener('click', (e) =>
    busy(e.currentTarget, async () => update(await billing.resume(), '해지를 취소했어요. 계속 이용해 주셔서 고마워요.')),
  );
}

/** @param {object} [known] 방금 받은 상태가 있으면 다시 묻지 않고 그대로 보여 줌 */
export function openPlans(known = null) {
  openSheet({
    title: '요금제',
    render(body, close) {
      body.innerHTML = '<p class="muted" role="status">불러오는 중…</p>';
      (known ? Promise.resolve(known) : billing.status()).then(
        (st) => body.isConnected && render(body, st, close),
        (e) => {
          if (body.isConnected) body.innerHTML = `<p class="warn" role="alert">${esc(e?.message || String(e))}</p>`;
        },
      );
    },
  });
}

/** 카드 등록창에서 돌아왔을 때 (로그인된 상태에서 한 번) */
export async function finishCardRegistration(ret) {
  if (ret.result !== 'success') {
    if (ret.code === 'PAY_PROCESS_CANCELED' || ret.code === 'USER_CANCEL') return toast('카드 등록을 취소했어요.');
    return toast(`카드를 등록하지 못했어요. ${ret.message ?? ''}`, 5000);
  }
  toast('결제하는 중…', 10000);
  let st = null;
  try {
    const before = await billing.status().catch(() => null);
    const wasActive = before?.subscription && ['active', 'past_due'].includes(before.subscription.status);
    st = await billing.subscribe(ret.plan, ret.authKey, ret.customerKey);
    const p = PLANS[st.subscription?.plan];
    toast(wasActive ? '카드를 바꿨어요.' : `${p?.name ?? ''} 요금제를 시작했어요. 고마워요!`, 5000);
  } catch (e) {
    toast(e?.message || String(e), 6000);
  }
  openPlans(st);
}
