// 회원 계정: 로그인 상태 관리 (Supabase Auth)
// - 비밀번호는 이 앱이 아니라 Supabase 가 안전하게 보관합니다.
// - 이메일 인증·비밀번호 재설정 링크는 메일 앱에서 열리므로(아이폰은 홈 화면 앱과 Safari 저장 공간이 다름)
//   링크로 연 브라우저에서 끝내고, 앱에서는 다시 로그인하면 되게 만듭니다 (implicit 방식: 같은 브라우저 조건 없음).
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const AUTH_STORAGE_KEY = 'costnote.auth';

// 메일 링크로 들어왔는지 (주소 # 뒤에 type=signup / recovery, 또는 오류)
const hash = new URLSearchParams(location.hash.slice(1));
export const landing = {
  type: hash.get('type'),
  error: hash.get('error_code') || hash.get('error'),
};

const state = { ready: false, session: null, recovery: landing.type === 'recovery' && !landing.error };
const listeners = new Set();
const notify = () => listeners.forEach((f) => f());

let clientP = null;
/** Supabase 연결 (로그인 기능과 장부 동기화가 같이 씀) */
export function client() {
  clientP ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: AUTH_STORAGE_KEY },
    }),
  );
  return clientP;
}

export const auth = {
  get ready() {
    return state.ready;
  },
  get user() {
    return state.session?.user ?? null;
  },
  /** 비밀번호 재설정 링크로 들어와 새 비밀번호를 정해야 하는 상태 */
  get recovery() {
    return state.recovery;
  },
  subscribe(f) {
    listeners.add(f);
    return () => listeners.delete(f);
  },

  async init() {
    const c = await client();
    c.auth.onAuthStateChange((event, session) => {
      state.session = session;
      if (event === 'PASSWORD_RECOVERY') state.recovery = true;
      if (event === 'SIGNED_OUT') state.recovery = false;
      if (state.ready) setTimeout(notify); // supabase 내부 잠금 안에서 바로 다른 호출을 하지 않게
    });
    const { data } = await c.auth.getSession();
    state.session = data.session;
    state.ready = true;
    // 메일 링크 흔적(#access_token=...)은 주소창에서 지움
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  },

  /** 서버(/api/...)에 로그인을 증명할 토큰 (만료됐으면 새로 받아 옴) */
  async accessToken() {
    const { data } = await (await client()).auth.getSession();
    return data.session?.access_token ?? null;
  },
  async signIn(email, password) {
    const { error } = await (await client()).auth.signInWithPassword({ email, password });
    if (error) throw error;
  },
  /** @returns {'sent' | 'exists'} 'exists' = 이미 가입된 이메일 (Supabase 는 보안상 오류 대신 빈 계정을 돌려줌) */
  async signUp(email, password) {
    const { data, error } = await (await client()).auth.signUp({ email, password, options: { emailRedirectTo: appUrl() } });
    if (error) throw error;
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return 'exists';
    return 'sent';
  },
  async resend(email) {
    const { error } = await (await client()).auth.resend({ type: 'signup', email, options: { emailRedirectTo: appUrl() } });
    if (error) throw error;
  },
  async sendReset(email) {
    const { error } = await (await client()).auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
    if (error) throw error;
  },
  async updatePassword(password) {
    const { error } = await (await client()).auth.updateUser({ password });
    if (error) throw error;
    state.recovery = false;
    notify();
  },
  async signOut() {
    await (await client()).auth.signOut({ scope: 'local' });
    state.session = null;
    state.recovery = false;
    notify();
  },
};

/** 메일 링크가 돌아올 주소: 지금 앱 주소 (#, ? 제외) */
const appUrl = () => location.origin + location.pathname;
