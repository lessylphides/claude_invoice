// 오늘의 운세: 재미로 보는 글(직접 쓴 문장) + 내 장부에서 뽑은 진짜 장사 팁
// 같은 사장님·같은 날에는 언제 열어도 같은 운세
// 칸마다 사장님별로 순서를 섞어 두고 날마다 다음 문장 → 목록을 한 바퀴 돌기 전에는 같은 문장이 다시 나오지 않음
import { HEADLINES, MONEY, GUEST, VENDOR, ADVICE, TIPS, KEYWORDS } from './fortuneText.js';
import { seasonsOf } from './fortuneSeason.js';
import { normKey, won } from './format.js';

/** 문자열 → 32비트 수 (FNV-1a) */
export function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
const dayNum = (ymd) => Math.round(Date.parse(`${ymd}T00:00:00Z`) / 86400000);

/** seed 로 섞은 0..n-1 순서 (Fisher-Yates + mulberry32) */
const permCache = new Map();
function permutation(n, seed) {
  const key = `${n}|${seed}`;
  if (permCache.has(key)) return permCache.get(key);
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const p = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  if (permCache.size > 200) permCache.clear();
  permCache.set(key, p);
  return p;
}
/** 사장님별로 섞은 순서에서 step 번째 문장 (목록 길이만큼은 겹치지 않음) */
export const rotate = (arr, who, slot, step) => arr[permutation(arr.length, hash(`${who}|${slot}`))[((step % arr.length) + arr.length) % arr.length]];

/** 이맘때 한마디: 해당 시기에만, 이틀에 한 번 (같은 시기 안에서 덜 겹치게) */
export function seasonLine(who, ymd) {
  const ss = seasonsOf(ymd);
  if (!ss.length) return null;
  const n = dayNum(ymd);
  if ((n + hash(who)) % 2) return null;
  const lines = ss.flatMap((x) => x.lines.map((text) => ({ label: x.label, text })));
  return rotate(lines, who, `season|${ss.map((x) => x.id).join(',')}`, Math.floor(n / 2));
}
/** 별점 3~5 (재미로 보는 운세라 너무 나쁘게 나오지 않게) */
const stars = (seed) => 3 + (hash(seed) % 3);

/**
 * @param {string} who 계정 id (없으면 이 기기)
 * @param {string} ymd 한국 날짜
 */
export function todayFortune(who, ymd) {
  const s = `${who}|${ymd}`;
  const n = dayNum(ymd);
  const hour = 10 + (hash(`${s}|time`) % 12); // 오전 10시 ~ 오후 9시
  return {
    date: ymd,
    headline: rotate(HEADLINES, who, 'h', n),
    money: { stars: stars(`${s}|ms`), text: rotate(MONEY, who, 'm', n) },
    guest: { stars: stars(`${s}|gs`), text: rotate(GUEST, who, 'g', n) },
    vendor: { stars: stars(`${s}|vs`), text: rotate(VENDOR, who, 'v', n) },
    advice: rotate(ADVICE, who, 'a', n),
    season: seasonLine(who, ymd),
    keyword: rotate(KEYWORDS, who, 'k', n),
    luckyTime: hour < 12 ? `오전 ${hour}시` : hour === 12 ? '낮 12시' : `오후 ${hour - 12}시`,
  };
}

const kstDay = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
const totalOf = (p) => (p.items || []).reduce((s, i) => s + (Number(i.amount) || 0), 0);
const unitOf = (i) => {
  const q = Number(i.qty) || 0;
  const amt = Number(i.amount) || 0;
  return q > 0 && amt > 0 ? amt / q : 0;
};

/**
 * 내 장부에서 뽑은 장사 팁 후보 (중요한 순)
 * @returns {Array<{icon, text}>}
 */
export function ledgerTips(data, now = Date.now()) {
  const purchases = data?.purchases || [];
  const menus = data?.menus || [];
  const today = kstDay(now);
  const month = today.slice(0, 7);
  const tips = [];

  // 1. 이번 달 세금계산서 미발행
  const unissued = new Map();
  for (const p of purchases)
    if (String(p.date).startsWith(month) && p.payType === 'tax' && !p.taxIssued)
      unissued.set(p.vendor || '거래처', (unissued.get(p.vendor || '거래처') || 0) + totalOf(p));
  const unissuedSum = [...unissued.values()].reduce((a, b) => a + b, 0);
  if (unissuedSum > 0) {
    const [topV] = [...unissued.entries()].sort((a, b) => b[1] - a[1])[0];
    tips.push({ icon: '🧾', text: `이번 달 세금계산서 미발행이 ${won(unissuedSum)} 있어요. ${topV}부터 챙겨 보세요.` });
  }

  // 2. 최근 30일 안에 단가가 크게 바뀐 품목 (같은 용량끼리, 직전 매입과 비교)
  const hist = new Map();
  for (const p of [...purchases].sort((a, b) => String(a.date).localeCompare(String(b.date))))
    for (const i of p.items || []) {
      const u = unitOf(i);
      if (!u || !i.name) continue;
      const k = `${normKey(i.name)}|${Number(i.packSize) || 0}${i.packUnit || ''}`;
      const arr = hist.get(k) || [];
      arr.push({ name: i.name, date: p.date, u });
      hist.set(k, arr);
    }
  const since = kstDay(now - 30 * 86400000);
  let up = null;
  let down = null;
  for (const arr of hist.values()) {
    if (arr.length < 2) continue;
    const last = arr.at(-1);
    const prev = arr.at(-2);
    if (last.date < since || last.u === prev.u) continue;
    const r = (last.u - prev.u) / prev.u;
    if (r >= 0.05 && (!up || r > up.r)) up = { name: last.name, r };
    if (r <= -0.05 && (!down || r < down.r)) down = { name: last.name, r };
  }
  if (up) tips.push({ icon: '📈', text: `${up.name} 단가가 지난번보다 ${Math.round(up.r * 100)}% 올랐어요. 이 재료가 들어간 메뉴 원가를 확인해 보세요.` });

  // 3. 판매가가 빈 메뉴
  const noPrice = menus.filter((m) => !(Number(m.price) > 0 || Number(m.bottlePrice) > 0)).length;
  if (noPrice) tips.push({ icon: '🍽️', text: `판매가가 비어 있는 메뉴가 ${noPrice}개 있어요. 채우면 원가율이 보이고 포인트도 받아요.` });

  // 4. 한동안 기록이 없음
  const lastAt = Math.max(0, ...purchases.map((p) => p.createdAt || 0));
  if (lastAt) {
    const gap = Math.floor((Date.parse(today) - Date.parse(kstDay(lastAt))) / 86400000);
    if (gap >= 3) tips.push({ icon: '📷', text: `마지막 기록이 ${gap}일 전이에요. 밀린 영수증을 찍어 두면 한 번에 정리돼요.` });
  }

  // 5. 한 거래처에 몰린 매입
  const mine = purchases.filter((p) => String(p.date).startsWith(month));
  if (mine.length >= 3) {
    const byV = new Map();
    for (const p of mine) byV.set(p.vendor || '거래처', (byV.get(p.vendor || '거래처') || 0) + totalOf(p));
    const sum = [...byV.values()].reduce((a, b) => a + b, 0);
    const [v, amt] = [...byV.entries()].sort((a, b) => b[1] - a[1])[0];
    if (sum > 0 && amt / sum >= 0.5)
      tips.push({ icon: '🤝', text: `이번 달 매입의 ${Math.round((amt / sum) * 100)}%가 ${v}예요. 자주 사는 품목 하나만 다른 곳과 단가를 비교해 보세요.` });
  }

  if (down) tips.push({ icon: '📉', text: `${down.name}이(가) 지난번보다 ${Math.round(-down.r * 100)}% 싸졌어요. 같은 거래처라면 이번에 넉넉히 사 둘지 생각해 보세요.` });
  return tips;
}

/** 오늘 보여 줄 장사 팁 1개: 장부 팁이 있으면 그중에서, 없으면 일반 팁 */
export function todayTip(data, who, ymd, now = Date.now()) {
  const tips = ledgerTips(data, now);
  if (tips.length) {
    // 가장 중요한 두 개 중 하나를 날마다 번갈아
    const top = tips.slice(0, 2);
    return { ...top[hash(`${who}|${ymd}|tip`) % top.length], fromLedger: true };
  }
  return { icon: '💡', text: rotate(TIPS, who, 't', dayNum(ymd)), fromLedger: false };
}
