// 로그인 / 회원가입 / 이메일 인증 안내 / 비밀번호 찾기 / 새 비밀번호 화면
import { esc } from '../lib/format.js';
import { auth, landing } from '../auth.js';
import { authMessage, isEmail, passwordProblem, MIN_PASSWORD } from '../lib/authErrors.js';
import { inAppOf, escapeUrl, escapeHint } from '../lib/inapp.js';

// 인증 코드를 기다리는 가입 (앱 안 브라우저는 메일 앱을 다녀오면 새로 열리기도 해서 기기에 1시간 기억)
const PENDING = 'costnote:pending-signup';
const pendingEmail = () => {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING) || 'null');
    return p && Date.now() - p.at < 3600_000 ? p.email : null;
  } catch {
    return null;
  }
};
const setPending = (e) => {
  try {
    if (e) localStorage.setItem(PENDING, JSON.stringify({ email: e, at: Date.now() }));
    else localStorage.removeItem(PENDING);
  } catch {}
};

// 소개 페이지의 [지금 써 보기]는 ?start=signup 으로 와서 가입 화면부터 보여 줌
const startSignup = new URLSearchParams(location.search).get('start') === 'signup';
if (startSignup) {
  const q = new URLSearchParams(location.search);
  q.delete('start');
  history.replaceState(null, '', location.pathname + (q.size ? `?${q}` : '') + location.hash);
}
const waiting = !startSignup && pendingEmail();
let mode = startSignup ? 'signup' : waiting ? 'sent' : 'login'; // login | signup | sent | forgot | forgot-sent
let email = waiting || '';
let notice = null; // {kind: 'error'|'ok', text}

// 메일 링크로 들어왔을 때 첫 안내 (링크 확인은 로그인 기능을 불러온 뒤 끝나므로 처음 그릴 때 정함)
let landingChecked = false;
function checkLanding() {
  if (landingChecked) return;
  landingChecked = true;
  if (landing.error) notice = { kind: 'error', text: landing.error === 'otp_expired' ? '링크가 만료됐거나 이미 쓴 링크예요. 메일을 다시 받아 주세요.' : '링크를 확인하지 못했어요. 다시 시도해 주세요.' };
}

const field = (name, label, type, extra = '') =>
  `<label>${label}<input name="${name}" type="${type}" ${extra} required></label>`;
const emailField = () => field('email', '이메일', 'email', `autocomplete="username" inputmode="email" autocapitalize="off" spellcheck="false" value="${esc(email)}"`);
const noticeHtml = () => (notice ? `<p class="auth-notice ${notice.kind}" role="${notice.kind === 'error' ? 'alert' : 'status'}">${esc(notice.text)}</p>` : '');
const link = (to, text) => `<button type="button" class="link" data-auth-go="${to}">${text}</button>`;

function body() {
  if (auth.recovery)
    return `<h2>새 비밀번호 정하기</h2>
      <form data-auth="recovery" novalidate>
        ${field('password', `새 비밀번호 (${MIN_PASSWORD}자 이상, 영문+숫자)`, 'password', 'autocomplete="new-password"')}
        ${field('password2', '새 비밀번호 확인', 'password', 'autocomplete="new-password"')}
        ${noticeHtml()}
        <button class="btn primary" type="submit">비밀번호 바꾸기</button>
      </form>`;
  if (mode === 'signup')
    return `<h2>회원가입</h2>
      <form data-auth="signup" novalidate>
        ${emailField()}
        ${field('password', `비밀번호 (${MIN_PASSWORD}자 이상, 영문+숫자)`, 'password', 'autocomplete="new-password"')}
        ${field('password2', '비밀번호 확인', 'password', 'autocomplete="new-password"')}
        <label class="agree"><input type="checkbox" name="agree"><span><a href="https://costnote.co.kr/terms" target="_blank" rel="noopener">이용약관</a>과 <a href="https://costnote.co.kr/privacy" target="_blank" rel="noopener">개인정보 수집·이용 및 국외 이전</a>에 동의합니다 (필수)</span></label>
        ${noticeHtml()}
        <button class="btn primary" type="submit">가입하기</button>
      </form>
      <p class="auth-links">이미 계정이 있나요? ${link('login', '로그인')}</p>`;
  if (mode === 'sent')
    return `<h2>메일함을 확인해 주세요</h2>
      <p class="auth-text"><b>${esc(email)}</b>(으)로 인증 메일을 보냈어요.<br>메일에 있는 <b>인증 코드 6자리</b>를 아래에 넣어 주세요.</p>
      <form data-auth="code" novalidate>
        <label>인증 코드<input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="10" placeholder="숫자 6자리" class="code-input" required></label>
        ${noticeHtml()}
        <button class="btn primary" type="submit">인증하고 시작하기</button>
      </form>
      <p class="muted small">메일이 안 보이면 스팸함도 확인해 주세요. 메일의 버튼으로 인증했다면 여기서 로그인하면 돼요.</p>
      <div class="btn-col">
        <button class="btn ghost" type="button" data-auth-act="resend">인증 메일 다시 보내기</button>
        <button class="btn ghost" type="button" data-auth-go="login">로그인하러 가기</button>
      </div>`;
  if (mode === 'forgot')
    return `<h2>비밀번호 찾기</h2>
      <p class="auth-text">가입한 이메일을 넣으면 비밀번호를 새로 정하는 링크를 보내 드려요.</p>
      <form data-auth="forgot" novalidate>
        ${emailField()}
        ${noticeHtml()}
        <button class="btn primary" type="submit">재설정 메일 받기</button>
      </form>
      <p class="auth-links">${link('login', '로그인으로 돌아가기')}</p>`;
  if (mode === 'forgot-sent')
    return `<h2>메일을 보냈어요</h2>
      <p class="auth-text"><b>${esc(email)}</b>(으)로 비밀번호 재설정 링크를 보냈어요. 메일의 링크를 눌러 새 비밀번호를 정한 뒤, 이 앱에서 새 비밀번호로 로그인하세요.</p>
      <p class="muted small">가입된 이메일일 때만 메일이 가요. 메일이 안 보이면 스팸함도 확인해 주세요.</p>
      <div class="btn-col"><button class="btn primary" type="button" data-auth-go="login">로그인하러 가기</button></div>`;
  return `<h2>로그인</h2>
    <form data-auth="login" novalidate>
      ${emailField()}
      ${field('password', '비밀번호', 'password', 'autocomplete="current-password"')}
      ${noticeHtml()}
      <button class="btn primary" type="submit">로그인</button>
    </form>
    <p class="auth-links">${link('forgot', '비밀번호를 잊었어요')}</p>
    <p class="auth-links">처음이신가요? ${link('signup', '회원가입')}</p>`;
}

export function renderAuth(app) {
  checkLanding();
  app.innerHTML = `<main class="auth-screen">
    ${inAppNote()}
    <header class="auth-brand"><img src="./icon.svg" alt="" width="56" height="56"><h1>코스트노트</h1><p class="muted">매입 · 원가 관리</p></header>
    <section class="auth-card">${body()}</section>
  </main>`;
}

/** 인스타·카카오톡 등 앱 안 브라우저면 밖에서 열기 권하기 (여기서 가입해도 인증 코드로 문제없음) */
function inAppNote() {
  const info = inAppOf(navigator.userAgent);
  if (!info) return '';
  const browser = info.os === 'android' ? '크롬' : 'Safari';
  const direct = escapeUrl(info, location.href);
  return `<aside class="inapp-note" role="note"><p>📱 지금 <b>${esc(info.name)}</b> 앱 안에서 열려 있어요. <b>${browser}</b>에서 열면 홈 화면에 앱으로 설치해 쓸 수 있어요.</p>
    ${direct ? `<a class="btn small-btn" href="${esc(direct)}">${browser}에서 열기</a>` : `<p>${escapeHint(info)}</p>`}</aside>`;
}

const go = (m, n = null) => {
  if (m !== 'sent' && mode === 'sent') setPending(null);
  mode = m;
  notice = n;
};

/** 화면 클릭·제출 처리. 다시 그려야 하면 true */
export async function handleAuthEvent(e, rerender) {
  const nav = e.target.closest?.('[data-auth-go]');
  if (e.type === 'click' && nav) {
    rememberEmail(e.target.closest('main'));
    go(nav.dataset.authGo);
    return rerender();
  }
  if (e.type === 'click' && e.target.closest?.('[data-auth-act=resend]')) {
    try {
      await auth.resend(email);
      notice = { kind: 'ok', text: '인증 메일을 다시 보냈어요.' };
    } catch (err) {
      notice = { kind: 'error', text: authMessage(err) };
    }
    return rerender();
  }
  if (e.type !== 'submit') return;
  const form = e.target.closest('form[data-auth]');
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.auth;
  const v = (n) => form.elements[n]?.value ?? '';
  if (form.elements.email) email = v('email').trim();
  // 오류는 화면을 다시 그리지 않고 안내만 바꿈 (적어 둔 비밀번호가 지워지지 않게)
  const fail = (text) => {
    notice = { kind: 'error', text };
    if (!form.isConnected) return rerender();
    form.querySelector('.auth-notice')?.remove();
    form.querySelector('[type=submit]').insertAdjacentHTML('beforebegin', noticeHtml());
  };
  if (form.elements.email && !isEmail(email)) return fail('이메일 주소를 확인해 주세요.');
  if (kind === 'signup' || kind === 'recovery') {
    const problem = passwordProblem(v('password'));
    if (problem) return fail(problem);
    if (v('password') !== v('password2')) return fail('비밀번호 확인이 일치하지 않아요.');
  }
  if (kind === 'signup' && !form.elements.agree.checked) return fail('이용약관과 개인정보 처리에 동의해 주세요.');
  if (kind === 'login' && !v('password')) return fail('비밀번호를 넣어 주세요.');
  const code = v('code').replace(/\D/g, '');
  if (kind === 'code' && code.length < 6) return fail('메일에 있는 숫자 6자리를 넣어 주세요.');

  const btn = form.querySelector('[type=submit]');
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    if (kind === 'login') {
      try {
        await auth.signIn(email, v('password'));
      } catch (err) {
        // 아직 인증 안 한 계정: 코드 넣는 화면으로
        if (err?.code === 'email_not_confirmed' || /not confirmed/i.test(err?.message || '')) {
          go('sent', { kind: 'error', text: '아직 이메일 인증을 하지 않았어요. 메일의 인증 코드를 넣어 주세요.' });
          setPending(email);
          return rerender();
        }
        throw err;
      }
      go('login'); // 로그인되면 앱 화면으로 바뀜
    } else if (kind === 'code') {
      try {
        await auth.verifyCode(email, code);
      } catch (err) {
        if (err?.code === 'otp_expired' || /expired|invalid/i.test(err?.message || '')) return fail('코드가 맞지 않거나 시간이 지났어요. 다시 확인하거나 메일을 다시 받아 주세요.');
        throw err;
      }
      go('login'); // 인증되면 바로 로그인 → 앱 화면으로 바뀜
    } else if (kind === 'signup') {
      const r = await auth.signUp(email, v('password'));
      if (r === 'exists') return fail('이미 가입된 이메일이에요. 로그인하거나 비밀번호 찾기를 해 주세요.');
      go('sent');
      setPending(email);
    } else if (kind === 'forgot') {
      await auth.sendReset(email);
      go('forgot-sent');
    } else if (kind === 'recovery') {
      await auth.updatePassword(v('password'));
      go('login', { kind: 'ok', text: '비밀번호를 바꿨어요.' });
    }
    rerender();
  } catch (err) {
    fail(authMessage(err));
  } finally {
    if (btn.isConnected) {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
  }
}

function rememberEmail(root) {
  const input = root?.querySelector('input[name=email]');
  if (input) email = input.value.trim();
}

/** 로그아웃 후 로그인 화면에 띄울 안내 */
export function setAuthNotice(text) {
  go('login', text ? { kind: 'ok', text } : null);
}
