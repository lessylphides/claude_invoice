// 로그인 / 회원가입 / 이메일 인증 안내 / 비밀번호 찾기 / 새 비밀번호 화면
import { esc } from '../lib/format.js';
import { auth, landing } from '../auth.js';
import { authMessage, isEmail, passwordProblem, MIN_PASSWORD } from '../lib/authErrors.js';

let mode = 'login'; // login | signup | sent | forgot | forgot-sent
let email = '';
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
        ${noticeHtml()}
        <button class="btn primary" type="submit">가입하기</button>
      </form>
      <p class="auth-links">이미 계정이 있나요? ${link('login', '로그인')}</p>`;
  if (mode === 'sent')
    return `<h2>메일함을 확인해 주세요</h2>
      <p class="auth-text"><b>${esc(email)}</b>(으)로 인증 메일을 보냈어요.<br>메일의 <b>인증 링크</b>를 누른 뒤, 이 앱으로 돌아와 로그인하세요.</p>
      <p class="muted small">메일이 안 보이면 스팸함도 확인해 주세요.</p>
      ${noticeHtml()}
      <div class="btn-col">
        <button class="btn primary" type="button" data-auth-go="login">로그인하러 가기</button>
        <button class="btn ghost" type="button" data-auth-act="resend">인증 메일 다시 보내기</button>
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
    <header class="auth-brand"><img src="./icon.svg" alt="" width="56" height="56"><h1>코스트노트</h1><p class="muted">매입 · 원가 관리</p></header>
    <section class="auth-card">${body()}</section>
  </main>`;
}

const go = (m, n = null) => {
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
  if (kind === 'login' && !v('password')) return fail('비밀번호를 넣어 주세요.');

  const btn = form.querySelector('[type=submit]');
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    if (kind === 'login') {
      await auth.signIn(email, v('password'));
      go('login'); // 로그인되면 앱 화면으로 바뀜
    } else if (kind === 'signup') {
      const r = await auth.signUp(email, v('password'));
      if (r === 'exists') return fail('이미 가입된 이메일이에요. 로그인하거나 비밀번호 찾기를 해 주세요.');
      go('sent');
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
  go('login', { kind: 'ok', text });
}
