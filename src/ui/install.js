// 홈 화면에 설치: 안드로이드 크롬은 앱 안 버튼으로 바로 설치 창, 아이폰·삼성 인터넷 등은 방법 안내
// 이미 설치한 앱(홈 화면 아이콘)으로 열었거나 앱 안 브라우저(인스타 등)면 보이지 않음
import { openSheet, toast } from './sheet.js';
import { inAppOf } from '../lib/inapp.js';

let deferred = null; // 크롬이 준 설치 창 (beforeinstallprompt)
const listeners = new Set();
const emit = () => listeners.forEach((f) => f());

export function initInstall() {
  addEventListener('beforeinstallprompt', (e) => {
    // 크롬의 기본 설치 창(주소창 아래 '코스트노트 설치')은 그대로 뜨게 두고, 앱 안 [설치] 버튼에서도 같은 창을 띄울 수 있게 받아 둠
    deferred = e;
    emit();
  });
  addEventListener('appinstalled', () => {
    deferred = null;
    toast('홈 화면에 코스트노트를 설치했어요.');
    emit();
  });
}
export const onInstallChange = (f) => (listeners.add(f), () => listeners.delete(f));

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ua = () => navigator.userAgent;
const isIOS = () => /iPhone|iPad|iPod/i.test(ua()) || (/Macintosh/.test(ua()) && navigator.maxTouchPoints > 1);
const isSamsung = () => /SamsungBrowser/i.test(ua());

/** 설치 버튼을 보여 줄지: 이미 앱으로 열었거나 앱 안 브라우저면 false */
export const canOfferInstall = () => !isStandalone() && !inAppOf(ua());

export async function startInstall() {
  if (deferred) {
    const e = deferred;
    deferred = null;
    await e.prompt();
    const { outcome } = await e.userChoice.catch(() => ({ outcome: 'dismissed' }));
    if (outcome !== 'accepted') toast('다음에 설정 → 소식·도움에서 다시 설치할 수 있어요.');
    emit();
    return;
  }
  openInstallGuide();
}

function openInstallGuide() {
  const steps = isIOS()
    ? ['<b>Safari</b>로 열어 주세요 (다른 브라우저는 홈 화면 추가가 안 될 수 있어요).', '아래쪽 <b>공유 버튼(□↑)</b>을 눌러요.', '<b>홈 화면에 추가</b>를 누르고 <b>추가</b>를 눌러요.']
    : isSamsung()
      ? ['아래쪽 <b>≡</b> (줄 세 개)를 눌러요.', '<b>현재 페이지 추가 → 홈 화면</b>을 눌러요.', '주소창 오른쪽에 <b>⬇ 설치 아이콘</b>이 보이면 그걸 눌러도 돼요.']
      : ['오른쪽 위 <b>⋮</b> (점 세 개)를 눌러요.', '<b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 눌러요.', '<b>설치</b>를 누르면 홈 화면에 아이콘이 생겨요.'];
  openSheet({
    title: '홈 화면에 설치',
    render(body) {
      body.innerHTML = `<div class="install-guide">
        <p>홈 화면에 추가하면 주소창 없이 <b>앱처럼</b> 열리고, 인터넷이 끊겨도 장부를 볼 수 있어요.</p>
        <ol>${steps.map((s) => `<li>${s}</li>`).join('')}</ol>
        <p class="muted small">이미 추가했다면 홈 화면의 코스트노트 아이콘으로 열어 주세요.</p>
      </div>`;
    },
  });
}
