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
// 같은 이름이 수만 번 반복되므로(품목 수백 종 × 매입 수천 건) 결과를 기억해 둠
const normCache = new Map();
export function normKey(s) {
  const raw = String(s || '');
  let k = normCache.get(raw);
  if (k === undefined) {
    k = raw
      .replace(/\(주\)|㈜|\(유\)|주식회사|유한회사/g, '')
      .replace(/[\s·.,\-_/()[\]]+/g, '')
      .toLowerCase();
    if (normCache.size > 20000) normCache.clear();
    normCache.set(raw, k);
  }
  return k;
}

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

/** 'YYYY-MM-DD' 형식인지 (실제로 있는 날짜인지까지 확인) */
export function isYmd(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** 원가율 등 퍼센트: 소수 첫째 자리까지 (예: 14.2%) */
export const pct = (v) => (v == null || !Number.isFinite(v) ? '-' : `${(Math.round(v * 10) / 10).toFixed(1)}%`);

/** 25.0% → 25%, 14.2% → 14.2% */
export const pctShort = (v) => pct(v).replace('.0%', '%');

/** '2026-11-04' → '2026.11.04' */
export const dotDate = (d) => String(d).replaceAll('-', '.');
