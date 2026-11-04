// 숫자·날짜·문자열 포맷 유틸

export const pad = (n) => String(n).padStart(2, '0');

export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const todayStr = () => ymd(new Date());

export const num = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR');

export const won = (n) => `${num(n)}원`;

/** 달력 칸처럼 좁은 곳에 쓰는 축약 금액 (예: 123,400 → 12.3만) */
export function compact(n) {
  n = Math.round(Number(n) || 0);
  const t = (x) => (x >= 100 ? String(Math.round(x)) : String(Math.round(x * 10) / 10));
  if (n >= 1e8) return `${t(n / 1e8)}억`;
  if (n >= 1e4) return `${t(n / 1e4)}만`;
  return n.toLocaleString('ko-KR');
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** 거래처·품목 이름을 묶기 위한 키 (공백, (주), 주식회사 등 제거) */
export const normKey = (s) =>
  String(s || '')
    .replace(/\(주\)|㈜|\(유\)|주식회사|유한회사/g, '')
    .replace(/[\s·.,\-_/()[\]]+/g, '')
    .toLowerCase();

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

export function dateLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const w = WEEK[new Date(y, m - 1, d).getDay()];
  return `${y}년 ${m}월 ${d}일 (${w})`;
}

export const shortDate = (dateStr) => {
  const [y, m, d] = dateStr.split('-');
  return `${y.slice(2)}.${m}.${d}`;
};

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
