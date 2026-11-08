// 장부 서버 동기화 (Supabase 'ledgers' 표: 계정마다 장부 한 줄)
//
// - 이 기기(IndexedDB)에 먼저 저장하고, 바뀌면 잠시 뒤 서버에 올립니다. 인터넷이 끊겨도 이 기기에서는 계속 쓸 수 있고,
//   연결되면 올립니다.
// - 서버 장부에는 번호(rev)가 있어, 올릴 때 "내가 마지막으로 본 번호"일 때만 덮어씁니다.
//   다른 기기가 먼저 바꿨으면(번호가 다르면) 어느 쪽을 남길지 물어봅니다 (조용히 덮어쓰지 않음).
// - 다른 사람은 내 장부를 읽거나 쓸 수 없습니다 (서버의 RLS 규칙: 자기 user_id 줄만).
// - Claude API 키 같은 기기 설정은 올리지 않습니다 (장부 데이터만).

import { client, auth } from './auth.js';
import { store } from './store.js';
import { openSheet, toast } from './ui/sheet.js';
import { esc, num } from './lib/format.js';

const STATE_KEY = 'costnote.sync';
const PUSH_DELAY = 1500;

// owner: 이 기기 장부가 어느 계정 것인지, rev: 마지막으로 서버와 맞춘 번호, dirty: 아직 못 올린 변경이 있음
let st = readState();
let uid = null;
let status = 'idle'; // idle | syncing | offline | error | conflict | blocked
let timer = null;
let pushing = null;
let pushAgain = false;
let changeSeq = 0; // 이 기기에서 바뀔 때마다 1씩 (올리는 동안 또 바뀌었는지 확인)
const listeners = new Set();

function readState() {
  try {
    return { owner: null, rev: 0, dirty: false, syncedAt: null, ...JSON.parse(localStorage.getItem(STATE_KEY) || '{}') };
  } catch {
    return { owner: null, rev: 0, dirty: false, syncedAt: null };
  }
}
function saveState(patch) {
  Object.assign(st, patch);
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(st));
  } catch {}
  emit();
}
function setStatus(s) {
  status = s;
  emit();
}
const emit = () => listeners.forEach((f) => f());

const hasLocalData = () => store.purchases.length > 0 || store.menus.length > 0;
const localSummary = () => `매입 ${num(store.purchases.length)}건 · 메뉴 ${num(store.menus.length)}개`;

async function fetchRow() {
  const { data, error } = await (await client()).from('ledgers').select('rev, data, updated_at').eq('user_id', uid).maybeSingle();
  if (error) throw error;
  return data;
}

async function insertRow(payload) {
  const { data, error } = await (await client()).from('ledgers').insert({ user_id: uid, data: payload, rev: 1 }).select('rev').single();
  if (error) throw error;
  return data.rev;
}

/** 서버 번호가 expected 일 때만 덮어씀. 덮어썼으면 새 번호, 다른 기기가 먼저 바꿨으면 null */
async function updateRow(payload, expected) {
  const { data, error } = await (await client())
    .from('ledgers')
    .update({ data: payload, rev: expected + 1 })
    .eq('user_id', uid)
    .eq('rev', expected)
    .select('rev');
  if (error) throw error;
  return data.length ? data[0].rev : null;
}

const isNetwork = (err) => !navigator.onLine || err?.name === 'TypeError' || /fetch|network|load failed/i.test(err?.message || '');
function failed(err) {
  // 42501: 서버 규칙이 막음 (운영자가 이용을 정지한 계정)
  setStatus(err?.code === '42501' ? 'blocked' : isNetwork(err) ? 'offline' : 'error');
  console.warn('[sync]', err);
}

function adoptServer(row) {
  store.replaceData(row.data);
  saveState({ owner: uid, rev: row.rev, dirty: false, syncedAt: Date.now() });
}

/** 두 가지 중 하나 고르기 (닫으면 null) */
function choose({ title, text, options }) {
  return new Promise((resolve) => {
    let picked = null;
    openSheet({
      title,
      onClose: () => resolve(picked),
      render(body, close) {
        body.innerHTML = `<div class="sync-choice">
          <p class="auth-text">${text}</p>
          <div class="btn-col">${options
            .map((o, i) => `<button type="button" class="btn ${i === 0 ? 'primary' : 'ghost'}" data-choice="${o.value}">${esc(o.label)}</button>`)
            .join('')}</div>
        </div>`;
        body.querySelectorAll('[data-choice]').forEach((b) =>
          b.addEventListener('click', () => {
            picked = b.dataset.choice;
            close();
          }),
        );
      },
    });
  });
}

/** 다른 기기에서 먼저 바꿨을 때: 어느 쪽을 남길지 */
async function resolveConflict(row) {
  setStatus('conflict');
  const pick = await choose({
    title: '다른 기기에서 장부가 바뀌었어요',
    text: `이 기기에서 바꾼 내용이 아직 서버에 올라가지 않았는데, 그 사이 다른 기기에서 장부가 바뀌었어요.<br>어느 쪽을 남길까요? <span class="muted small">(남기지 않은 쪽은 사라집니다. 걱정되면 먼저 ⚙ 설정에서 백업 파일을 저장하세요.)</span>`,
    options: [
      { value: 'server', label: '다른 기기 내용 받기' },
      { value: 'local', label: '이 기기 내용으로 덮어쓰기' },
    ],
  });
  if (pick === 'server') {
    adoptServer(row);
    toast('다른 기기의 장부를 불러왔어요.');
    setStatus('idle');
  } else if (pick === 'local') {
    saveState({ rev: row.rev, dirty: true });
    setStatus('idle');
    await push();
  } // 닫으면 그대로 두고 다음에 다시 물어봄
}

async function push() {
  if (!uid || !st.dirty) return;
  if (pushing) {
    pushAgain = true;
    return pushing;
  }
  pushing = (async () => {
    setStatus('syncing');
    const seq = changeSeq;
    try {
      const payload = store.snapshot();
      let rev;
      try {
        rev = st.rev ? await updateRow(payload, st.rev) : await insertRow(payload);
      } catch (err) {
        if (err?.code !== '23505') throw err; // 23505: 다른 기기가 먼저 첫 장부를 만듦 → 아래에서 충돌로 처리
        rev = null;
      }
      if (rev == null) {
        const row = await fetchRow();
        if (row) return resolveConflict(row);
        rev = await insertRow(payload); // 서버 장부가 지워져 있었음 → 새로 만듦
      }
      // 올리는 동안 또 바뀌었으면 dirty 를 유지하고 한 번 더 올림
      saveState(seq === changeSeq ? { rev, dirty: false, syncedAt: Date.now() } : { rev });
      if (seq !== changeSeq) pushAgain = true;
      setStatus('idle');
    } catch (err) {
      failed(err);
    }
  })().finally(() => {
    pushing = null;
    if (pushAgain) {
      pushAgain = false;
      push();
    }
  });
  return pushing;
}

function schedulePush() {
  clearTimeout(timer);
  timer = setTimeout(push, PUSH_DELAY);
}

/** 다른 기기의 변경 받아오기 (이 기기에 못 올린 변경이 있으면 먼저 올림) */
async function pull() {
  if (!uid || pushing || status === 'conflict') return;
  if (st.dirty) return push();
  if (document.querySelector('.sheet-wrap')) return; // 입력 중인 화면이 있으면 다음에
  try {
    const row = await fetchRow();
    if (row && row.rev !== st.rev) {
      adoptServer(row);
      toast('다른 기기에서 바뀐 장부를 불러왔어요.');
    }
    setStatus('idle');
  } catch (err) {
    failed(err);
  }
}

/** 로그인 직후: 이 기기 장부와 서버 장부 맞추기 */
async function reconcile() {
  setStatus('syncing');
  let row;
  try {
    row = await fetchRow();
  } catch (err) {
    return failed(err); // 나중에 연결되면 다시 시도 (online / 화면 복귀)
  }
  const email = esc(auth.user?.email ?? '');

  // 이 기기 장부가 다른 계정 것: 못 올린 변경이 있으면 알리고, 이 계정 장부로 바꿈
  if (st.owner && st.owner !== uid) {
    if (st.dirty && hasLocalData())
      await choose({
        title: '다른 계정의 장부가 있어요',
        text: `이 기기에 다른 계정의 장부가 있고, 서버에 올라가지 않은 변경이 있어요. 계속하면 ${email} 계정의 장부로 바뀝니다. 필요하면 먼저 ⚙ 설정에서 백업 파일을 저장하세요.`,
        options: [{ value: 'ok', label: '계속' }],
      });
    if (row) adoptServer(row);
    else {
      store.replaceData(null);
      saveState({ owner: uid, rev: 0, dirty: true });
      await push();
    }
    return;
  }

  // 계정에 연결되기 전부터 이 기기에 있던 장부 (처음 로그인)
  if (!st.owner && hasLocalData()) {
    if (!row) {
      saveState({ owner: uid, rev: 0, dirty: true });
      await push();
      if (!st.dirty) toast(`이 기기 장부(${localSummary()})를 계정에 저장했어요.`, 4000);
      return;
    }
    const pick = await choose({
      title: '어느 장부를 쓸까요?',
      text: `${email} 계정에는 이미 서버에 저장된 장부가 있고, 이 기기에도 장부(${localSummary()})가 있어요.`,
      options: [
        { value: 'server', label: '계정에 저장된 장부 쓰기' },
        { value: 'local', label: '이 기기 장부로 바꾸기' },
      ],
    });
    if (pick === 'local') {
      saveState({ owner: uid, rev: row.rev, dirty: true });
      return push();
    }
    adoptServer(row); // 닫아도 계정 장부 (이 기기 장부는 서버에 덮어쓰지 않음)
    return setStatus('idle');
  }

  if (!row) {
    // 이 계정의 첫 장부 (빈 장부거나, 서버에서 지워졌던 경우 이 기기 것을 다시 올림)
    saveState({ owner: uid, rev: 0, dirty: true });
    return push();
  }
  if (st.dirty && st.owner === uid) {
    if (row.rev === st.rev) return push();
    return resolveConflict(row);
  }
  if (row.rev !== st.rev || st.owner !== uid) {
    const fromOtherDevice = st.owner === uid && st.rev > 0;
    adoptServer(row);
    if (fromOtherDevice) toast('다른 기기에서 바뀐 장부를 불러왔어요.');
  }
  setStatus('idle');
}

let unsubChange = null;
addEventListener('online', () => uid && (st.dirty ? push() : pull()));
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && pull());

export const sync = {
  get status() {
    return status;
  },
  get dirty() {
    return st.dirty;
  },
  get syncedAt() {
    return st.syncedAt;
  },
  get active() {
    return !!uid;
  },
  subscribe(f) {
    listeners.add(f);
    return () => listeners.delete(f);
  },
  /** 로그인했고 장부를 불러온 뒤 호출 */
  start(user) {
    if (uid === user.id) return;
    uid = user.id;
    unsubChange ??= store.onLocalChange(() => {
      if (!uid) return;
      changeSeq++;
      saveState({ dirty: true });
      schedulePush();
    });
    return reconcile();
  },
  /** 로그아웃 */
  stop() {
    uid = null;
    clearTimeout(timer);
    setStatus('idle');
  },
  /** 회원 탈퇴 뒤: 이 기기의 장부와 동기화 기록을 지움 */
  forget() {
    uid = null;
    clearTimeout(timer);
    store.replaceData(null);
    st = { owner: null, rev: 0, dirty: false, syncedAt: null };
    try {
      localStorage.removeItem(STATE_KEY);
    } catch {}
    setStatus('idle');
  },
  /** 지금 바로 올리기/받기 (설정 화면의 버튼) */
  now() {
    return st.dirty ? push() : pull();
  },
};
