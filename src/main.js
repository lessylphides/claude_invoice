// 앱 시작: 탭(매입 | 원가) 그리기, 클릭 연결, 서비스워커 등록
import './style.css';
import { store, ready, warmIndex } from './store.js';
import { view, setRenderer, setTab, shiftMonth } from './state.js';
import { renderPurchaseTab, handlePurchaseClick } from './views/purchase.js';
import { renderCostTab, handleCostClick } from './views/cost.js';
import { openSettings } from './views/settings.js';
import { bindCaptureInputs, preloadOcr } from './views/capture.js';

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

function render() {
  app.innerHTML = staleBanner() + (view.tab === 'cost' ? renderCostTab() : renderPurchaseTab()) + tabBar();
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
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    window.scrollTo(0, 0);
    return setTab(tab.dataset.tab);
  }
  if (e.target.closest('[data-act=settings]')) return openSettings();
  if (view.tab === 'cost') handleCostClick(e);
  else handlePurchaseClick(e, { openSettings });
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
ready.then(
  () => {
    store.subscribe(render);
    render();
    warmIndex();
    preloadOcr();
  },
  (err) => renderLoadError(err),
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
