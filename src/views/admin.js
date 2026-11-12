// 운영자 화면: 가입자 · 구독·매출 · 영수증 인식량·AI 비용 · 사용자별 인식량 분포 (운영자 계정에만 보임)
import { auth } from '../auth.js';
import { esc, num } from '../lib/format.js';
import { PLANS, PLAN_ORDER } from '../lib/plans.js';
import { openSheet, toast } from '../ui/sheet.js';
import { download } from '../ui/download.js';
import { openMembers } from './members.js';

const won = (n) => (n == null ? '—' : `${num(n)}원`);
const md = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

async function load() {
  const token = await auth.accessToken();
  const res = await fetch('./api/admin', { headers: { authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message || `불러오지 못했어요 (${res.status})`);
  return body;
}

const tile = (label, value, sub = '') =>
  `<div class="stat-tile"><span class="stat-label">${label}</span><b class="stat-value">${value}</b>${sub ? `<span class="stat-sub">${sub}</span>` : ''}</div>`;

/** 최근 30일 날짜별 인식 수 막대 (한 계열이라 범례 없음, 누르면 그날 숫자) */
function dailyChart(days) {
  const top = Math.max(...days.map((d) => d.count + d.failed));
  if (!top) return '<p class="set-note">최근 30일 동안 인식 기록이 아직 없어요.</p>';
  const max = top;
  const bars = days
    .map((d, i) => {
      const h = Math.round(((d.count + d.failed) / max) * 100);
      const label = `${md(d.date)} · 인식 ${d.count}장${d.failed ? ` · 실패 ${d.failed}` : ''} · AI 비용 약 ${num(d.costKrw)}원`;
      return `<button type="button" class="bar-hit" data-i="${i}" aria-label="${esc(label)}" data-label="${esc(label)}"><i style="height:${h}%"></i></button>`;
    })
    .join('');
  return `<div class="mini-chart">
    <p class="chart-readout" aria-live="polite">막대를 누르면 그날 숫자가 보여요</p>
    <div class="bars" role="group" aria-label="최근 30일 날짜별 영수증 인식 수">${bars}</div>
    <div class="bars-axis"><span>${md(days[0].date)}</span><span>최대 ${num(max)}장</span><span>${md(days.at(-1).date)}</span></div>
  </div>`;
}

const pct = (n) => `${Math.round(n * 100)}%`;

/** 인식 정확도 (모델별): 고치지 않은 비율과 항목별로 맞은 비율 */
function accuracyBlock(accuracy) {
  const models = Object.entries(accuracy || {}).filter(([, a]) => a.receipts);
  if (!models.length) return '<div class="set-card"><p class="set-note">아직 기록이 없어요. 손님이 인식 결과를 저장하면 쌓여요.</p></div>';
  return models
    .map(([model, a]) => {
      const saved = a.receipts - a.discarded;
      const kept = Math.max(0, a.items - a.itemsRemoved);
      const rows = saved
        ? [
            ['날짜', 1 - a.date / saved],
            ['거래처', 1 - a.vendor / saved],
            ['합계', 1 - a.total / saved],
            ...(kept
              ? [
                  ['품목 이름', 1 - a.name / kept],
                  ['단가·금액', 1 - a.price / kept],
                  ['수량', 1 - a.qty / kept],
                  ['분류', 1 - a.category / kept],
                ]
              : []),
          ]
        : [];
      return `<div class="set-card chart-card">
        <p class="usage-title"><b>${esc(model)}</b></p>
        <div class="stat-grid">
          ${tile('고치지 않고 저장', saved ? pct(a.untouched / saved) : '—', `저장 ${num(saved)}건 · 취소 ${num(a.discarded)}건`)}
          ${tile('품목 빠뜨림 · 잘못 넣음', `${num(a.itemsAdded)} · ${num(a.itemsRemoved)}`, `인식한 품목 ${num(a.items)}개 중`)}
        </div>
        <div class="hbars acc-bars">${rows
          .map(
            ([label, v]) =>
              `<div class="hbar-row"><span class="hbar-label">${label}</span><span class="hbar-track"><i style="width:${Math.round(Math.max(0, v) * 100)}%"></i></span><span class="hbar-val">${pct(Math.max(0, v))}</span></div>`,
          )
          .join('')}</div>
      </div>`;
    })
    .join('');
}

/** 사용자별 이번 달 인식량 분포 (가로 막대) */
function distChart(m) {
  const max = Math.max(1, ...m.buckets.map((b) => b.users));
  return `<div class="hbars">${m.buckets
    .map(
      (b) => `<div class="hbar-row"><span class="hbar-label">${b.label}</span><span class="hbar-track"><i style="width:${Math.round((b.users / max) * 100)}%"></i></span><span class="hbar-val">${num(b.users)}명</span></div>`,
    )
    .join('')}</div>`;
}

function render(body, s) {
  const u = s.users;
  const o = s.ocr;
  const b = s.billing;
  const models = Object.entries(o.models).map(([k, v]) => `${esc(k)} ${num(v)}회`).join(' · ') || '—';
  body.innerHTML = `
    <div class="admin">
      <div class="set-card list">
        <button type="button" class="set-row" data-act="members"><span class="set-ic" aria-hidden="true">👥</span><span class="grow">회원 관리<small>추가 인식 횟수 주기 · 이용 정지</small></span><span class="chev" aria-hidden="true">›</span></button>
      </div>
      <p class="muted small">결제 모드: <b>${s.mode === 'live' ? '실제 결제' : s.mode === 'test' ? '시험 결제' : '꺼짐'}</b> · 인식 모델 ${esc(s.model)} · 환율 1달러 ${num(s.fx)}원 기준</p>

      <section>
        <h3 class="set-title">가입자</h3>
        ${
          u
            ? `<div class="stat-grid">
                ${tile('전체 가입자', `${num(u.total)}명`, `메일 인증 ${num(u.confirmed)}명`)}
                ${tile('최근 7일 가입', `${num(u.new7)}명`, `30일 ${num(u.new30)}명`)}
                ${tile('7일 안에 접속', `${num(u.active7)}명`, `장부 저장 ${num(u.ledgers)}명`)}
                ${tile('30일 안에 인식 사용', `${num(u.ocrUsers30)}명`)}
              </div>`
            : '<p class="set-note">가입자 숫자를 보려면 Supabase 에서 admin.sql 을 한 번 실행해 주세요.</p>'
        }
      </section>

      <section>
        <h3 class="set-title">구독·매출</h3>
        <div class="stat-grid">
          ${tile('유료 구독', `${num(b.paying)}명`, PLAN_ORDER.map((id) => `${PLANS[id].name} ${b.byPlan[id]}`).join(' · '))}
          ${tile('월 반복 매출(MRR)', won(b.mrr), '해지 예약 제외, 부가세 포함')}
          ${tile('최근 30일 결제', won(b.paid30))}
          ${tile('해지 예약 · 결제 실패', `${num(b.canceling)} · ${num(b.pastDue)}`)}
        </div>
      </section>

      <section>
        <h3 class="set-title">영수증 인식 (최근 30일)</h3>
        <div class="stat-grid">
          ${tile('인식', `${num(o.count30)}장`, o.failed30 ? `실패 ${num(o.failed30)}회` : '실패 없음')}
          ${tile('AI 비용', won(o.costKrw30), '실패한 호출 포함')}
          ${tile('1장당 원가', won(o.perReceiptKrw), o.avgInput ? `평균 입력 ${num(o.avgInput)} · 출력 ${num(o.avgOutput)} 토큰` : '')}
          ${tile('이번 달 AI 비용', won(o.month.costKrw), `${num(o.month.count)}장`)}
        </div>
        <div class="set-card chart-card">${dailyChart(o.days)}</div>
        <p class="set-note">모델별 호출: ${models}</p>
      </section>

      <section>
        <h3 class="set-title">인식 정확도 (최근 30일)</h3>
        ${accuracyBlock(o.accuracy)}
        <p class="set-note">손님이 인식 결과를 저장할 때 고친 곳을 셌어요(내용은 모으지 않고 개수만). 항목별 %는 고치지 않은 비율이에요. 건수가 적으면 숫자가 크게 흔들려요.</p>
      </section>

      <section>
        <h3 class="set-title">이번 달 사용자별 인식량</h3>
        <div class="set-card chart-card">
          ${
            o.month.users
              ? `${distChart(o.month)}<p class="set-note">인식을 쓴 ${num(o.month.users)}명 · 평균 ${num(Math.round(o.month.avg))}장 · 가운데 값 ${num(o.month.median)}장 · 최대 ${num(o.month.max)}장</p>`
              : '<p class="set-note">이번 달에는 아직 인식 기록이 없어요.</p>'
          }
        </div>
      </section>

      <section>
        <h3 class="set-title">최근 결제</h3>
        <div class="set-card list">${
          b.payments.length
            ? b.payments
                .map(
                  (p, i) => `<button type="button" class="set-row" data-pay="${i}"><span class="grow">${esc(p.orderName)}<small>${new Date(p.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${esc(p.email ?? '')}${
                    p.mode !== 'live' ? ' · 시험 결제' : ''
                  }</small></span><b>${won(p.amount)}${p.canceled ? `<small class="refunded">${p.canceled >= p.amount ? '전액 환불' : `환불 ${won(p.canceled)}`}</small>` : ''}</b><span class="chev" aria-hidden="true">›</span></button>`,
                )
                .join('')
            : '<p class="set-pad muted small">아직 결제가 없어요.</p>'
        }</div>
      </section>
      <section>
        <h3 class="set-title">장부 백업 (매일, 14일 보관)</h3>
        <div class="set-card list">${
          s.backups?.length
            ? s.backups
                .map(
                  (x) => `<button type="button" class="set-row" data-backup="${esc(x.date)}"><span class="grow">${esc(x.date)}<small>${x.users != null ? `장부 ${num(x.users)}개 · ${num(Math.ceil((x.bytes ?? 0) / 1024))}KB (압축·암호화)` : ''}</small></span><span class="chev" aria-hidden="true">↓</span></button>`,
                )
                .join('')
            : '<p class="set-pad muted small">아직 백업이 없어요. 매일 오전 10시쯤 자동으로 만들어져요.</p>'
        }</div>
        <button type="button" class="btn ghost set-save backup-now">지금 백업하기</button>
        <p class="set-note">날짜를 누르면 그날 모든 장부를 내려받아요(개인 정보가 들어 있으니 안전한 곳에만 보관하세요). 손님 장부를 되살릴 때 써요.</p>
      </section>

      <p class="set-foot">AI 비용은 공식 가격표와 실제 사용 토큰으로 계산한 추정치예요. 정확한 청구액은 Anthropic Console 에서 확인하세요.</p>
    </div>`;

  body.querySelector('[data-act=members]').addEventListener('click', openMembers);
  body.querySelectorAll('[data-pay]').forEach((btn) =>
    btn.addEventListener('click', () => openRefund(s.billing.payments[Number(btn.dataset.pay)], s.mode, async () => body.isConnected && render(body, await load()))),
  );
  body.querySelectorAll('[data-backup]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const date = btn.dataset.backup;
      btn.disabled = true;
      try {
        const token = await auth.accessToken();
        const res = await fetch(`./api/admin/backup?date=${encodeURIComponent(date)}`, { headers: { authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message || `내려받지 못했어요 (${res.status})`);
        download(`costnote-backup-${date}.json`, await res.text(), 'application/json');
      } catch (e) {
        toast(e.message, 4000);
      } finally {
        btn.disabled = false;
      }
    }),
  );

  body.querySelector('.backup-now')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '백업하는 중…';
    try {
      const token = await auth.accessToken();
      const res = await fetch('./api/admin/backup-now', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
      const r = await res.json().catch(() => null);
      if (!res.ok) throw new Error(r?.error?.message || `백업하지 못했어요 (${res.status})`);
      toast(`백업했어요: 장부 ${num(r.users)}개 · ${num(Math.ceil(r.bytes / 1024))}KB`, 4000);
      render(body, await load());
    } catch (err) {
      toast(err.message, 6000);
      btn.disabled = false;
      btn.textContent = '지금 백업하기';
    }
  });

  const readout = body.querySelector('.chart-readout');
  const show = (btn) => {
    body.querySelectorAll('.bar-hit.on').forEach((x) => x.classList.remove('on'));
    btn.classList.add('on');
    readout.textContent = btn.dataset.label;
  };
  body.querySelectorAll('.bar-hit').forEach((btn) => {
    btn.addEventListener('click', () => show(btn));
    btn.addEventListener('mouseenter', () => show(btn));
    btn.addEventListener('focus', () => show(btn));
  });
}

/** 결제 한 건: 자세히 보기 + 환불 (전액·일부, 구독 종료 함께) */
function openRefund(p, mode, onDone) {
  const left = p.amount - (p.canceled || 0);
  const plan = PLAN_ORDER.map((id) => PLANS[id]).find((x) => p.orderName?.includes(x.name));
  // 환불정책: 사용했으면 결제 금액 − 사용 횟수 × 1회당 금액 (무제한은 프로와 같이 계산)
  const perUnit = plan ? Math.round(plan.price / (plan.month || PLANS.pro.month)) : null;
  const canRefund = p.paymentKey && left > 0 && (p.mode === 'live') === (mode === 'live');
  openSheet({
    title: '결제 자세히',
    render(body, close) {
      body.innerHTML = `
        <div class="set-card list">
          <div class="set-row static"><span class="grow">${esc(p.orderName)}<small>${new Date(p.at).toLocaleString('ko-KR')}</small></span><b>${won(p.amount)}</b></div>
          <div class="set-row static"><span class="grow">손님</span><span>${esc(p.email ?? '')}</span></div>
          ${p.card ? `<div class="set-row static"><span class="grow">카드</span><span>${esc(p.card.company ?? '')} ${esc(p.card.number ?? '')}</span></div>` : ''}
          ${p.canceled ? `<div class="set-row static"><span class="grow">환불한 금액</span><b class="warn">${won(p.canceled)}</b></div>` : ''}
          ${p.receipt ? `<a class="set-row" href="${esc(p.receipt)}" target="_blank" rel="noopener"><span class="grow">카드 영수증 보기</span><span class="chev" aria-hidden="true">›</span></a>` : ''}
        </div>
        ${
          canRefund
            ? `<form class="settings refund-form" novalidate>
          <h3 class="set-title" style="margin-top:16px">환불</h3>
          ${perUnit ? `<p class="set-note">환불정책: 7일 이내 · 인식을 안 썼으면 전액, 썼으면 <b>결제 금액 − 사용 횟수 × ${won(perUnit)}</b></p>
          <label>사용한 인식 횟수 (계산용)<input name="used" type="number" inputmode="numeric" min="0" placeholder="0"></label>` : ''}
          <label>환불 금액 (원) <small>남은 금액 ${won(left)}</small><input name="amount" type="number" inputmode="numeric" min="1" max="${left}" value="${left}" required></label>
          <label>사유 (손님 카드사·토스에 남아요)<input name="reason" maxlength="200" value="고객 요청 환불"></label>
          <label class="check"><input type="checkbox" name="endSub" ${p.subStatus === 'active' || p.subStatus === 'past_due' ? 'checked' : 'disabled'}> 구독도 바로 종료 (다음 달 자동 결제 안 함)</label>
          <button type="submit" class="btn primary">환불하기</button>
          <p class="set-note">토스페이먼츠로 바로 취소 요청이 가고, 손님에게 환불 안내 메일이 가요. 카드사 반영은 3~7영업일이 걸릴 수 있어요.</p>
        </form>`
            : `<p class="set-note" style="margin-top:12px">${
                left <= 0 ? '이미 전액 환불한 결제예요.' : !p.paymentKey ? '결제 키가 없어 앱에서 환불할 수 없어요. 토스 상점관리자에서 취소해 주세요.' : '시험 결제(테스트 키)라 지금 결제 서버에서는 환불할 수 없어요.'
              }</p>`
        }`;
      const form = body.querySelector('.refund-form');
      if (!form) return;
      form.used?.addEventListener('input', () => {
        const n = Math.max(0, Math.round(Number(form.used.value) || 0));
        form.amount.value = Math.max(0, Math.min(left, p.amount - n * perUnit - (p.canceled || 0)));
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const amount = Math.round(Number(form.amount.value));
        if (!(amount > 0 && amount <= left)) return toast(`환불 금액은 1원 ~ ${won(left)} 사이로 넣어 주세요.`);
        if (!confirm(`${p.email ?? '손님'}에게 ${won(amount)}을 환불할까요?${form.endSub.checked ? '\n구독도 바로 종료돼요.' : ''}`)) return;
        const btn = form.querySelector('[type=submit]');
        btn.disabled = true;
        btn.textContent = '환불하는 중…';
        try {
          const token = await auth.accessToken();
          const res = await fetch('./api/admin/refund', {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ uid: p.uid, paymentKey: p.paymentKey, amount, reason: form.reason.value, endSub: form.endSub.checked }),
          });
          const r = await res.json().catch(() => null);
          if (!res.ok) throw new Error(r?.error?.message || `환불하지 못했어요 (${res.status})`);
          toast(`${won(r.amount)} 환불했어요.${r.ended ? ' 구독도 종료했어요.' : ''}`, 4000);
          close();
          onDone();
        } catch (err) {
          toast(err.message, 6000);
          btn.disabled = false;
          btn.textContent = '환불하기';
        }
      });
    },
  });
}

export function openAdmin() {
  openSheet({
    title: '운영 현황',
    render(body) {
      body.innerHTML = '<p class="muted" role="status">불러오는 중…</p>';
      load().then(
        (s) => body.isConnected && render(body, s),
        (e) => body.isConnected && (body.innerHTML = `<p class="warn" role="alert">${esc(e.message)}</p>`),
      );
    },
  });
}
