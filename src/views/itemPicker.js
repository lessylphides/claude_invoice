// 매입 품목 고르기: 매입된 품목을 분류별로 보여주고 하나를 고르게 함 (원가 재료, 같은 품목 묶기에서 사용)
import { esc, normKey, num, shortDate } from '../lib/format.js';
import { openSheet } from '../ui/sheet.js';
import { store } from '../store.js';

/**
 * @param {string|{current?: string, title?: string, hint?: string, exclude?: (name:string)=>boolean}} opts
 *   문자열이면 current(지금 고른 품목)로 봄
 * @returns {Promise<string|null>} 고른 품목 이름 (취소하면 null)
 */
export function pickItem(opts = {}) {
  const { current = '', title = '매입 품목 선택', hint = '', exclude = () => false } = typeof opts === 'string' ? { current: opts } : opts;
  const items = store.index.pickList().filter((i) => !exclude(i.name));
  const cats = [...new Set(store.categories.concat(items.map((i) => i.category)))].filter((c) => items.some((i) => i.category === c));
  const curKey = current ? store.itemKey(current) : '';

  return new Promise((resolve) => {
    let picked = null;
    let q = '';
    openSheet({
      title,
      onClose: () => resolve(picked),
      render(body, close) {
        body.innerHTML = `
          ${hint ? `<p class="muted small">${hint}</p>` : ''}
          <input class="pick-search" type="search" placeholder="이름으로 찾기 (선택 사항)" aria-label="품목 검색">
          <div class="pick-list"></div>`;
        const list = body.querySelector('.pick-list');
        const drawList = () => {
          const k = normKey(q);
          const hit = items.filter((i) => !k || normKey(i.name).includes(k));
          list.innerHTML = hit.length
            ? cats
                .map((c) => {
                  const rows = hit.filter((i) => i.category === c);
                  if (!rows.length) return '';
                  return `<h3 class="sub">${esc(c)}</h3><ul class="pick-ul">${rows
                    .map(
                      (i) => `<li><button type="button" class="pick-item ${curKey && store.itemKey(i.name) === curKey ? 'cur' : ''}" data-name="${esc(i.name)}">
                        <span class="iname">${esc(i.name)}<small>${i.spec ? `${num(i.spec.packSize)}${esc(i.spec.packUnit)} · ` : ''}최근 ${num(i.price)}원 · ${shortDate(i.date)}</small></span>
                        <span aria-hidden="true">›</span>
                      </button></li>`,
                    )
                    .join('')}</ul>`;
                })
                .join('')
            : `<p class="empty-msg">${items.length ? '찾는 품목이 없습니다.' : '고를 수 있는 매입 품목이 없습니다.'}</p>`;
        };
        drawList();
        body.querySelector('.pick-search').addEventListener('input', (e) => {
          q = e.target.value;
          drawList();
        });
        list.addEventListener('click', (e) => {
          const b = e.target.closest('[data-name]');
          if (!b) return;
          picked = b.dataset.name;
          close();
        });
      },
    });
  });
}
