// 앱 시작: 탭(매입 | 원가) 그리기, 클릭 연결, 서비스워커 등록
import './style.css';
import { store, ready, warmIndex } from './store.js';
import { view, setRenderer, setTab, shiftMonth } from './state.js';
import { renderPurchaseTab, handlePurchaseClick } from './views/purchase.js';
import { renderCostTab, handleCostClick } from './views/cost.js';
import { openSettings } from './views/settings.js';
import { bindCaptureInputs, preloadOcr } from './views/capture.js';
import { auth, landing } from './auth.js';
import { renderAuth, handleAuthEvent } from './views/authScreen.js';
import { closeTopSheet, toast } from './ui/sheet.js';
import { sync } from './sync.js';
import { takeBillingReturn } from './billing.js';
import { finishCardRegistration } from './views/plans.js';
import { levelAfterRender, openLevelSheet, scheduleClaim } from './views/level.js';
import { captureRef, reportRef } from './lib/ref.js';

captureRef(); // 광고 링크로 들어온 경우 가입 경로 꼬리표 기억
const app = document.getElementById('app');

function tabBar() {
  return `<nav class="tabbar" aria-label="화면 전환">
    ${[['purchase', '🧾', '매입'], ['cost', '📊', '원가']]
      .map(([k, icon, label]) => `<button data-tab="${k}" aria-current="${view.tab === k ? 'page' : 'false'}"><span aria-hidden="true">${icon}</span>${label}</button>`)
      .join('')}
  </nav>`;
}

function staleBanner() {
  return store.stale
    ? `<section class="backup-banner stale-banner" role="alert">
        <p><b>다른 창에서 데이터가 바뀌었습니다.</b> 이 창의 내용은 낡아서 저장하지 않습니다.</p>
        <div class="backup-actions"><button class="btn primary small-btn" data-act="reload">새로 불러오기</button></div>
      </section>`
    : '';
}

// 시작 상태: 로그인 확인 → 장부 불러오기
const boot = { auth: 'loading', data: 'loading', dataError: null, authError: null };

/** 카드 등록창에서 돌아왔으면 (로그인된 뒤에) 구독 마무리 */
function finishBillingReturn() {
  if (!auth.user || auth.recovery) return;
  const ret = takeBillingReturn();
  if (ret) finishCardRegistration(ret);
}

/** 로그인했고 장부를 불러왔으면 서버 동기화 시작, 로그아웃하면 멈춤 */
function syncWithAuth() {
  if (boot.auth !== 'ok' || boot.data !== 'ok') return;
  if (auth.user && !auth.recovery) {
    sync.start(auth.user);
    scheduleClaim(8000);
    auth.accessToken().then((t) => reportRef(auth.user, t)).catch(() => {}); // 밀린 레벨업 선물이 있으면 받기 (장부가 서버에 올라간 뒤)
  }
  else sync.stop();
}

function render() {
  if (boot.auth === 'loading') return (app.innerHTML = '<p class="boot-msg" role="status">불러오는 중…</p>');
  if (boot.auth === 'error') return renderAuthError(boot.authError);
  if (!auth.user || auth.recovery) {
    closeTopSheet();
    return renderAuth(app);
  }
  if (boot.data === 'error') return renderLoadError(boot.dataError);
  if (boot.data === 'loading') return (app.innerHTML = '<p class="boot-msg" role="status">장부를 불러오는 중…</p>');
  app.innerHTML = staleBanner() + (view.tab === 'cost' ? renderCostTab() : renderPurchaseTab()) + tabBar();
  levelAfterRender(app);
}

/** 로그인 기능을 불러오지 못함 (처음 열 때 인터넷이 끊겨 있는 경우 등) */
function renderAuthError(err) {
  app.innerHTML = `
    <section class="load-error" role="alert">
      <h1>로그인 기능을 불러오지 못했습니다</h1>
      <p>${String(err?.message || err).replace(/[<>&]/g, '')}</p>
      <p class="muted small">인터넷 연결을 확인한 뒤 다시 시도해 주세요. 장부는 이 기기에 그대로 있습니다.</p>
      <button class="btn primary" data-act="reload">다시 시도</button>
    </section>`;
}

/** 저장된 데이터를 읽지 못했을 때: 빈 장부로 시작하지 않고 다시 시도하게 함 */
function renderLoadError(err) {
  app.innerHTML = `
    <section class="load-error" role="alert">
      <h1>데이터를 불러오지 못했습니다</h1>
      <p>${String(err?.message || err).replace(/[<>&]/g, '')}</p>
      <p class="muted small">입력해 둔 데이터는 지워지지 않았습니다. 앱을 완전히 닫았다가 다시 열거나 아래 버튼을 눌러 주세요.</p>
      <button class="btn primary" data-act="reload">다시 시도</button>
    </section>`;
}

app.addEventListener('click', (e) => {
  if (e.target.closest('[data-act=reload]')) return location.reload();
  if (e.target.closest('.auth-screen')) return handleAuthEvent(e, render);
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    window.scrollTo(0, 0);
    return setTab(tab.dataset.tab);
  }
  if (e.target.closest('[data-act=settings]')) return openSettings();
  if (e.target.closest('[data-act=level]')) return openLevelSheet();
  if (view.tab === 'cost') handleCostClick(e);
  else handlePurchaseClick(e, { openSettings });
});

app.addEventListener('submit', (e) => {
  if (e.target.closest('.auth-screen')) handleAuthEvent(e, render);
});

// 달력에서 좌우로 밀어 달 이동
let touchX = null;
app.addEventListener('touchstart', (e) => (touchX = e.target.closest('.calendar') ? e.touches[0].clientX : null), { passive: true });
app.addEventListener('touchend', (e) => {
  if (touchX == null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) >= 60) shiftMonth(dx < 0 ? 1 : -1);
});

bindCaptureInputs();
setRenderer(render);
render();
ready.then(
  () => {
    boot.data = 'ok';
    store.subscribe(render);
    render();
    syncWithAuth();
    warmIndex();
    preloadOcr();
  },
  (err) => {
    boot.data = 'error';
    boot.dataError = err;
    render();
  },
);
auth.init().then(
  () => {
    boot.auth = 'ok';
    auth.subscribe(() => {
      render();
      syncWithAuth();
      finishBillingReturn();
    });
    render();
    syncWithAuth();
    finishBillingReturn();
    // 메일의 인증 링크로 들어온 경우 (아이폰은 메일 링크가 Safari 로 열려 홈 화면 앱과 로그인이 따로임)
    if (landing.type === 'signup' && auth.user) toast('이메일 인증이 끝났어요. 홈 화면의 코스트노트 앱에서도 로그인해 주세요.', 5000);
  },
  (err) => {
    boot.auth = 'error';
    boot.authError = err;
    render();
  },
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
