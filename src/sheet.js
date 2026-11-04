// 하단 시트(모달) 스택 + 토스트

import { store } from './store.js';

const stack = [];

/**
 * @param {{title:string, render:(body:HTMLElement, close:()=>void, redraw:()=>void)=>void, live?:boolean, onClose?:()=>void}} opts
 *   live=true 이면 데이터가 바뀔 때마다 render 를 다시 호출합니다.
 */
export function openSheet({ title, render, live = false, onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet-backdrop"></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-label="${title.replace(/"/g, '&quot;')}">
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
  const entry = { wrap };
  const close = () => {
    if (!wrap.isConnected) return;
    unsub?.();
    wrap.remove();
    stack.splice(stack.indexOf(entry), 1);
    if (!stack.length) document.body.classList.remove('no-scroll');
    onClose?.();
  };
  entry.close = close;
  stack.push(entry);

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
  el.innerHTML = `<div class="busy-box"><div class="spinner"></div><p></p></div>`;
  const p = el.querySelector('p');
  p.textContent = msg;
  document.body.append(el);
  return { update: (m) => (p.textContent = m), done: () => el.remove() };
}
