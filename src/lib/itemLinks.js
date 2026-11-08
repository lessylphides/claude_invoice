// 같은 품목 묶기: 거래처마다 이름을 조금씩 다르게 적는 같은 물건을 하나로 봄
//
// links = { '서광러셀싱글배럴750': '러셀 싱글베럴', ... }
//   키: 묶인 이름의 정규화 키(normKey), 값: 대표 이름(그 묶음의 이름). 영수증에 적힌 원래 이름은 바꾸지 않음.
// notSame = ['키A|키B', ...]  '다른 품목'이라고 답한 쌍 (다시 묻지 않음)

import { normKey } from './format.js';

/** 이 이름이 속한 묶음의 키 (묶이지 않았으면 자기 자신) */
export function groupKey(links, name) {
  const k = normKey(name);
  const target = links?.[k];
  return target ? normKey(target) : k;
}

/** 이 이름이 속한 묶음의 대표 이름 */
export function canonicalName(links, name) {
  return links?.[normKey(name)] ?? name;
}

/**
 * name 이 속한 묶음 전체를 intoName 의 묶음에 합침. 새 links 를 돌려줌 (원본은 그대로)
 * 이미 다른 이름들이 name 쪽으로 묶여 있으면 그 이름들도 함께 옮겨, 묶음이 한 단계로만 이어지게 함.
 */
export function linkInto(links, name, intoName) {
  const target = canonicalName(links, intoName);
  const tk = normKey(target);
  const sk = groupKey(links, name);
  if (!sk || !tk || sk === tk) return links;
  const next = { ...links };
  for (const [k, v] of Object.entries(next)) if (normKey(v) === sk) next[k] = target;
  next[sk] = target;
  delete next[tk]; // 대표 이름은 자기 자신을 가리키지 않음
  return next;
}

/** 묶음에서 빼기 (대표 이름은 뺄 수 없음: 대표가 아닌 이름만) */
export function unlink(links, name) {
  const k = normKey(name);
  if (!links?.[k]) return links;
  const next = { ...links };
  delete next[k];
  return next;
}

/** 저장된 묶음 정리: 문자열만, 자기 자신 가리키기 제거, 여러 단계로 이어진 것은 최종 대표로 */
export function sanitizeLinks(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const links = {};
  for (const [k, v] of Object.entries(src)) {
    const key = normKey(k);
    const name = String(v ?? '').trim();
    if (key && name && normKey(name) !== key) links[key] = name;
  }
  // A → B → C 를 A → C 로 (고리는 끊음)
  for (const k of Object.keys(links)) {
    const seen = new Set([k]);
    let target = links[k];
    while (links[normKey(target)] && !seen.has(normKey(target))) {
      seen.add(normKey(target));
      target = links[normKey(target)];
    }
    if (seen.has(normKey(target)) || normKey(target) === k) delete links[k];
    else links[k] = target;
  }
  return links;
}

export const pairKey = (a, b) => [normKey(a), normKey(b)].sort().join('|');

export function sanitizeNotSame(raw) {
  return [...new Set((Array.isArray(raw) ? raw : []).filter((x) => typeof x === 'string' && /^[^|]+\|[^|]+$/.test(x)))];
}

// ── 비슷한 이름 찾기 ──
// 한글은 자모로 나눠 비교(배럴/베럴처럼 ㅐ·ㅔ 차이는 같게 봄), 용량·개수 표기(750ml, x24 등)는 빼고 비교

// 용량·묶음 표기만 지움: 700ML, 2.2kg, X24, 끝에 붙은 세 자리 이상 숫자(750). '12년', '1호' 같은 숫자는 남김
const UNIT = /[x×*]\s*\d+|\d+(?:\.\d+)?\s*(?:ml|l|kg|g|개입|개|입|병|캔|봉|ea|매|팩)(?![a-z])|\b\d{3,}\b/gi;

// 1,000mL 처럼 천 단위 쉼표가 든 숫자는 쉼표를 뺌
const noThousands = (s) => String(s ?? '').replace(/(\d),(?=\d{3}(?!\d))/g, '$1');

function simKey(name) {
  return normKey(noThousands(name).replace(UNIT, ' '));
}

/**
 * 이름에 적힌 용량·무게·개수를 같은 단위로: 1L·1000ml·1,000mL → {ml:1000}, 2.2kg → {g:2200}, x24·24입 → {ea:24}
 * 적힌 게 없으면 빈 객체
 */
export function sizeOf(name) {
  const s = noThousands(name).toLowerCase();
  const out = {};
  const vol = s.match(/(\d+(?:\.\d+)?)\s*(ml|l|리터)(?![a-z])/);
  if (vol) out.ml = Math.round(Number(vol[1]) * (vol[2] === 'ml' ? 1 : 1000));
  const wt = s.match(/(\d+(?:\.\d+)?)\s*(kg|g|그램|키로)(?![a-z])/);
  if (wt) out.g = Math.round(Number(wt[1]) * (wt[2] === 'kg' || wt[2] === '키로' ? 1000 : 1));
  const cnt = s.match(/x\s*(\d+)|(\d+)\s*(?:개입|입|ea|구)(?![a-z])/);
  if (cnt) out.ea = Number(cnt[1] ?? cnt[2]);
  return out;
}

/**
 * 두 이름의 낱개 크기 비교: 'same' 낱개 용량·무게가 적혀 있고 같음, 'diff' 다름, null 비교할 게 없음
 * 묶음 개수(x24·x6, 24입)는 사는 수량 차이일 뿐 같은 상품이므로 비교하지 않음
 * (콜라 355ml x24 = 콜라 355ml x6, 서울우유 1L = 서울우유 1L×12, 서울우유 1L ≠ 서울우유 500ml)
 */
function compareSize(a, b) {
  const sa = sizeOf(a);
  const sb = sizeOf(b);
  const common = ['ml', 'g'].filter((k) => sa[k] && sb[k]);
  if (!common.length) return null;
  return common.every((k) => sa[k] === sb[k]) ? 'same' : 'diff';
}

const digits = (k) => (k.match(/\d+/g) ?? []).join(',');

function jamo(s) {
  const out = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c >= 0xac00 && c <= 0xd7a3) {
      const i = c - 0xac00;
      let jung = Math.floor((i % 588) / 28);
      if (jung === 1) jung = 5; // ㅐ → ㅔ
      if (jung === 3) jung = 7; // ㅒ → ㅖ
      out.push(`c${Math.floor(i / 588)}`, `v${jung}`);
      if (i % 28) out.push(`t${i % 28}`);
    } else out.push(ch);
  }
  return out;
}

function dice(a, b) {
  if (a.length < 2 || b.length < 2) return a.join('') === b.join('') ? 1 : 0;
  const grams = (x) => {
    const m = new Map();
    for (let i = 0; i < x.length - 1; i++) {
      const g = x[i] + x[i + 1];
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let hit = 0;
  for (const [g, n] of ga) hit += Math.min(n, gb.get(g) ?? 0);
  return (2 * hit) / (a.length - 1 + (b.length - 1));
}

/** 두 품목 이름이 같은 물건일 가능성 (0~1) */
export function nameSimilarity(a, b) {
  const ka = simKey(a);
  const kb = simKey(b);
  if (!ka || !kb) return 0;
  // 낱개 용량·무게가 둘 다 적혀 있는데 다르면 다른 상품 (서울우유 1L ≠ 서울우유 500ml). 묶음 개수 차이는 같은 상품
  if (compareSize(a, b) === 'diff') return 0;
  if (ka === kb) return 1;
  // 남은 숫자가 서로 다르면 다른 물건 (조니워커 12년 ≠ 18년, 품목1 ≠ 품목2)
  if (digits(ka) && digits(kb) && digits(ka) !== digits(kb)) return 0;
  const ja = jamo(ka);
  const jb = jamo(kb);
  if (ja.join('') === jb.join('')) return 1;
  // 한쪽 이름이 다른 쪽에 통째로 들어 있으면(예: '러셀' ⊂ '러셀싱글배럴') 꽤 비슷
  const short = ka.length <= kb.length ? ka : kb;
  const long = short === ka ? kb : ka;
  if ([...short].length >= 2 && long.includes(short)) return Math.max(0.8, dice(ja, jb));
  return dice(ja, jb);
}

export const SIMILAR_THRESHOLD = 0.8;

/**
 * 묻지 않고 바로 묶어도 될 만큼 확실한지: 크기 표기를 뺀 이름이 (ㅐ/ㅔ 차이까지) 같고, 크기도 적혀 있고 같음
 * 예) 서울우유 1L ↔ 서울우유 1000ml ↔ 서울우유1,000mL
 */
export function isSureSame(a, b) {
  const ka = simKey(a);
  const kb = simKey(b);
  if (!ka || !kb || compareSize(a, b) !== 'same') return false;
  return ka === kb || jamo(ka).join('') === jamo(kb).join('');
}

/**
 * 새 품목 이름과 가장 비슷한 기존 품목 (없으면 null)
 * @param {string} name
 * @param {string[]} candidates 기존 품목(묶음 대표) 이름들
 * @param {(cand:string)=>boolean} skip 이미 같은 묶음이거나 '다른 품목'이라고 답한 경우
 */
export function findSimilar(name, candidates, skip = () => false) {
  let best = null;
  for (const c of candidates) {
    if (skip(c)) continue;
    const score = nameSimilarity(name, c);
    if (score >= SIMILAR_THRESHOLD && (!best || score > best.score || (score === best.score && isSureSame(name, c)))) best = { name: c, score };
  }
  return best;
}
