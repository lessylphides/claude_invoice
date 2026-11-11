// 클로드 연결: 로그인·허락 화면 (/oauth/authorize)
// 1) 클로드가 이 주소를 열면, 코스트노트 계정으로 로그인 (이 브라우저에 앱 로그인이 남아 있으면 그대로 사용)
// 2) "클로드가 내 장부를 보고, 허락하면 판매가·분류를 바꿀 수 있어요" 확인 → 허락하면 클로드로 돌아감
// 비밀번호는 Supabase 로만 가고, 서버는 로그인 토큰으로 누구인지만 확인 (OAuth 승인에는 계정 id 만 담음)
import { AuthorizationError, CimdFetchError } from '@cloudflare/workers-oauth-provider';
import { SUPABASE_URL, SUPABASE_KEY } from '../../config.js';

/**
 * 클로드에게만 연결 허용: 클로드 앱(웹·데스크톱·휴대폰)의 돌아갈 주소, 또는 Claude Code(이 컴퓨터) 주소.
 * 다른 곳으로 토큰이 가면(가짜 "Claude" 이름을 단 피싱 등) 장부가 새어 나갈 수 있어서 막음
 */
export function allowedRedirect(uri) {
  try {
    const u = new URL(uri);
    if (u.href === 'https://claude.ai/api/mcp/auth_callback') return true;
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.pathname === '/callback';
  } catch {
    return false;
  }
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const SESSION_KEY = 'costnote.auth'; // 앱의 로그인 저장 이름 (src/auth.js AUTH_STORAGE_KEY 와 같아야 함)

function page(body, { nonce = '', status = 200, headers = new Headers() } = {}) {
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'no-referrer');
  headers.set(
    'content-security-policy',
    `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src ${SUPABASE_URL}; img-src 'self'; base-uri 'none'; frame-ancestors 'none'`,
  );
  return new Response(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>코스트노트 · 클로드 연결</title>
<style>
:root{color-scheme:light dark;--bg:#f4f5f8;--card:#fff;--ink:#1d2129;--muted:#6b7280;--line:#e3e6ec;--accent:#2f6fde}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#181b21;--ink:#eef0f4;--muted:#9aa1ad;--line:#2a2f38;--accent:#5b8ff0}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
main{max-width:420px;margin:0 auto;padding:40px 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;margin-bottom:14px}
h1{font-size:20px;margin:0 0 6px}p{margin:0 0 10px}.muted{color:var(--muted);font-size:14px}
ul{margin:6px 0 0;padding-left:20px;font-size:15px}label{display:block;font-size:14px;margin:10px 0 4px}
input{width:100%;box-sizing:border-box;font:inherit;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink)}
button{font:inherit;font-weight:700;width:100%;padding:13px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--ink);margin-top:10px;cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}.warn{color:#c2410c}[hidden]{display:none!important}
.who{font-weight:700}
</style></head><body><main>${body}</main></body></html>`,
    { status, headers },
  );
}

const errorPage = (msg) =>
  page(`<div class="card"><h1>연결하지 못했어요</h1><p>${esc(msg)}</p><p class="muted">클로드로 돌아가서 다시 연결해 주세요.</p></div>`, { status: 400 });

async function userOf(token, fetchImpl) {
  if (!token) return null;
  const res = await fetchImpl(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const u = await res.json().catch(() => null);
  return u?.id ? { id: u.id, email: u.email || '' } : null;
}

export async function handleAuthorize(request, env, { fetchImpl = fetch } = {}) {
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (request.method === 'GET') return await showPage(request, oauth);
    if (request.method === 'POST') return await decide(request, oauth, fetchImpl);
    return new Response('Method Not Allowed', { status: 405 });
  } catch (e) {
    if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
    if (e instanceof AuthorizationError) return errorPage(e.description || '연결 요청이 올바르지 않거나 시간이 지났어요.');
    if (e instanceof CimdFetchError) return errorPage('연결을 요청한 앱을 확인하지 못했어요.');
    throw e;
  }
}

async function showPage(request, oauth) {
  const req = await oauth.parseAuthRequest(request);
  if (!allowedRedirect(req.redirectUri)) return errorPage('코스트노트는 클로드(Claude)에만 연결할 수 있어요.');
  const d = await oauth.describeConsent(req);
  const consent = await oauth.beginConsent(req);
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const app = d.clientDomain ? `${d.clientName} (${d.clientDomain})` : d.clientName;
  const body = `
<div class="card">
  <h1>🧾 코스트노트 · 클로드 연결</h1>
  <p class="muted"><b>${esc(app)}</b>이(가) 코스트노트 장부에 연결하려고 해요. 허락하면 결과가 <b>${esc(d.redirectHost)}</b>로 전달돼요.</p>
  ${d.redirectIsLoopback ? '<p class="warn">이 컴퓨터의 앱으로 연결돼요. 방금 직접 연결을 시작한 경우에만 계속하세요.</p>' : ''}
</div>
<div class="card" id="login">
  <p><b>코스트노트 계정으로 로그인</b></p>
  <form id="loginForm">
    <label for="email">이메일</label><input id="email" type="email" autocomplete="username" required>
    <label for="pw">비밀번호</label><input id="pw" type="password" autocomplete="current-password" required>
    <p class="warn" id="loginErr" hidden></p>
    <button class="primary" type="submit">로그인</button>
  </form>
</div>
<div class="card" id="consent" hidden>
  <p><span class="who" id="who"></span> 계정</p>
  <p>허락하면 클로드가 할 수 있는 일</p>
  <ul>
    <li>매입 기록, 메뉴, 원가율, 목표 원가율, 최소 마진 보기</li>
    <li>사장님이 말하면 메뉴 판매가 입력하기</li>
    <li>사장님이 말하면 메뉴 분류 만들기·옮기기</li>
  </ul>
  <p class="muted" style="margin-top:10px">지우기는 할 수 없어요. 클로드가 바꾼 내용은 코스트노트 ⚙ 설정의 '클로드가 바꾼 기록'에서 되돌릴 수 있고, 연결은 클로드 설정에서 언제든 끊을 수 있어요.</p>
  <form method="post" id="decide">
    <input type="hidden" name="handle" value="${esc(consent.handle)}">
    ${d.scope.map((s) => `<input type="hidden" name="scope" value="${esc(s)}">`).join('')}
    <input type="hidden" name="token" id="token">
    <button class="primary" name="decision" value="approve">허락하기</button>
    <button name="decision" value="deny">거절</button>
  </form>
  <button type="button" id="other" style="border:0;background:none;color:var(--muted);font-weight:400">다른 계정으로 로그인</button>
</div>
<script nonce="${nonce}">
(() => {
  const URL_ = ${JSON.stringify(SUPABASE_URL)}, KEY = ${JSON.stringify(SUPABASE_KEY)};
  const $ = (id) => document.getElementById(id);
  function show(token, email) {
    $('token').value = token; $('who').textContent = email;
    $('login').hidden = true; $('consent').hidden = false;
  }
  // 이 브라우저에 코스트노트 앱 로그인이 남아 있으면 그대로 (만료 전일 때만)
  try {
    const s = JSON.parse(localStorage.getItem(${JSON.stringify(SESSION_KEY)}) || 'null');
    if (s && s.access_token && s.expires_at && s.expires_at * 1000 > Date.now() + 60000) show(s.access_token, (s.user && s.user.email) || '');
  } catch (e) {}
  $('other').onclick = () => { $('consent').hidden = true; $('login').hidden = false; $('token').value = ''; };
  $('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    $('loginErr').hidden = true;
    try {
      const res = await fetch(URL_ + '/auth/v1/token?grant_type=password', {
        method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ email: $('email').value.trim(), password: $('pw').value }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.access_token) throw new Error(/confirm/i.test(j.msg || j.error_description || '') ? '이메일 인증을 먼저 마쳐 주세요.' : '이메일이나 비밀번호가 맞지 않아요.');
      show(j.access_token, (j.user && j.user.email) || $('email').value.trim());
    } catch (err) {
      $('loginErr').textContent = err.message || '로그인하지 못했어요.'; $('loginErr').hidden = false;
    }
  };
})();
</script>`;
  return page(body, { nonce, headers: consent.headers });
}

async function decide(request, oauth, fetchImpl) {
  const form = await request.formData();
  const handle = String(form.get('handle') || '');
  if (form.get('decision') !== 'approve') {
    const denied = await oauth.denyConsent(request, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }
  const user = await userOf(String(form.get('token') || ''), fetchImpl);
  if (!user) return errorPage('로그인이 만료됐어요. 클로드에서 다시 연결해 주세요.');
  const approved = await oauth.approveConsent(request, handle, { scope: form.getAll('scope').map(String) });
  if (!allowedRedirect(approved.request.redirectUri)) return errorPage('코스트노트는 클로드(Claude)에만 연결할 수 있어요.');
  const { redirectTo } = await oauth.completeAuthorization({
    request: approved.request,
    userId: user.id,
    metadata: { email: user.email },
    scope: approved.request.scope,
    props: { userId: user.id },
  });
  approved.headers.set('Location', redirectTo);
  return new Response(null, { status: 302, headers: approved.headers });
}
