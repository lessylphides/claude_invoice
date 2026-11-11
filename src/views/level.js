// 레벨: 헤더 배지, 포인트가 오를 때 움직임(+10), 레벨 화면, 레벨업 선물 받기
import { computeLevel, levelStart, levelName, rewardFor, nextGiftLevel, POINTS, DAILY_RECEIPT_CAP } from '../lib/levels.js';
import { esc, num } from '../lib/format.js';
import { openSheet, toast } from '../ui/sheet.js';
import { store } from '../store.js';
import { auth } from '../auth.js';
import { todayFortune, todayTip } from '../lib/fortune.js';

// ── 오늘의 운세: 오늘 아직 안 봤으면 배지에 빨간 점 ──
const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const SEEN_KEY = 'costnote:fortune-seen';
function fortuneSeen() {
  try {
    return localStorage.getItem(SEEN_KEY) === kstToday();
  } catch {
    return true;
  }
}
function markFortuneSeen() {
  try {
    localStorage.setItem(SEEN_KEY, kstToday());
  } catch {}
  document.querySelectorAll('.lv-dot, .fortune-new').forEach((d) => d.remove());
}

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
    ${fortuneSeen() ? '' : '<span class="lv-dot" aria-hidden="true"></span>'}
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

// 별: 하나씩 채워지게 (애니메이션 때 순서대로)
const starsHtml = (n, base = 0) =>
  `<span class="ft-stars" aria-label="별 ${n}개">${Array.from({ length: 5 }, (_, i) =>
    i < n ? `<i class="on" style="--d:${base + i * 0.09}s">★</i>` : '<i>★</i>',
  ).join('')}</span>`;

const ANIM_KEY = 'costnote:fortune-printed';
/** 오늘 첫 번째로 열 때만 프린터 연출 (같은 날 다시 열면 바로) */
function firstPrintToday() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  try {
    if (localStorage.getItem(ANIM_KEY) === kstToday()) return false;
    localStorage.setItem(ANIM_KEY, kstToday());
    return true;
  } catch {
    return false;
  }
}

/** 오늘의 운세: 영수증으로 출력되는 화면 */
export function openFortuneSheet() {
  const who = auth.user?.id || 'local';
  const day = kstToday();
  const f = todayFortune(who, day);
  const tip = todayTip({ purchases: store.purchases, menus: store.menus }, who, day);
  const [y, m, d] = day.split('-').map(Number);
  const anim = firstPrintToday();
  markFortuneSeen();
  openSheet({
    title: '오늘의 운세',
    render(body) {
      body.innerHTML = `
        <div class="ft${anim ? ' ft-anim' : ''}">
          <div class="ft-printer" aria-hidden="true">
            <div class="ft-slot"></div>
            <p class="ft-printing">오늘의 운세를 뽑는 중…</p>
          </div>
          <article class="ft-paper" aria-label="${m}월 ${d}일 오늘의 운세">
            <p class="ft-shop">COSTNOTE · 오늘의 운세</p>
            <p class="ft-date">${y}.${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')} 사장님 운세</p>
            <hr class="ft-cut" />
            <p class="ft-head ft-s" style="--d:.9s">${esc(f.headline)}</p>
            <hr class="ft-cut" />
            <div class="ft-row ft-s" style="--d:1.15s"><p class="ft-cat">💰 재물운 ${starsHtml(f.money.stars, 1.25)}</p><p>${esc(f.money.text)}</p></div>
            <div class="ft-row ft-s" style="--d:1.45s"><p class="ft-cat">🙋 손님운 ${starsHtml(f.guest.stars, 1.55)}</p><p>${esc(f.guest.text)}</p></div>
            <div class="ft-row ft-s" style="--d:1.75s"><p class="ft-cat">🤝 거래처운 ${starsHtml(f.vendor.stars, 1.85)}</p><p>${esc(f.vendor.text)}</p></div>
            <hr class="ft-cut" />
            <div class="ft-row ft-s" style="--d:2.1s"><p class="ft-cat">☕ 사장님께 한마디</p><p>${esc(f.advice)}</p></div>
            <div class="ft-row ft-tip ft-s" style="--d:2.3s">
              <p class="ft-cat">${tip.fromLedger ? '📒 내 장부에서 찾은 오늘의 팁' : '💡 오늘의 장사 팁'}</p>
              <p>${tip.fromLedger ? `${tip.icon} ` : ''}${esc(tip.text)}</p>
            </div>
            <hr class="ft-cut" />
            <div class="ft-total ft-s" style="--d:2.5s">
              <p><span>오늘의 키워드</span><b>${esc(f.keyword)}</b></p>
              <p><span>행운의 시간</span><b>${esc(f.luckyTime)}</b></p>
            </div>
            <p class="ft-foot">재미로 보는 운세예요 · 내일 또 새로 뽑아 드려요</p>
          </article>
          <div class="ad-slot" hidden></div>
        </div>`;
      if (anim) {
        const box = body.querySelector('.ft');
        const done = () => box.classList.add('ft-done');
        box.addEventListener('click', done, { once: true }); // 누르면 바로 끝까지
        setTimeout(done, 3200);
      }
    },
  });
}

const missionLi = (x) =>
  `<li class="${x.done ? 'done' : ''}"><span class="ms-check" aria-hidden="true">${x.done ? '✅' : '⬜'}</span><span class="grow">${esc(x.title)}${
    x.done ? '' : ` <span class="small muted">${num(x.have)}/${num(x.goal)}</span>`
  }</span><b class="ms-pt">+${x.points}</b></li>`;

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

          <button type="button" class="set-card ft-open" data-fortune>
            <span class="ft-open-ic" aria-hidden="true">🔮</span>
            <span class="grow"><b>오늘의 운세</b><span class="small muted"> 재물운 · 손님운 · 거래처운</span></span>
            ${fortuneSeen() ? '' : '<span class="fortune-new">NEW</span>'}
            <span class="chev" aria-hidden="true">›</span>
          </button>

          <section>
            <h3 class="set-title">🎯 이번 주 미션 <span class="small muted">매주 월요일 새로 시작</span></h3>
            <div class="set-card"><ul class="ms-list">${lv.missions.week.map(missionLi).join('')}</ul></div>
          </section>

          ${
            lv.missions.start.every((x) => x.done)
              ? ''
              : `<section>
            <h3 class="set-title">🌱 시작 미션 <span class="small muted">${lv.missions.start.filter((x) => x.done).length}/${lv.missions.start.length} 완료</span></h3>
            <div class="set-card"><ul class="ms-list">${lv.missions.start.map(missionLi).join('')}</ul></div>
          </section>`
          }

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
              <div class="set-row static"><span class="grow">성장 미션</span><b>${num(p.missions)}점</b></div>
            </div>
          </section>

          <section>
            <h3 class="set-title">포인트 받는 방법</h3>
            <div class="set-card">
              <ul class="lv-how">
                <li>영수증 저장 <b>+${POINTS.receipt}</b> (자동 인식·직접 입력 모두, 하루 ${DAILY_RECEIPT_CAP / POINTS.receipt}건까지)</li>
                <li>새 메뉴 만들기 <b>+${POINTS.menu}</b> (판매가를 넣은 메뉴)</li>
                <li>메뉴에 매입 품목 재료 연결 <b>+${POINTS.ingredient}</b> (판매가를 넣은 메뉴)</li>
                <li>같은 품목 묶기 <b>+${POINTS.link}</b></li>
                <li>성장 미션 달성 (이번 주 미션은 매주 새로)</li>
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
            <p class="set-note">레벨업 선물(추가 인식)은 구독 중에 요금제 한도를 다 쓴 뒤 1장씩 써요. 무료 체험 중에는 쌓아 두었다가 구독하면 바로 쓸 수 있어요. 하루 10장·한 달 20장까지 받고, 넘는 몫은 다음 날·다음 달에 이어서 받아요.</p>
          </details>
        </div>`;
      body.querySelector('[data-fortune]').addEventListener('click', (e) => {
        e.currentTarget.querySelector('.fortune-new')?.remove();
        openFortuneSheet();
      });
      const box = body.querySelector('.lv-gifts');
      loadGifts().then(
        (g) => {
          if (!box.isConnected) return;
          box.innerHTML = `<p>지금 남은 선물 <b>${num(g.balance)}장</b> <span class="small muted">(지금까지 ${num(g.granted)}장)</span></p>${
            g.usable === false && g.balance ? '<p class="small">🔒 무료 체험 중에는 쌓아 두기만 해요. 구독하면 바로 쓸 수 있어요.</p>' : ''
          }${
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
