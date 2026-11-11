// 하단 시트(모달) 스택 + 토스트

import { store } from '../store.js';
import { esc } from '../lib/format.js';

const stack = [];

// 맨 위 시트만 조작할 수 있게: 뒤쪽 화면과 아래 시트는 inert(누를 수 없고 화면 읽기에서도 숨김)
function updateInert() {
  const app = document.getElementById('app');
  if (app) app.inert = stack.length > 0;
  stack.forEach((e, i) => (e.wrap.inert = i < stack.length - 1));
}

/**
 * @param {{title:string, render:(body:HTMLElement, close:()=>void, redraw:()=>void)=>void, live?:boolean, onClose?:()=>void}} opts
 *   live=true 이면 데이터가 바뀔 때마다 render 를 다시 호출합니다.
 */
export function openSheet({ title, render, live = false, onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet-backdrop"></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1">
      <div class="sheet-grip" aria-hidden="true"></div>
      <header class="sheet-head">
        <h2></h2>
        <button class="icon-btn close" aria-label="닫기">✕</button>
      </header>
      <div class="sheet-body"></div>
    </section>`;
  wrap.querySelector('h2').textContent = title;
  let body = wrap.querySelector('.sheet-body');
  document.body.append(wrap);
  document.body.classList.add('no-scroll');

  let unsub = null;
  const opener = document.activeElement; // 닫으면 포커스를 돌려줄 곳
  const entry = { wrap };
  const close = () => {
    if (!wrap.isConnected) return;
    unsub?.();
    wrap.remove();
    stack.splice(stack.indexOf(entry), 1);
    if (!stack.length) document.body.classList.remove('no-scroll');
    updateInert();
    if (opener?.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true });
    onClose?.();
  };
  entry.close = close;
  stack.push(entry);
  updateInert();

  wrap.querySelector('.sheet-backdrop').addEventListener('click', close);
  wrap.querySelector('.close').addEventListener('click', close);
  // 입력한 내용이 있는지 (끌어내려 닫을 때 실수로 지우지 않게 물어봄)
  wrap.addEventListener('input', () => (entry.dirty = true));
  enableSwipeDown(wrap, () => {
    if (entry.dirty && !confirm('저장하지 않은 내용이 있어요. 닫을까요?')) return false;
    close();
    return true;
  });

  // 다시 그릴 때마다 새 body 요소로 교체 → 이전에 붙인 이벤트 리스너가 중복되지 않음
  const draw = () => {
    const scroll = body.scrollTop;
    const fresh = body.cloneNode(false);
    body.replaceWith(fresh);
    body = fresh;
    render(body, close, draw);
    body.scrollTop = scroll;
  };
  draw();
  if (live) unsub = store.subscribe(draw);
  // 시트 안으로 포커스 이동 (그리는 중 이미 입력칸에 포커스를 줬으면 그대로)
  if (!wrap.contains(document.activeElement)) wrap.querySelector('.sheet').focus({ preventScroll: true });
  requestAnimationFrame(() => wrap.classList.add('open'));
  return close;
}

/**
 * 시트를 아래로 끌어내려 닫기. 맨 위까지 스크롤된 상태에서 아래로 당길 때만 (위로 스크롤하는 동작과 겹치지 않게).
 * 입력칸·가로로 넘기는 목록 위에서 시작한 동작은 무시. 충분히 내리거나 빠르게 튕기면 닫고, 아니면 제자리로.
 * @param {() => boolean} tryClose 닫았으면 true (사용자가 취소하면 false → 제자리로)
 */
function enableSwipeDown(wrap, tryClose) {
  const sheet = wrap.querySelector('.sheet');
  const backdrop = wrap.querySelector('.sheet-backdrop');
  let start = null; // {x, y, t}
  let dragging = false;
  let dy = 0;

  const reset = () => {
    sheet.style.transition = '';
    sheet.style.transform = '';
    backdrop.style.transition = '';
    backdrop.style.opacity = '';
  };

  sheet.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1 || !wrap.classList.contains('open')) return (start = null);
      const t = e.target;
      const onHead = !!t.closest('.sheet-head, .sheet-grip');
      const body = sheet.querySelector('.sheet-body');
      const blocked = t.closest('input, textarea, select, .chips, .fill-row, .chart-host');
      if (!onHead && (blocked || body.scrollTop > 0)) return (start = null);
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: e.timeStamp };
      dragging = false;
      dy = 0;
    },
    { passive: true },
  );

  sheet.addEventListener(
    'touchmove',
    (e) => {
      if (!start) return;
      const mx = e.touches[0].clientX - start.x;
      const my = e.touches[0].clientY - start.y;
      if (!dragging) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        // 아래쪽으로, 세로로 움직일 때만 끌기 시작 (위로 스크롤·가로 넘기기는 그대로)
        if (my <= 0 || Math.abs(mx) > my) return (start = null);
        if (sheet.querySelector('.sheet-body').scrollTop > 0) return (start = null);
        dragging = true;
        sheet.style.transition = 'none';
        backdrop.style.transition = 'none';
      }
      e.preventDefault(); // 화면 전체가 같이 끌려 내려가지 않게
      dy = Math.max(0, my);
      sheet.style.transform = `translateY(${dy}px)`;
      backdrop.style.opacity = String(Math.max(0, 1 - dy / sheet.offsetHeight));
    },
    { passive: false },
  );

  const end = (e) => {
    if (!start) return;
    const wasDragging = dragging;
    const speed = dy / Math.max(1, e.timeStamp - start.t); // px/ms
    start = null;
    dragging = false;
    if (!wasDragging) return;
    const far = dy > Math.min(140, sheet.offsetHeight * 0.3);
    const flick = dy > 40 && speed > 0.6;
    if (far || flick) {
      // 끝까지 내려보낸 뒤 닫기
      sheet.style.transition = 'transform 0.18s ease-in';
      sheet.style.transform = 'translateY(100%)';
      backdrop.style.transition = 'opacity 0.18s';
      backdrop.style.opacity = '0';
      setTimeout(() => {
        if (!tryClose()) reset();
      }, 180);
    } else reset();
  };
  sheet.addEventListener('touchend', end);
  sheet.addEventListener('touchcancel', end);
}

export function closeTopSheet() {
  stack.at(-1)?.close();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeTopSheet();
});

// 알림(토스트)은 한 번에 하나씩 차례로: 동시에 오면 겹치지 않게 줄 세움 (예: '저장했어요' 다음 '레벨업')
const toastQueue = [];
let toastNow = null; // { el, timer, shownAt, ms }
const MIN_SHOW = 1300; // 다음 알림이 기다리면 지금 것은 이만큼만 보여 주고 넘김

function hideToast() {
  const cur = toastNow;
  if (!cur) return;
  clearTimeout(cur.timer);
  cur.el.classList.remove('show');
  setTimeout(() => {
    cur.el.remove();
    toastNow = null;
    showNextToast();
  }, 250);
}

function showNextToast() {
  if (toastNow || !toastQueue.length) return;
  const { msg, ms } = toastQueue.shift();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  toastNow = { el, msg, shownAt: Date.now(), timer: setTimeout(hideToast, toastQueue.length ? Math.min(ms, MIN_SHOW) : ms) };
}

export function toast(msg, ms = 2600) {
  // 바로 앞과 같은 말이면 한 번만
  const last = toastQueue.at(-1)?.msg ?? toastNow?.msg;
  if (last === msg) return;
  toastQueue.push({ msg, ms });
  if (toastNow) {
    // 기다리는 알림이 생겼으니 지금 것은 최소 시간만 보여 주고 넘김
    const left = Math.max(0, MIN_SHOW - (Date.now() - toastNow.shownAt));
    clearTimeout(toastNow.timer);
    toastNow.timer = setTimeout(hideToast, left);
  }
  showNextToast();
}

export function showBusy(msg) {
  const el = document.createElement('div');
  el.className = 'busy';
  el.setAttribute('role', 'alert');
  el.setAttribute('aria-busy', 'true');
  el.innerHTML = `<div class="busy-box"><div class="spinner"></div><p></p></div>`;
  const p = el.querySelector('p');
  p.textContent = msg;
  document.body.append(el);
  return { update: (m) => (p.textContent = m), done: () => el.remove() };
}

// ── 아이폰 키보드 대응 ──
// 키보드가 올라와 있는 동안에만 시트를 '실제로 보이는 영역(visualViewport)'에 맞춥니다.
// 입력이 끝나면(포커스가 빠지면) 무조건 원래 전체 높이로 되돌립니다.
// (아이폰은 키보드가 내려갈 때 크기 변경 신호를 빠뜨리는 경우가 있어, 신호에만 의존하면 시트가 작게 남습니다.)
const vv = window.visualViewport;
if (vv) {
  const root = document.documentElement.style;
  const editing = () => {
    const el = document.activeElement;
    return !!(el && el.closest?.('.sheet-body') && /^(INPUT|TEXTAREA)$/.test(el.tagName) && !/^(checkbox|radio|button|submit)$/.test(el.type));
  };
  const reset = () => {
    root.removeProperty('--vv-top');
    root.removeProperty('--vv-h');
  };
  const apply = () => {
    // 키보드가 보이는 상황: 입력 중이고, 보이는 높이가 창 높이보다 눈에 띄게 작을 때
    if (editing() && vv.height < window.innerHeight - 80) {
      root.setProperty('--vv-top', `${Math.max(0, vv.offsetTop)}px`);
      root.setProperty('--vv-h', `${vv.height}px`);
      const el = document.activeElement;
      el.scrollIntoView({ block: 'nearest' });
    } else reset();
  };
  let raf = 0;
  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(apply);
  };
  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  window.addEventListener('orientationchange', () => setTimeout(apply, 300));
  document.addEventListener('focusin', () => [50, 300].forEach((t) => setTimeout(apply, t)));
  // 칸에서 칸으로 옮길 때는 잠깐 포커스가 비므로, 조금 기다렸다가 확인 후 되돌림
  document.addEventListener('focusout', () => [120, 400, 800].forEach((t) => setTimeout(apply, t)));
}
