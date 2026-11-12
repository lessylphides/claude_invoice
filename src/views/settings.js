// 설정: 계정·동기화, 요금제·인식 사용량, CSV 내보내기, 백업/복원, 탈퇴 (매입 품목 분류는 매입 탭 → 항목별)
import { dotDate, esc, num, todayStr } from '../lib/format.js';
import { purchasesCsv } from '../lib/csv.js';
import { daysBetween } from '../lib/backup.js';
import { download } from '../ui/download.js';
import { openSheet, toast } from '../ui/sheet.js';
import { storageInfo } from '../persist.js';
import { store } from '../store.js';
import { monthKey } from '../state.js';
import { monthPurchases, backupNow } from './purchase.js';
import { auth } from '../auth.js';
import { setAuthNotice } from './authScreen.js';
import { sync } from '../sync.js';
import { billing } from '../billing.js';
import { PLANS } from '../lib/plans.js';
import { openPlans } from './plans.js';
import { openAdmin } from './admin.js';
import { openClaudeConnect, disconnectClaude } from './claude.js';

function syncLine() {
  const t = sync.syncedAt ? new Date(sync.syncedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
  const map = {
    syncing: '서버에 저장하는 중…',
    offline: '<b class="warn">인터넷 연결이 없어 이 기기에만 저장됨</b> (연결되면 자동으로 올림)',
    error: '<b class="warn">서버 저장에 실패했어요</b> — [지금 동기화]로 다시 시도해 주세요',
    conflict: '<b class="warn">다른 기기와 내용이 달라요</b> — [지금 동기화]를 눌러 고르세요',
    blocked: '<b class="warn">이용이 정지된 계정이라 서버에 저장할 수 없어요</b> (이 기기에는 저장됨)',
  };
  return map[sync.status] ?? (sync.dirty ? '서버에 올릴 변경이 있어요' : t ? `서버에 저장됨 · ${t}` : '서버와 맞추는 중…');
}

/** 사용량 막대 하나 */
function meter(label, used, max) {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const full = max && used >= max;
  return `<div class="meter${full ? ' full' : ''}">
    <div class="meter-top"><span>${label}</span><span><b>${num(used)}</b>${max ? ` / ${num(max)}회` : '회'}</span></div>
    ${max ? `<div class="meter-bar" aria-hidden="true"><i style="width:${pct}%"></i></div>` : ''}
  </div>`;
}

/** 요금제·영수증 인식 사용량 */
async function showOcrUsage(el, planBtn, adminSec) {
  try {
    const st = await billing.status();
    if (!el.isConnected) return;
    const { entitlement: e, usage: u, subscription: sub, mode } = st;
    let title;
    let meters;
    if (e.kind === 'plan') {
      const p = PLANS[e.plan];
      const badge =
        sub?.status === 'past_due'
          ? '<span class="badge warn-badge">결제 실패 — 카드를 다시 등록해 주세요</span>'
          : sub?.cancelAtPeriodEnd
            ? '<span class="badge">해지 예약됨</span>'
            : '<span class="badge ok-badge">이용 중</span>';
      title = `<b>${esc(p.name)} 요금제</b> ${badge}`;
      meters = meter('오늘', u.day, e.day) + meter('이번 결제 기간', u.period, p.month);
    } else if (e.kind === 'trial') {
      title = '<b>무료 체험</b> <span class="badge">영수증 자동 인식 20장</span>';
      meters = meter('무료 체험', Math.min(u.total, e.total), e.total) + meter('오늘', u.day, e.day);
    } else {
      title = e.kind === 'owner' ? '<b>운영자 계정</b> <span class="badge ok-badge">인식 제한 없음</span>' : '<b>시범 운영</b>';
      meters = meter('오늘', u.day, e.day) + meter('이번 달', u.month, e.month);
    }
    const acc = u.account ?? {};
    if (acc.suspended) {
      title = '<b class="warn">이용 정지</b>';
      meters = `<p class="ci-advice">이용이 정지된 계정이에요.${acc.reason ? ` 사유: ${esc(acc.reason)}` : ''} 문의: hanguk.soek@me.com</p>`;
    } else if (acc.bonus) meters += `<p class="set-note">추가 인식 <b>${num(acc.bonus)}장</b> 남음 (한도를 다 쓰면 여기서 써요)</p>`;
    if (!acc.suspended && st.levelGift && !st.levelGift.usable && st.levelGift.balance)
      meters += `<p class="set-note">🎁 레벨업 선물 <b>${num(st.levelGift.balance)}장</b>이 쌓여 있어요. 구독하면 바로 쓸 수 있어요.</p>`;
    el.innerHTML = `<p class="usage-title">${title}</p>${meters}`;
    if (mode !== 'off' && planBtn && !st.owner) planBtn.hidden = false; // 운영자는 자가 결제 금지라 구독 화면 없음
    if (st.owner && adminSec) adminSec.hidden = false;
  } catch {
    if (el.isConnected) el.textContent = '사용량을 불러오지 못했어요.';
  }
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

function backupLine() {
  const last = store.settings.lastBackupAt;
  if (!last) return '마지막 백업: <b class="warn">아직 없음</b>';
  const days = daysBetween(last, todayStr());
  return `마지막 백업: <b>${dotDate(last)}</b> (${days > 0 ? `${days}일 전` : '오늘'})`;
}

export function openSettings() {
  openSheet({
    title: '설정',
    render(body, close) {
      const s = store.settings;
      body.innerHTML = `
        <form class="settings">
          <section class="admin-sec" hidden>
            <h3 class="set-title">운영자</h3>
            <div class="set-card list">
              <button type="button" class="set-row" data-act="admin"><span class="set-ic" aria-hidden="true">📈</span><span class="grow">운영 현황<small>가입자 · 구독·매출 · 인식량·AI 비용</small></span><span class="chev" aria-hidden="true">›</span></button>
            </div>
          </section>

          <section>
            <h3 class="set-title">계정</h3>
            <div class="set-card">
              <div class="set-account">
                <span class="avatar" aria-hidden="true">${esc((auth.user?.email ?? '?').slice(0, 1).toUpperCase())}</span>
                <div class="set-account-text">
                  <b class="account-email">${esc(auth.user?.email ?? '')}</b>
                  <span class="small sync-line">${syncLine()}</span>
                </div>
              </div>
              <div class="set-actions">
                <button type="button" class="btn ghost small-btn" data-act="sync-now">지금 동기화</button>
                <button type="button" class="btn ghost small-btn" data-act="logout">로그아웃</button>
              </div>
            </div>
            <p class="set-note">장부는 계정에 저장되어 다른 기기에서 로그인해도 볼 수 있어요.</p>
          </section>

          <section>
            <h3 class="set-title">영수증 자동 인식</h3>
            <div class="set-card list">
              <div class="set-pad ocr-usage" aria-live="polite">사용량 확인 중…</div>
              <button type="button" class="set-row" data-act="plans" hidden><span class="set-ic" aria-hidden="true">💳</span><span class="grow">요금제 관리</span><span class="chev" aria-hidden="true">›</span></button>
            </div>
            <p class="set-note">사진은 코스트노트 서버를 거쳐 Claude 가 읽고, 인식이 끝나면 서버에 남기지 않아요.</p>
          </section>

          <section>
            <h3 class="set-title">AI 상담</h3>
            <div class="set-card list">
              <button type="button" class="set-row" data-act="claude"><span class="set-ic" aria-hidden="true">🤖</span><span class="grow">클로드 연결<small>클로드 앱에서 원가·판매가 상담 · 바꾼 기록</small></span><span class="chev" aria-hidden="true">›</span></button>
            </div>
          </section>

          <section>
            <h3 class="set-title">데이터</h3>
            <div class="set-card list">
              <button class="set-row" type="button" data-act="csv"><span class="set-ic" aria-hidden="true">📄</span><span class="grow">이번 달 CSV 내보내기<small>엑셀에서 열 수 있어요</small></span><span class="chev" aria-hidden="true">›</span></button>
              <button class="set-row" type="button" data-act="backup"><span class="set-ic" aria-hidden="true">💾</span><span class="grow">전체 백업 파일 저장<small class="backup-line">${backupLine()}</small></span><span class="chev" aria-hidden="true">›</span></button>
              <button class="set-row" type="button" data-act="restore"><span class="set-ic" aria-hidden="true">📂</span><span class="grow">백업 파일 불러오기<small>지금 장부를 백업 파일 내용으로 바꿔요</small></span><span class="chev" aria-hidden="true">›</span></button>
            </div>
            <input type="file" accept="application/json,.json" hidden class="restore-file">
            <p class="set-note storage-line">매입 ${num(store.purchases.length)}건 · 메뉴 ${num(store.menus.length)}개</p>
          </section>

          <section>
            <h3 class="set-title">약관·탈퇴</h3>
            <div class="set-card list">
              <a class="set-row" href="https://costnote.co.kr/terms" target="_blank" rel="noopener"><span class="grow">이용약관</span><span class="chev" aria-hidden="true">↗</span></a>
              <a class="set-row" href="https://costnote.co.kr/privacy" target="_blank" rel="noopener"><span class="grow">개인정보처리방침</span><span class="chev" aria-hidden="true">↗</span></a>
              <a class="set-row" href="https://costnote.co.kr/refund" target="_blank" rel="noopener"><span class="grow">환불정책</span><span class="chev" aria-hidden="true">↗</span></a>
              <button class="set-row danger" type="button" data-act="delete-account"><span class="grow">회원 탈퇴</span></button>
            </div>
            <p class="set-note">탈퇴하면 계정과 서버에 저장된 장부가 바로 지워지고 되돌릴 수 없어요. 필요하면 먼저 백업 파일을 저장하세요.</p>
          </section>

          <p class="set-foot">코스트노트 · 문의 hanguk.soek@me.com</p>
        </form>`;
      body.querySelector('form').addEventListener('submit', (e) => e.preventDefault());
      const planBtn = body.querySelector('[data-act=plans]');
      showOcrUsage(body.querySelector('.ocr-usage'), planBtn, body.querySelector('.admin-sec'));
      body.querySelector('[data-act=admin]').addEventListener('click', () => {
        close();
        openAdmin();
      });
      body.querySelector('[data-act=claude]').addEventListener('click', () => {
        close();
        openClaudeConnect();
      });
      planBtn.addEventListener('click', () => {
        close();
        openPlans();
      });
      const unsubSync = sync.subscribe(() => {
        const el = body.querySelector('.sync-line');
        if (el?.isConnected) el.innerHTML = syncLine();
        else unsubSync();
      });
      body.querySelector('[data-act=delete-account]').addEventListener('click', async () => {
        const typed = prompt('탈퇴하면 계정과 서버의 장부가 모두 지워지고 되돌릴 수 없어요. 구독 중이면 바로 해지되고 등록한 카드도 지워져요.\n계속하려면 "탈퇴"라고 입력하세요.');
        if (typed?.trim() !== '탈퇴') return;
        setAuthNotice('탈퇴가 끝났어요. 그동안 이용해 주셔서 감사합니다.'); // 로그인 화면이 그려질 때 보이도록 먼저
        try {
          await billing.close(); // 자동 결제부터 멈춤 (실패하면 탈퇴도 하지 않음)
          await disconnectClaude().catch(() => {}); // 클로드 연결도 모두 끊음
          await auth.deleteAccount();
          sync.forget();
          close();
        } catch (err) {
          setAuthNotice(null);
          toast(`탈퇴하지 못했어요: ${err?.message || err}`, 4000);
        }
      });
      body.querySelector('[data-act=sync-now]').addEventListener('click', () => sync.now());
      body.querySelector('[data-act=logout]').addEventListener('click', async () => {
        const warn = sync.dirty ? '\n\n⚠ 아직 서버에 올라가지 않은 변경이 있어요. 인터넷에 연결한 뒤 로그아웃하는 걸 권해요.' : '';
        if (!confirm(`로그아웃할까요?${warn}`)) return;
        close();
        setAuthNotice('로그아웃했어요.');
        await auth.signOut();
      });
      body.querySelector('[data-act=csv]').addEventListener('click', () => download(`매입_${monthKey()}.csv`, purchasesCsv(monthPurchases()), 'text/csv'));
      body.querySelector('[data-act=backup]').addEventListener('click', async () => {
        await backupNow();
        if (body.isConnected) body.querySelector('.backup-line').innerHTML = backupLine();
      });
      // 저장 공간 사용량 (브라우저가 알려 주는 경우만)
      storageInfo().then((info) => {
        if (!info || !body.isConnected) return;
        body.querySelector('.storage-line').textContent += ` · ${info.backend} ${mb(info.usage)} 사용${info.persisted ? ' · 보호됨' : ''}`;
      });
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
          alert(`불러오기 실패: ${err instanceof SyntaxError ? '파일 형식이 올바르지 않습니다.' : err.message}`);
        }
      });
    },
  });
}
