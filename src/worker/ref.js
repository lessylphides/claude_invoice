// 가입 경로 세기 (광고 효과 확인용). 개인 정보 없이 꼬리표·날짜·계정 id 만
// 1) costnote.co.kr/?ref=ig1 로 들어오면: 브라우저에 30일 기억(쿠키, 처음 온 경로만) + 방문 수 +1
// 2) 가입할 때 앱이 꼬리표를 계정 정보(user_metadata.ref)에 함께 저장
// 3) 로그인 뒤 앱이 POST /api/ref → 서버가 계정 정보에서 꼬리표를 읽어 '이 계정은 ig1 로 가입' 기록 (한 번만)
import { cleanRef, REF_COOKIE, REF_DAYS } from '../lib/ref.js';
import { json, fail, authUser } from './common.js';
import { db, kstDate, isOwner } from './billing.js';
import { sendMail, newSignupMail } from './mail.js';

const NEW_WINDOW = 3 * 86400000; // 가입한 지 3일 안에 처음 로그인한 회원만 '새 가입'으로 알림 (기능 넣기 전 회원 제외)

const cookieOf = (request, name) => (request.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] ?? null;

// 사람이 아닌 방문: 광고 검사·링크 미리보기 로봇, 브라우저의 '미리 불러오기'(누르기 전에 받아 둠)
const BOT_UA = /bot|crawl|spider|preview|facebookexternalhit|facebot|meta-externalagent|meta-externalfetcher|slurp|headless|lighthouse|python|curl|wget|okhttp/i;
export function isRealVisit(request) {
  const h = (k) => (request.headers.get(k) || '').toLowerCase();
  if (BOT_UA.test(h('user-agent'))) return false;
  if (/prefetch|prerender/.test(h('sec-purpose') + h('purpose') + h('x-purpose') + h('x-moz'))) return false;
  if (h('x-fb-preload') || h('x-fb-prefetch')) return false;
  return true;
}

/** 같은 사람 구분값 (IP + 브라우저, 짧은 해시라 원래 값으로 되돌릴 수 없음). 앱 안 브라우저는 쿠키가 잘 안 남아서 이걸로 중복을 거름 */
async function visitorKey(request, salt) {
  const raw = `${request.headers.get('cf-connecting-ip') || ''}|${request.headers.get('user-agent') || ''}|${salt}`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(buf).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 꼬리표별 하루 한 사람 한 번만 셈. kind: 'visit'(소개 페이지) | 'open'(앱을 엶) */
export async function countRef(env, request, ref, kind, now = Date.now()) {
  const d = db(env);
  if (!d || !isRealVisit(request)) return false;
  const day = kstDate(now);
  const who = await visitorKey(request, `${env.BACKUP_SECRET || 'costnote'}|${day}`);
  const seenKey = `refseen:${kind}:${ref}:${day}`;
  const seen = (await d.get(seenKey).catch(() => null)) || [];
  if (seen.includes(who)) return false;
  await d.put(seenKey, [...seen, who].slice(-5000)).catch(() => {});
  const key = kind === 'open' ? `refopen:${ref}` : `refvisit:${ref}`;
  const v = (await d.get(key).catch(() => null)) || { total: 0, days: {} };
  v.total++;
  v.days[day] = (v.days[day] || 0) + 1;
  await d.put(key, v).catch(() => {});
  return true;
}

/** 소개 페이지 응답에 꼬리표 쿠키 붙이기 + 방문 수 (사람·하루 한 번) */
export async function withLandingRef(request, response, env, now = Date.now()) {
  const ref = cleanRef(new URL(request.url).searchParams.get('ref'));
  if (!ref || request.method !== 'GET') return response;
  const first = !cookieOf(request, REF_COOKIE);
  // nv=1: 앱 안 브라우저에서 '밖에서 열기'로 다시 온 것 (이미 센 방문)
  if (first && new URL(request.url).searchParams.get('nv') !== '1') await countRef(env, request, ref, 'visit', now);
  const res = new Response(response.body, response);
  // 처음 온 경로만 기억 (나중에 다른 링크로 와도 덮어쓰지 않음). 앱(app.costnote.co.kr)에서도 읽게 상위 도메인
  if (first) res.headers.append('set-cookie', `${REF_COOKIE}=${ref}; Domain=costnote.co.kr; Path=/; Max-Age=${REF_DAYS * 86400}; Secure; SameSite=Lax`);
  return res;
}

/** POST /api/ref/open {ref}: 광고·소개 페이지에서 앱을 처음 연 기기 (로그인 전, 사람·하루 한 번) */
export async function handleRefOpen(request, env, { now = Date.now() } = {}) {
  if (request.method !== 'POST') return fail(405, 'method', 'POST 만 받습니다.');
  const ref = cleanRef((await request.text().catch(() => '')).slice(0, 40));
  if (ref) await countRef(env, request, ref, 'open', now);
  return new Response(null, { status: 204 });
}

/** POST /api/ref: 로그인 뒤 계정마다 한 번. 가입 경로 기록 (계정 정보에 저장된 꼬리표만 믿음) + 새 가입이면 운영자에게 메일 */
export async function handleRef(request, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (request.method !== 'POST') return fail(405, 'method', 'POST 만 받습니다.');
  const a = await authUser(request, fetchImpl);
  if (a.error) return a.error;
  const ref = cleanRef(a.user.meta?.ref);
  const d = db(env);
  if (!d) return json(200, { ref });
  if (ref) {
    const key = `refuser:${a.user.id}`;
    if (!(await d.get(key))) await d.put(key, { ref, at: now, created: a.user.createdAt ?? null });
  }
  const joinedKey = `joined:${a.user.id}`;
  if (!(await d.get(joinedKey))) {
    await d.put(joinedKey, { at: now, ref, email: a.user.email }); // email: 다음 날 사용 안내 메일용
    const created = Date.parse(a.user.createdAt || '');
    if (created && now - created < NEW_WINDOW && !isOwner(env, a.user.email)) {
      const owner = String(env.OWNER_EMAILS || '').split(',')[0]?.trim();
      if (owner) await sendMail(env, fetchImpl, { to: owner, ...newSignupMail({ email: a.user.email, ref }) });
    }
  }
  return json(200, { ref });
}

/** 운영 현황: 꼬리표별 방문 → 가입 → 구독 */
export async function refStats(env, payingUids = new Set()) {
  const d = db(env);
  if (!d?.list) return [];
  const all = async (prefix) => {
    const out = [];
    let cursor = null;
    do {
      const page = await d.list(prefix, cursor);
      out.push(...page.keys);
      cursor = page.next;
    } while (cursor);
    return out;
  };
  const rows = new Map();
  const row = (ref) => rows.get(ref) || rows.set(ref, { ref, visits: 0, opens: 0, signups: 0, paying: 0 }).get(ref);
  for (const k of await all('refvisit:')) row(k.slice(9)).visits = (await d.get(k))?.total || 0;
  for (const k of await all('refopen:')) row(k.slice(8)).opens = (await d.get(k))?.total || 0;
  for (const k of await all('refuser:')) {
    const v = await d.get(k);
    if (!v?.ref) continue;
    const r = row(v.ref);
    r.signups++;
    if (payingUids.has(k.slice(8))) r.paying++;
  }
  return [...rows.values()].sort((a, b) => b.signups - a.signups || b.visits - a.visits);
}
