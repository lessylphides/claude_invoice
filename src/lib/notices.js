// 공지사항: 종류·정리 (앱 화면과 서버가 같이 씀) + 앱의 읽음 표시
export const NOTICE_KINDS = {
  feature: { icon: '✨', label: '새 기능' },
  fix: { icon: '🛠', label: '고친 점' },
  notice: { icon: '📌', label: '알림' },
};
export const NOTICE_MAX = 100;
export const NOTICE_TITLE_MAX = 80;
export const NOTICE_BODY_MAX = 4000;
export const IMPORTANT_DAYS = 14; // 중요 공지는 올린 지 2주 안에만 앱을 열 때 띄움

export function cleanNotice(n = {}) {
  return {
    kind: NOTICE_KINDS[n.kind] ? n.kind : 'notice',
    title: String(n.title ?? '').trim().slice(0, NOTICE_TITLE_MAX),
    body: String(n.body ?? '').trim().slice(0, NOTICE_BODY_MAX),
    important: !!n.important,
  };
}

const SEEN = 'costnote:notice-seen'; // 마지막으로 읽은 공지 시각
const POPPED = 'costnote:notice-popped'; // 앱을 열 때 띄운 중요 공지 id
const CACHE = 'costnote:notices';

const ls = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

export const noticeState = {
  list: (() => {
    try {
      return JSON.parse(ls.get(CACHE) || '[]');
    } catch {
      return [];
    }
  })(),
  get seenAt() {
    return Number(ls.get(SEEN)) || 0;
  },
  get unread() {
    return this.list.filter((n) => n.at > this.seenAt).length;
  },
  markSeen() {
    const top = Math.max(0, ...this.list.map((n) => n.at));
    if (top > this.seenAt) ls.set(SEEN, String(top));
  },
  /** 앱을 열 때 띄울 중요 공지 (아직 안 읽었고, 2주 안, 한 번만) */
  takeImportant(now = Date.now()) {
    let popped = [];
    try {
      popped = JSON.parse(ls.get(POPPED) || '[]');
    } catch {}
    const n = this.list.find((x) => x.important && x.at > this.seenAt && now - x.at < IMPORTANT_DAYS * 86400000 && !popped.includes(x.id));
    if (n) ls.set(POPPED, JSON.stringify([n.id, ...popped].slice(0, 50)));
    return n || null;
  },
  set(list) {
    this.list = Array.isArray(list) ? list : [];
    ls.set(CACHE, JSON.stringify(this.list));
  },
};

/** 서버에서 공지 받아오기 (실패하면 기기에 저장된 것 그대로) */
export async function loadNotices(fetchImpl = fetch) {
  try {
    const r = await fetchImpl('./api/notices', { cache: 'no-store' });
    if (!r.ok) return false;
    noticeState.set((await r.json()).notices);
    return true;
  } catch {
    return false;
  }
}
