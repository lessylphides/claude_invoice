// 운영자: 회원 관리 — 이메일로 찾기, 추가 인식 횟수 주기, 이용 정지/해제
import { auth } from '../auth.js';
import { esc, num } from '../lib/format.js';
import { openSheet, toast } from '../ui/sheet.js';

async function api(path, body) {
  const token = await auth.accessToken();
  const res = await fetch(`./api/admin/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message || `요청에 실패했어요 (${res.status})`);
  return data;
}

const day = (s) => (s ? new Date(s).toLocaleDateString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric' }) : '—');

function badges(u) {
  return [
    u.suspended ? '<span class="badge warn-badge">정지</span>' : '',
    u.plan ? `<span class="badge ok-badge">${esc(u.plan.name)}${u.plan.cancelAtPeriodEnd ? ' · 해지 예약' : ''}${u.plan.status === 'past_due' ? ' · 결제 실패' : ''}</span>` : '',
    !u.confirmed ? '<span class="badge">메일 미인증</span>' : '',
    u.bonus ? `<span class="badge">추가 ${num(u.bonus)}장</span>` : '',
  ].join(' ');
}

function row(u) {
  return `<button type="button" class="set-row" data-uid="${esc(u.id)}">
    <span class="grow"><span class="mem-email">${esc(u.email)}</span>
      <small>가입 ${day(u.created_at)} · 최근 접속 ${day(u.last_sign_in_at)} · 이번 달 인식 ${num(u.ocr_month)}장</small>
      <span class="mem-badges">${badges(u)}</span></span>
    <span class="chev" aria-hidden="true">›</span>
  </button>`;
}

/** 회원 한 명: 정보와 조치 */
function openMember(u, onChange) {
  openSheet({
    title: '회원 정보',
    render(body, close) {
      const draw = () => {
        body.innerHTML = `
          <div class="admin">
            <div class="set-card">
              <p class="mem-email big">${esc(u.email)}</p>
              <p class="mem-badges">${badges(u) || '<span class="badge">무료</span>'}</p>
              <p class="set-note">가입 ${day(u.created_at)} · 최근 접속 ${day(u.last_sign_in_at)} · 장부 ${u.has_ledger ? '있음' : '없음'}</p>
              <p class="set-note">영수증 인식: 이번 달 ${num(u.ocr_month)}장 · 지금까지 ${num(u.ocr_total)}장${u.plan ? ` · ${esc(u.plan.name)} 요금제 (다음 결제일 ${day(u.plan.periodEnd)})` : ''}</p>
              ${u.suspended ? `<p class="ci-advice">이용 정지 중${u.reason ? ` — 사유: ${esc(u.reason)}` : ''}</p>` : ''}
            </div>

            <section>
              <h3 class="set-title">추가 인식 횟수</h3>
              <div class="set-card">
                <p class="usage-title">남은 추가 인식 <b>${num(u.bonus)}장</b> <span class="muted small">(지금까지 준 합계 ${num(u.bonus_granted)}장)</span></p>
                <div class="btn-row">
                  <button type="button" class="btn ghost" data-bonus="10">+10</button>
                  <button type="button" class="btn ghost" data-bonus="30">+30</button>
                  <button type="button" class="btn ghost" data-bonus="100">+100</button>
                  <button type="button" class="btn ghost" data-bonus="custom">직접</button>
                </div>
                <p class="set-note">요금제·무료 체험 한도를 다 쓴 뒤부터 1장씩 줄어요. 하루 한도도 넘길 수 있어요. 빼려면 [직접]에 -10 처럼 넣으세요.</p>
              </div>
            </section>

            <section>
              <h3 class="set-title">이용 정지</h3>
              <div class="set-card">
                ${
                  u.suspended
                    ? '<button type="button" class="btn primary set-save" data-act="unsuspend">정지 해제</button>'
                    : '<button type="button" class="btn ghost set-save danger-text" data-act="suspend">이용 정지</button>'
                }
                <p class="set-note">정지하면 영수증 자동 인식·결제·장부 서버 저장이 막혀요. 장부 보기와 백업 파일 내보내기는 계속 돼요. 자동 결제는 따로 멈추지 않으니, 필요하면 토스페이먼츠 상점관리자에서 처리하세요.</p>
              </div>
            </section>
          </div>`;

        const act = async (btn, body, msg) => {
          btn.disabled = true;
          try {
            const r = await api(`users/${u.id}`, body);
            Object.assign(u, r.account);
            toast(msg, 3000);
            onChange();
            draw();
          } catch (e) {
            toast(e.message, 5000);
            btn.disabled = false;
          }
        };
        body.querySelectorAll('[data-bonus]').forEach((b) =>
          b.addEventListener('click', () => {
            let n = b.dataset.bonus === 'custom' ? Number(prompt('추가할 인식 횟수 (빼려면 -10 처럼)')) : Number(b.dataset.bonus);
            if (!Number.isInteger(n) || !n) return;
            act(b, { addBonus: n }, n > 0 ? `추가 인식 ${n}장을 줬어요.` : `추가 인식을 ${-n}장 뺐어요.`);
          }),
        );
        body.querySelector('[data-act=suspend]')?.addEventListener('click', (e) => {
          const reason = prompt(`${u.email} 계정을 정지할까요?\n사유를 적어 주세요 (손님 화면에 보여요).`);
          if (reason == null) return;
          act(e.currentTarget, { suspended: true, reason: reason.trim() }, '이용을 정지했어요.');
        });
        body.querySelector('[data-act=unsuspend]')?.addEventListener('click', (e) => {
          if (confirm(`${u.email} 계정의 정지를 풀까요?`)) act(e.currentTarget, { suspended: false }, '정지를 풀었어요.');
        });
      };
      draw();
    },
  });
}

export function openMembers() {
  openSheet({
    title: '회원 관리',
    render(body) {
      body.innerHTML = `
        <div class="admin">
          <form class="mem-search" role="search">
            <input type="search" name="q" placeholder="이메일로 찾기" aria-label="이메일로 찾기" autocomplete="off">
            <button class="btn primary small-btn" type="submit">찾기</button>
          </form>
          <div class="set-card list mem-list"><p class="set-pad muted small" role="status">불러오는 중…</p></div>
          <p class="set-note">최근 가입한 순서로 50명까지 보여요.</p>
        </div>`;
      const list = body.querySelector('.mem-list');
      let users = [];
      const paint = () => {
        list.innerHTML = users.length ? users.map(row).join('') : '<p class="set-pad muted small">찾는 회원이 없어요.</p>';
        list.querySelectorAll('[data-uid]').forEach((b) =>
          b.addEventListener('click', () => openMember(users.find((x) => x.id === b.dataset.uid), paint)),
        );
      };
      const load = async (q = '') => {
        try {
          users = (await api(`users?q=${encodeURIComponent(q)}`)).users;
          if (body.isConnected) paint();
        } catch (e) {
          if (body.isConnected) list.innerHTML = `<p class="set-pad warn small" role="alert">${esc(e.message)}</p>`;
        }
      };
      body.querySelector('.mem-search').addEventListener('submit', (e) => {
        e.preventDefault();
        load(e.target.elements.q.value.trim());
      });
      load();
    },
  });
}
