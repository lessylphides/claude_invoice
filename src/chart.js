// 가격 추이 꺾은선 차트 (단일 시리즈, 인라인 SVG, 탭/호버 툴팁)

import { esc, num, shortDate } from './format.js';

const NS = 'http://www.w3.org/2000/svg';

function niceStep(range) {
  const raw = range / 3;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

/**
 * @param {HTMLElement} host
 * @param {{date:string, price:number, listPrice?:number, discount?:number, vendor:string, qty:number, unit:string}[]} points 날짜순 정렬
 */
export function renderTrendChart(host, points) {
  host.innerHTML = '';
  host.classList.add('chart');
  if (!points.length) {
    host.innerHTML = '<p class="muted">기록이 없습니다.</p>';
    return;
  }

  const W = 340, H = 190, L = 52, R = 14, T = 14, B = 26;
  const times = points.map((p) => new Date(p.date + 'T00:00:00').getTime());
  const prices = points.map((p) => p.price);
  let lo = Math.min(...prices), hi = Math.max(...prices);
  if (lo === hi) { lo = lo * 0.9; hi = hi * 1.1 || 1; }
  const step = niceStep(hi - lo);
  lo = Math.max(0, Math.floor(lo / step) * step);
  hi = Math.ceil(hi / step) * step;
  const t0 = Math.min(...times), t1 = Math.max(...times);

  const x = (t) => (t1 === t0 ? (L + W - R) / 2 : L + ((t - t0) / (t1 - t0)) * (W - L - R));
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `단가 추이: 최저 ${num(Math.min(...prices))}원, 최고 ${num(Math.max(...prices))}원`);

  let g = '';
  for (let v = lo; v <= hi + step / 2; v += step) {
    g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
    g += `<text class="axis" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${num(v)}</text>`;
  }
  g += `<text class="axis" x="${x(t0)}" y="${H - 6}" text-anchor="${t1 === t0 ? 'middle' : 'start'}">${shortDate(points[0].date)}</text>`;
  if (t1 !== t0) g += `<text class="axis" x="${x(t1)}" y="${H - 6}" text-anchor="end">${shortDate(points.at(-1).date)}</text>`;

  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(times[i]).toFixed(1)},${y(p.price).toFixed(1)}`).join('');
  g += `<path class="line" d="${d}"/>`;
  g += points.map((p, i) => `<circle class="dot" cx="${x(times[i])}" cy="${y(p.price)}" r="4"/>`).join('');
  g += `<line class="cross" y1="${T}" y2="${H - B}" x1="0" x2="0" visibility="hidden"/>`;
  g += `<circle class="dot active" r="5" visibility="hidden"/>`;
  g += `<rect class="hit" x="${L - 10}" y="0" width="${W - L - R + 20}" height="${H}"/>`;
  svg.innerHTML = g;

  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  host.append(svg, tip);

  const cross = svg.querySelector('.cross');
  const active = svg.querySelector('.active');

  function show(evt) {
    const rect = svg.getBoundingClientRect();
    const px = ((evt.clientX - rect.left) / rect.width) * W;
    let best = 0;
    points.forEach((_, i) => {
      if (Math.abs(x(times[i]) - px) < Math.abs(x(times[best]) - px)) best = i;
    });
    const p = points[best];
    const cx = x(times[best]), cy = y(p.price);
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    cross.setAttribute('visibility', 'visible');
    active.setAttribute('cx', cx);
    active.setAttribute('cy', cy);
    active.setAttribute('visibility', 'visible');
    tip.innerHTML = `<b>${num(p.price)}원</b>${p.unit ? ` / ${esc(p.unit)}` : ''}${
      p.discount ? `<br><span>정가 ${num(p.listPrice)} · 할인 -${num(p.discount)}</span>` : ''
    }<br><span>${shortDate(p.date)} · ${esc(p.vendor)}</span>`;
    tip.hidden = false;
    const left = (cx / W) * rect.width;
    tip.style.left = `${Math.min(Math.max(left, 70), rect.width - 70)}px`;
    tip.style.top = `${(cy / H) * rect.height}px`;
  }
  function hide() {
    cross.setAttribute('visibility', 'hidden');
    active.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  }
  const hit = svg.querySelector('.hit');
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
}
