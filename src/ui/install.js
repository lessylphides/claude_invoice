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

// 아이폰·아이패드: 웹사이트가 홈 화면 추가를 대신 할 수 없어서(애플 정책) 기기·브라우저에 맞는 순서를 그림으로 안내
const iosMajor = () => Number(ua().match(/OS (\d+)_/)?.[1] || ua().match(/Version\/(\d+)/)?.[1] || 0);
const isIPad = () => /iPad/i.test(ua()) || (/Macintosh/.test(ua()) && navigator.maxTouchPoints > 1);
const iosBrowser = () => (/CriOS/.test(ua()) ? '크롬' : /FxiOS/.test(ua()) ? '파이어폭스' : /EdgiOS/.test(ua()) ? '엣지' : /Whale/i.test(ua()) ? '웨일' : 'Safari');

// 단계마다 작은 화면 그림 (글자보다 '어디를 누르는지'가 먼저 보이게)
const mock = {
  bar: (hl) => `<div class="ig-mock ig-bar"><span>‹</span><span class="ig-pill"><b class="${hl === 'menu' ? 'hl' : ''}">≡</b><i>app.costnote.co.kr</i><span>↻</span></span><span class="${hl === 'share' ? 'hl' : ''}">${hl === 'share' ? '□↑' : '⧉'}</span></div>`,
  menu: () => `<div class="ig-mock ig-list"><p>웹사이트 번역…</p><p class="hl">⇪ 공유</p><p>북마크에 추가</p></div>`,
  sheet: () => `<div class="ig-mock ig-list"><p>즐겨찾기에 추가</p><p>빠른 메모에 추가</p><p class="hl">⊞ 홈 화면에 추가</p></div>`,
  add: () => `<div class="ig-mock ig-add"><p><span>홈 화면에 추가</span><b class="hl">추가</b></p><p><span>웹 앱으로 열기</span><i class="ig-toggle"></i></p></div>`,
};

function guideSteps() {
  if (isIOS()) {
    const browser = iosBrowser();
    if (browser !== 'Safari')
      return {
        steps: [
          [`${browser} 주소창 옆 <b>공유 버튼(□↑)</b>을 눌러요. 없으면 <b>⋯ 메뉴 → 공유</b>를 눌러요.`, mock.bar('share')],
          ['공유 창을 위로 올려 <b>홈 화면에 추가</b>를 눌러요.', mock.sheet()],
          ['오른쪽 위 <b>추가</b>를 눌러요.', mock.add()],
        ],
        note: `${browser}에서 '홈 화면에 추가'가 보이지 않으면 <b>Safari</b>에서 app.costnote.co.kr 을 열어 주세요.`,
      };
    if (isIPad())
      return {
        steps: [
          ['주소창 오른쪽 <b>공유 버튼(□↑)</b>을 눌러요. 없으면 <b>⋯ → 공유</b>를 눌러요.', mock.bar('share')],
          ['목록에서 <b>홈 화면에 추가</b>를 눌러요.', mock.sheet()],
          ['<b>추가</b>를 눌러요.', mock.add()],
        ],
      };
    if (iosMajor() >= 26)
      return {
        steps: [
          ['주소창 왼쪽 <b>≡</b> 버튼을 눌러요.', mock.bar('menu')],
          ['메뉴에서 <b>공유</b>를 눌러요.', mock.menu()],
          ['공유 창을 <b>위로 올리거나</b> 오른쪽 <b>∨ 더 보기</b>를 눌러 <b>홈 화면에 추가</b>를 찾아요.', mock.sheet()],
          ['<b>웹 앱으로 열기</b>가 켜진 채로 오른쪽 위 <b>추가</b>를 눌러요.', mock.add()],
        ],
      };
    return {
      steps: [
        ['아래쪽 가운데 <b>공유 버튼(□↑)</b>을 눌러요.', mock.bar('share')],
        ['공유 창을 위로 올려 <b>홈 화면에 추가</b>를 눌러요.', mock.sheet()],
        ['오른쪽 위 <b>추가</b>를 눌러요.', mock.add()],
      ],
    };
  }
  if (isSamsung())
    return {
      steps: [
        ['아래쪽 <b>≡</b> (줄 세 개)를 눌러요.', ''],
        ['<b>현재 페이지 추가 → 홈 화면</b>을 눌러요.', ''],
        ['주소창 오른쪽에 <b>⬇ 설치 아이콘</b>이 보이면 그걸 눌러도 돼요.', ''],
      ],
    };
  return {
    steps: [
      ['오른쪽 위 <b>⋮</b> (점 세 개)를 눌러요.', ''],
      ['<b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 눌러요.', ''],
      ['<b>설치</b>를 누르면 홈 화면에 아이콘이 생겨요.', ''],
    ],
  };
}

export function openInstallGuide() {
  const { steps, note } = guideSteps();
  openSheet({
    title: '홈 화면에 추가',
    render(body) {
      body.innerHTML = `<div class="install-guide">
        <p>홈 화면에 추가하면 주소창 없이 <b>앱처럼</b> 열리고, 인터넷이 끊겨도 장부를 볼 수 있어요.</p>
        ${isIOS() ? '<p class="ig-why muted small">아이폰은 애플 정책상 버튼 하나로 추가할 수 없어서, 아래 순서대로 직접 눌러 주세요 (처음 한 번만).</p>' : ''}
        <ol class="ig-steps">${steps.map(([t, m], i) => `<li><span class="ig-n">${i + 1}</span><div><p>${t}</p>${m}</div></li>`).join('')}</ol>
        ${note ? `<p class="small">${note}</p>` : ''}
        ${isIOS() ? '<p class="muted small">홈 화면 아이콘으로 처음 열 때는 <b>한 번 더 로그인</b>해 주세요. 아이폰은 홈 화면 앱과 브라우저가 로그인을 따로 기억해요.</p>' : ''}
        <p class="muted small">이미 추가했다면 홈 화면의 코스트노트 아이콘으로 열어 주세요.</p>
      </div>`;
    },
  });
}
