// 레벨: 헤더 배지, 포인트가 오를 때 움직임(+10), 레벨 화면, 레벨업 선물 받기
import { computeLevel, levelStart, levelName, rewardFor, nextGiftLevel, POINTS, DAILY_RECEIPT_CAP } from '../lib/levels.js';
import { esc, num } from '../lib/format.js';
import { openSheet, toast } from '../ui/sheet.js';
import { store } from '../store.js';
import { auth } from '../auth.js';

/** 지금 장부의 레벨 (장부가 바뀌었을 때만 다시 계산: store.rev) */
let memo = { rev: -1, day: '', val: null };
export function currentLevel() {
  const day = new Date().toDateString(); // 날이 바뀌면 연속 기록도 다시
  if (memo.rev !== store.rev || memo.day !== day)
    memo = { rev: store.rev, day, val: computeLevel({ purchases: store.purchases, menus: store.menus, itemLinks: store.itemLinks }) };
  return memo.val;
}

const pctW = (x) => `${Math.max(0, Math.min(100, Math.round(x * 100)))}%`;

export function levelBadge() {
  const lv = currentLevel();
  return `<button class="lv-badge${lv.max ? ' lv-max' : ''}" data-act="level" aria-label="레벨 ${lv.level} ${esc(lv.name)}${lv.max ? ', 최고 레벨' : `, 다음 레벨까지 ${num(lv.toNext)}점`}">
    <span class="lv-medal" aria-hidden="true">${lv.max ? '👑' : '🏅'}</span>
    <span class="lv-text"><b>${lv.max ? 'MAX' : `Lv.${lv.level}`}</b> <span class="lv-name">${esc(lv.name)}</span></span>
    <span class="lv-bar" aria-hidden="true"><i style="width:${pctW(lv.progress)}"></i></span>
  </button>`;
}

// ── 선물 받기 (서버가 서버 장부로 확인) ──
let claimTimer = null;
async function claimGifts() {
  try {
    const token = await auth.accessToken();
    if (!token) return;
    const res = await fetch('./api/level/claim', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const r = await res.json();
    const total = (r.gifts || []).reduce((s, g) => s + g.amount, 0);
    if (total) toast(`🎁 레벨업 선물: 영수증 추가 인식 ${total}장을 받았어요!`, 4500);
  } catch {}
}
/** 장부가 서버에 올라간 뒤 확인하도록 조금 기다렸다가 */
export function scheduleClaim(ms = 4000) {
  clearTimeout(claimTimer);
  claimTimer = setTimeout(claimGifts, ms);
}

// ── 포인트가 오르면 배지에서 움직임 ──
let prev = null; // 직전에 그린 {points, level, progress}
const reduce = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** 화면을 다시 그린 뒤 부름: 포인트가 올랐으면 +점수·막대 차오름, 레벨이 올랐으면 반짝 + 선물 */
export function levelAfterRender(root) {
  const badge = root.querySelector('.lv-badge');
  if (!badge) return;
  const lv = currentLevel();
  if (prev && lv.points > prev.points) {
    const gained = lv.points - prev.points;
    const up = lv.level > prev.level;
    const bar = badge.querySelector('.lv-bar i');
    if (!reduce()) {
      // 막대: 예전 자리에서 새 자리로 (레벨이 올랐으면 0에서)
      bar.style.transition = 'none';
      bar.style.width = up ? '0%' : pctW(prev.progress);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          bar.style.transition = '';
          bar.style.width = pctW(lv.progress);
        }),
      );
      const plus = document.createElement('span');
      plus.className = 'lv-plus';
      plus.setAttribute('aria-hidden', 'true');
      plus.textContent = `+${gained}`;
      badge.append(plus);
      setTimeout(() => plus.remove(), 1400);
    }
    badge.classList.add(up ? 'lv-up' : 'lv-gain');
    if (up) {
      toast(`🎉 Lv.${lv.level} ${lv.name} 달성!`, 3500);
      scheduleClaim();
    }
  }
  prev = { points: lv.points, level: lv.level, progress: lv.progress };
}

// ── 레벨 화면 ──
async function loadGifts() {
  const token = await auth.accessToken();
  const res = await fetch('./api/level', { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error();
  return res.json();
}

export function openLevelSheet() {
  const lv = currentLevel();
  const nextName = levelName(lv.level + 1);
  const gift = nextGiftLevel(lv.level);
  const p = lv.parts;
  const table = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 99];
  openSheet({
    title: '내 레벨',
    render(body) {
      body.innerHTML = `
        <div class="lv-sheet">
          <div class="set-card lv-hero">
            <p class="lv-big"><span aria-hidden="true">${lv.max ? '👑' : '🏅'}</span> Lv.${lv.level} <b>${esc(lv.name)}</b></p>
            <div class="meter-bar" aria-hidden="true"><i style="width:${pctW(lv.progress)}"></i></div>
            ${
              lv.max
                ? `<p class="small">지금 <b>${num(lv.points)}점</b> · 최고 레벨에 올랐어요. 코스트노트와 함께해 주셔서 고맙습니다!</p>`
                : `<p class="small">지금 <b>${num(lv.points)}점</b> · 다음 레벨(Lv.${lv.level + 1} ${esc(nextName)})까지 <b>${num(lv.toNext)}점</b></p>
            <p class="small">${gift ? `Lv.${gift}이 되면 🎁 영수증 추가 인식 <b>${rewardFor(gift)}장</b> 선물` : ''}</p>`
            }
          </div>

          <div class="set-card lv-streak">
            ${
              lv.streak
                ? `<p>🔥 <b>${lv.streak}일</b> 연속 기록 중</p><p class="small muted">하루라도 영수증을 기록하면 이어져요. 3일째마다 +${POINTS.streak3}점, 7일째마다 +${POINTS.streak7}점</p>`
                : '<p>🔥 오늘 영수증을 하나 기록하면 연속 기록이 시작돼요</p><p class="small muted">3일째마다 +15점, 7일째마다 +50점 보너스</p>'
            }
          </div>

          <section>
            <h3 class="set-title">받은 선물</h3>
            <div class="set-card lv-gifts"><p class="small muted">불러오는 중…</p></div>
          </section>

          <section>
            <h3 class="set-title">내 포인트</h3>
            <div class="set-card list">
              <div class="set-row static"><span class="grow">영수증 기록 ${num(p.receipts)}건</span><b>${num(p.receipts * POINTS.receipt)}점</b></div>
              <div class="set-row static"><span class="grow">메뉴 ${num(p.menus)}개</span><b>${num(p.menus * POINTS.menu)}점</b></div>
              <div class="set-row static"><span class="grow">메뉴에 연결한 매입 품목 ${num(p.ingredients)}개</span><b>${num(p.ingredients * POINTS.ingredient)}점</b></div>
              <div class="set-row static"><span class="grow">같은 품목 묶기 ${num(p.links)}개</span><b>${num(p.links * POINTS.link)}점</b></div>
              <div class="set-row static"><span class="grow">연속 기록 보너스</span><b>${num(p.streakBonus)}점</b></div>
            </div>
          </section>

          <section>
            <h3 class="set-title">포인트 받는 방법</h3>
            <div class="set-card">
              <ul class="lv-how">
                <li>영수증 저장 <b>+${POINTS.receipt}</b> (자동 인식·직접 입력 모두, 하루 ${DAILY_RECEIPT_CAP / POINTS.receipt}건까지)</li>
                <li>새 메뉴 만들기 <b>+${POINTS.menu}</b></li>
                <li>메뉴에 매입 품목 재료 연결 <b>+${POINTS.ingredient}</b></li>
                <li>같은 품목 묶기 <b>+${POINTS.link}</b></li>
                <li>연속 기록 3일째마다 <b>+${POINTS.streak3}</b>, 7일째마다 <b>+${POINTS.streak7}</b></li>
              </ul>
              <p class="set-note">같은 영수증을 두 번 올린 건 한 번만 세고, 지운 기록의 포인트는 빠져요.</p>
            </div>
          </section>

          <details class="lv-table">
            <summary>레벨표 보기</summary>
            <ul>${table
              .map((n) => `<li class="${n === lv.level ? 'on' : ''}"><span>Lv.${n} ${esc(levelName(n))}</span><span>${n > 1 ? `${num(levelStart(n))}점${rewardFor(n) ? ` · 🎁 ${rewardFor(n)}장` : ''}` : '시작'}</span></li>`)
              .join('')}</ul>
            <p class="set-note">레벨업 선물(추가 인식)은 요금제·무료 체험 한도를 다 쓴 뒤에 1장씩 써요. 하루에 최대 10장까지 받고, 남은 선물은 다음 날 이어서 받아요.</p>
          </details>
        </div>`;
      const box = body.querySelector('.lv-gifts');
      loadGifts().then(
        (g) => {
          if (!box.isConnected) return;
          box.innerHTML = `<p>지금 남은 선물 <b>${num(g.balance)}장</b> <span class="small muted">(지금까지 ${num(g.granted)}장)</span></p>${
            g.history?.length
              ? `<ul class="lv-hist">${g.history
                  .slice(0, 5)
                  .map((h) => `<li><span>Lv.${h.level} ${esc(levelName(h.level))}</span><span>🎁 ${h.amount}장 · ${new Date(h.at).toLocaleDateString('ko-KR')}</span></li>`)
                  .join('')}</ul>`
              : '<p class="small muted">아직 받은 선물이 없어요. 레벨이 오르면 받아요.</p>'
          }`;
        },
        () => box.isConnected && (box.innerHTML = '<p class="small muted">선물 내역을 불러오지 못했어요.</p>'),
      );
    },
  });
}
