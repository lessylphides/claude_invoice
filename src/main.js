// 앱 시작: 탭(매입 | 원가) 그리기, 클릭 연결, 서비스워커 등록
import './style.css';
import { store } from './store.js';
import { view, setRenderer, setTab, shiftMonth } from './state.js';
import { renderPurchaseTab, handlePurchaseClick } from './views/purchase.js';
import { renderCostTab, handleCostClick } from './views/cost.js';
import { openSettings } from './views/settings.js';
import { bindCaptureInputs } from './views/capture.js';

const app = document.getElementById('app');

function tabBar() {
  return `<nav class="tabbar" aria-label="화면 전환">
    ${[['purchase', '🧾', '매입'], ['cost', '📊', '원가']]
      .map(([k, icon, label]) => `<button data-tab="${k}" aria-current="${view.tab === k ? 'page' : 'false'}"><span aria-hidden="true">${icon}</span>${label}</button>`)
      .join('')}
  </nav>`;
}

function render() {
  app.innerHTML = (view.tab === 'cost' ? renderCostTab() : renderPurchaseTab()) + tabBar();
}

app.addEventListener('click', (e) => {
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
store.subscribe(render);
render();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
