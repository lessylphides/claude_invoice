// 원가 변동 알림 화면: 방금 저장한 매입으로 원가가 바뀐 메뉴를 보여 주고, 목표를 넘으면 추천 판매가를 알려 줌
import { esc, num, won, pct } from '../lib/format.js';
import { costImpact } from '../lib/costImpact.js';
import { openSheet, toast } from '../ui/sheet.js';
import { store } from '../store.js';
import { setTab } from '../state.js';

const signed = (n) => `${n > 0 ? '▲' : '▼'}${num(Math.abs(n))}`;
const arrow = (n) => `<em class="${n > 0 ? 'up' : 'down'}">${signed(n)}</em>`;

/**
 * 저장 전 색인과 지금 색인을 비교해, 바뀐 메뉴가 있으면 알림을 띄움 (닫을 때까지 기다림)
 * 오른 메뉴가 있으면 화면으로, 내리기만 했으면 짧은 안내로
 */
export async function notifyCostImpact(beforeIndex, saved) {
  if (!beforeIndex || !saved || !store.menus.length) return;
  let r;
  try {
    r = costImpact(store.menus, beforeIndex, store.index, {
      itemNames: (saved.items || []).map((i) => i.name),
      target: store.costTarget.value,
      minMarginOf: (cat) => store.minMarginOf(cat),
    });
  } catch (e) {
    console.warn('[cost-impact]', e);
    return;
  }
  if (!r.menus.length) return;
  if (!r.up) return void toast(`재료값이 내려 메뉴 ${r.down}개의 원가가 낮아졌어요.`, 3500);
  await showImpact(r);
}

function menuRow(m, target) {
  let badge = '';
  let advice = '';
  if (m.newlyOver || m.stillOver) {
    badge = `<span class="badge warn-badge">${m.newlyOver ? '목표 원가율을 넘었어요' : '목표 원가율 초과'}</span>`;
    if (m.suggest && m.price)
      advice = `<p class="ci-advice">판매가를 <b>${won(m.price)} → ${won(m.suggest)}</b>(+${num(m.suggest - m.price)}원)로 올리면 원가율 <b>${pct(m.suggestRate)}</b>예요.</p>`;
  } else if (m.recovered) badge = '<span class="badge ok-badge">다시 목표 안으로</span>';
  const rate = m.before.rate != null && m.after.rate != null ? `원가율 ${pct(m.before.rate)} → <b>${pct(m.after.rate)}</b>` : '';
  return `<li class="ci-menu">
    <p class="ci-name"><b>${esc(m.name)}</b> ${badge}</p>
    <p class="ci-line">원가 ${won(m.before.cost)} → <b>${won(m.after.cost)}</b> ${arrow(m.delta)}${rate ? ` · ${rate}` : ''}${m.price ? ` <span class="muted">(판매 ${won(m.price)}, 목표 ${target}%)</span>` : ''}</p>
    ${m.after.missing ? '<p class="muted small">일부 재료 원가를 계산할 수 없어 실제 원가는 더 높을 수 있어요.</p>' : ''}
    ${advice}
  </li>`;
}

function showImpact(r) {
  const target = store.costTarget.value;
  const over = r.menus.filter((m) => m.newlyOver).length;
  return new Promise((resolve) => {
    openSheet({
      title: '원가가 바뀐 메뉴',
      onClose: resolve,
      render(body, close) {
        body.innerHTML = `
          <div class="ci">
            <p class="ci-head">이번 매입으로 메뉴 <b>${r.menus.length}개</b>의 원가가 바뀌었어요.${over ? ` 그중 <b class="warn">${over}개</b>는 목표 원가율을 새로 넘었어요.` : ''}</p>
            ${
              r.items.length
                ? `<ul class="ci-items">${r.items
                    .map(
                      (i) =>
                        `<li><span>${esc(i.name)}</span><span>${i.from != null ? `${won(i.from)} → ` : ''}<b>${won(i.to)}</b>${i.scaled ? ' <small class="muted">(용량 환산)</small>' : ''}${i.pct != null ? ` <em class="${i.pct > 0 ? 'up' : 'down'}">${i.pct > 0 ? '▲' : '▼'}${Math.abs(Math.round(i.pct * 10) / 10)}%</em>` : ''}</span></li>`,
                    )
                    .join('')}</ul>`
                : ''
            }
            <ul class="ci-menus">${r.menus.map((m) => menuRow(m, target)).join('')}</ul>
            <p class="muted small">재료 원가는 가장 최근 매입 단가(할인 반영)로 계산해요. 판매가는 원가 탭에서 메뉴를 눌러 바꿀 수 있어요.</p>
            <div class="btn-row">
              <button type="button" class="btn ghost" data-ci="cost">원가 탭에서 보기</button>
              <button type="button" class="btn primary" data-ci="ok">확인</button>
            </div>
          </div>`;
        body.querySelector('[data-ci=ok]').addEventListener('click', close);
        body.querySelector('[data-ci=cost]').addEventListener('click', () => {
          close();
          setTab('cost');
          window.scrollTo(0, 0);
        });
      },
    });
  });
}
