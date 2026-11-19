// 처음 쓰는 사장님용 '시작하기 3단계' 카드 (매입 탭 맨 위). 장부 내용으로 자동 체크, 다 하거나 닫으면 사라짐
import { store } from '../store.js';
import { rerender, setTab } from '../state.js';
import { canOfferInstall, startInstall } from '../ui/install.js';

const HIDE = 'costnote:onboard-hide';
const hidden = () => {
  try {
    return localStorage.getItem(HIDE) === '1';
  } catch {
    return false;
  }
};

export function onboardSteps(data = store) {
  const priced = data.menus.filter((m) => Number(m.price) > 0 || Number(m.bottlePrice) > 0);
  return [
    { id: 'receipt', done: data.purchases.length > 0, title: '영수증 한 장 찍기', desc: '오늘 받은 영수증·거래명세서를 찍으면 품목과 단가가 자동으로 들어가요.', btn: '📷 찍기', act: 'capture' },
    { id: 'menu', done: priced.length > 0, title: '메뉴 하나 만들기', desc: '파는 메뉴 이름과 판매가를 넣어요. 예) 하이볼 9,000원', btn: '메뉴 만들기', act: 'menu' },
    { id: 'cost', done: priced.some((m) => (m.ingredients || []).some((g) => g.type === 'item' && Number(g.use) > 0)), title: '재료 연결하고 원가율 보기', desc: '메뉴에 매입한 재료와 한 잔에 쓰는 양을 넣으면 원가율이 바로 계산돼요.', btn: '원가 보기', act: 'cost' },
  ];
}

const INSTALL_HIDE = 'costnote:install-hide';
/** 홈 화면에 설치 안내 띠: 시작하기 카드가 없을 때, 영수증을 한 장이라도 기록한 뒤 (닫으면 다시 안 보임) */
function installBanner() {
  let off = false;
  try {
    off = localStorage.getItem(INSTALL_HIDE) === '1';
  } catch {}
  if (off || !canOfferInstall() || !store.purchases.length) return '';
  return `<aside class="install-banner" role="note"><span aria-hidden="true">📲</span><p><b>홈 화면에 설치</b>하면 앱처럼 바로 열려요</p><button type="button" class="btn primary small-btn" data-onboard="install">설치</button><button type="button" class="icon-btn" data-onboard="install-hide" aria-label="설치 안내 닫기">✕</button></aside>`;
}

export function onboardingCard() {
  const steps = onboardSteps();
  const done = steps.filter((s) => s.done).length;
  if (hidden() || done === steps.length) return installBanner();
  const next = steps.find((s) => !s.done);
  return `<section class="onboard" aria-label="코스트노트 시작하기">
    <div class="ob-head"><b>코스트노트 시작하기</b><span class="ob-count">${done}/${steps.length}</span><button type="button" class="icon-btn ob-x" data-onboard="hide" aria-label="시작하기 안내 닫기">✕</button></div>
    <div class="ob-bar" aria-hidden="true"><i style="width:${(done / steps.length) * 100}%"></i></div>
    <ol class="ob-steps">${steps
      .map(
        (s, i) => `<li class="${s.done ? 'done' : s === next ? 'now' : ''}"><span class="ob-n" aria-hidden="true">${s.done ? '✓' : i + 1}</span><span class="grow"><b>${s.title}</b>${s === next ? `<small>${s.desc}</small>` : ''}</span>${
          s === next ? `<button type="button" class="btn primary small-btn" data-onboard="${s.act}">${s.btn}</button>` : ''
        }<span class="sr-only">${s.done ? '완료' : '할 일'}</span></li>`,
      )
      .join('')}</ol>
  </section>`;
}

/** @returns {boolean} 처리했으면 true */
export async function handleOnboardClick(t) {
  const act = t?.dataset?.onboard;
  if (!act) return false;
  if (act === 'install') return startInstall(), true;
  if (act === 'install-hide') {
    try {
      localStorage.setItem(INSTALL_HIDE, '1');
    } catch {}
    rerender();
    return true;
  }
  if (act === 'hide') {
    try {
      localStorage.setItem(HIDE, '1');
    } catch {}
    rerender();
  } else if (act === 'capture') {
    (await import('./capture.js')).openCaptureMenu();
  } else if (act === 'menu') {
    setTab('cost');
    (await import('./cost.js')).openNewMenu();
  } else if (act === 'cost') setTab('cost');
  return true;
}
