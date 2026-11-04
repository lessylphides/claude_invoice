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

export function closeTopSheet() {
  stack.at(-1)?.close();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeTopSheet();
});

export function toast(msg, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
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
