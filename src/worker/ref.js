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

/** 소개 페이지 응답에 꼬리표 쿠키 붙이기 + 방문 수 */
export async function withLandingRef(request, response, env, now = Date.now()) {
  const ref = cleanRef(new URL(request.url).searchParams.get('ref'));
  if (!ref || request.method !== 'GET') return response;
  const first = !cookieOf(request, REF_COOKIE);
  // nv=1: 앱 안 브라우저에서 '밖에서 열기'로 다시 온 것 (이미 센 방문)
  if (first && new URL(request.url).searchParams.get('nv') !== '1') {
    const d = db(env);
    if (d) {
      const key = `refvisit:${ref}`;
      const v = (await d.get(key).catch(() => null)) || { total: 0, days: {} };
      const day = kstDate(now);
      v.total++;
      v.days[day] = (v.days[day] || 0) + 1;
      await d.put(key, v).catch(() => {});
    }
  }
  const res = new Response(response.body, response);
  // 처음 온 경로만 기억 (나중에 다른 링크로 와도 덮어쓰지 않음). 앱(app.costnote.co.kr)에서도 읽게 상위 도메인
  if (first) res.headers.append('set-cookie', `${REF_COOKIE}=${ref}; Domain=costnote.co.kr; Path=/; Max-Age=${REF_DAYS * 86400}; Secure; SameSite=Lax`);
  return res;
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
    await d.put(joinedKey, { at: now, ref });
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
  const row = (ref) => rows.get(ref) || rows.set(ref, { ref, visits: 0, signups: 0, paying: 0 }).get(ref);
  for (const k of await all('refvisit:')) row(k.slice(9)).visits = (await d.get(k))?.total || 0;
  for (const k of await all('refuser:')) {
    const v = await d.get(k);
    if (!v?.ref) continue;
    const r = row(v.ref);
    r.signups++;
    if (payingUids.has(k.slice(8))) r.paying++;
  }
  return [...rows.values()].sort((a, b) => b.signups - a.signups || b.visits - a.visits);
}
