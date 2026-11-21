// 월말 판매 불러오기: 포스(페이히어) 매출 파일 + 네이버페이 주문 파일 → 한 달 매출·메뉴별 판매 수량
// 규칙 (사장님 마감 방식 기준)
// - 월 매출 = 페이히어 실매출 (네이버 주문은 페이히어에 '기타 결제'로 이미 들어 있으므로 더하지 않음)
// - 메뉴 수량 = 페이히어 상품별 수량('금액 추가' 제외) + 네이버 주문 옵션정보의 메뉴 수량
// - 페이히어 영업일: 하루 시작 시각(dayStart) 전 결제는 전날 영업일 (새벽 마감·다음 날 아침에 늦게 넣은 것)
// - 네이버 영업일: 결제한 날짜(자정 기준) — 자정 넘은 주문은 다음 영업일에 기타 결제로 넣음
// - 네이버 예약 상품(예약금)은 매출·메뉴에서 뺌: 포인트로 돌려줘 주문 금액 안에서 쓰임

const num = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[,원\s]/g, '')) || 0);
const s = (v) => String(v ?? '').trim();
const findHeader = (rows, must) => rows.findIndex((r) => must.every((m) => r?.some((c) => s(c) === m)));
const colMap = (row) => Object.fromEntries(row.map((c, i) => [s(c), i]).filter(([k]) => k));

/** 'YYYY-MM-DD HH:MM:SS' 에서 하루 시작 시각 전이면 전날로 */
export function businessDay(dt, dayStart = 0) {
  const [d, t = '00:00'] = s(dt).split(/[ T]/);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  if (Number(t.slice(0, 2)) >= dayStart) return d;
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
}

/** 어떤 파일인지 알아보기 */
export function detectSalesFile(sheets) {
  const naver = sheets.find((sh) => findHeader(sh.rows, ['상품주문번호', '옵션정보']) >= 0);
  if (naver) return { kind: 'naver', sheet: naver };
  const items = sheets.find((sh) => findHeader(sh.rows, ['상품명', '상품별 단가', '수량']) >= 0);
  const pays = sheets.find((sh) => findHeader(sh.rows, ['결제일', '결제시간', '합계']) >= 0);
  if (items || pays) return { kind: 'payhere', items, pays };
  return null;
}

/** 네이버 옵션정보 → [{ name, qty }] ('/' 뒤의 증정 쿠폰 등은 뺌, 메뉴 이름 안의 쉼표도 처리) */
export function parseNaverOptions(text) {
  const head = s(text).split('/[')[0].split(/\/추가상품/)[0];
  return [...head.matchAll(/(.+?) x(\d+)(?=,|\/|$)/g)].map((m) => ({ name: m[1].replace(/^,/, '').trim(), qty: Number(m[2]) })).filter((x) => x.name);
}
const isReservation = (opt) => /^\d{4}\.\d{2}\.\d{2},\s*(오전|오후)/.test(s(opt)) || (/추가상품/.test(s(opt)) && !/ x\d/.test(s(opt)));

/** 네이버페이 구매확정(주문) 내역 */
export function parseNaver(sheet) {
  const h = findHeader(sheet.rows, ['상품주문번호', '옵션정보']);
  const c = colMap(sheet.rows[h]);
  const amountCol = c['최종 상품별 총 주문금액'] ?? c['최초 상품별 총 주문금액'] ?? c['상품가격'];
  const orders = [];
  let reserved = { count: 0, amount: 0 };
  for (const r of sheet.rows.slice(h + 1)) {
    if (!r?.length || !s(r[c['상품주문번호']])) continue;
    if (/취소|반품|환불/.test(s(r[c['주문상태']]))) continue;
    const opt = r[c['옵션정보']];
    const amount = num(r[amountCol]);
    if (isReservation(opt)) {
      reserved.count++;
      reserved.amount += amount;
      continue;
    }
    const qty = num(r[c['수량']]) || 1;
    const items = parseNaverOptions(opt).map((x) => ({ ...x, qty: x.qty * qty }));
    if (!items.length) items.push({ name: s(r[c['상품명']]), qty });
    const paid = s(r[c['결제일']] ?? r[c['구매확정일']]);
    orders.push({ day: businessDay(paid, 0), at: paid, amount, items });
  }
  return { orders, reserved };
}

/** 페이히어 매출 파일 (상품별 + 매출 내역) */
export function parsePayhere({ items, pays }, dayStart = 6) {
  const out = { items: [], payments: [], range: null };
  if (items) {
    const h = findHeader(items.rows, ['상품명', '상품별 단가', '수량']);
    const c = colMap(items.rows[h]);
    let cat = '';
    for (const r of items.rows.slice(h + 1)) {
      if (!r?.length) continue;
      const no = s(r[c['No.']]);
      if (r[c['카테고리']] != null && s(r[c['카테고리']])) cat = s(r[c['카테고리']]);
      if (!/^\d+$/.test(no)) continue; // 합계 줄
      const name = s(r[c['상품명']]);
      if (!name || name === '금액 추가') continue;
      out.items.push({ name, category: cat, unitPrice: num(r[c['상품별 단가']]), qty: num(r[c['수량']]), amount: num(r[c['실매출']] ?? r[c['총매출']]) });
    }
  }
  if (pays) {
    const h = findHeader(pays.rows, ['결제일', '결제시간', '합계']);
    const c = colMap(pays.rows[h]);
    const g = (r, k) => (c[k] == null ? 0 : num(r[c[k]]));
    for (const r of pays.rows.slice(h + 1)) {
      const d = s(r?.[c['결제일']]);
      if (!/^\d{4}-\d{2}-\d{2}/.test(d)) continue;
      if (/\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}/.test(s(r[c['환불 일시']]))) continue; // 환불된 결제 (환불 날짜가 적힌 줄)
      const at = `${d.slice(0, 10)} ${s(r[c['결제시간']]) || '12:00:00'}`;
      const total = g(r, '합계');
      out.payments.push({
        at,
        day: businessDay(at, dayStart),
        label: s(r[c['결제 내역']]),
        total,
        net: total - g(r, '상품별 할인') - g(r, '결제 할인') - g(r, '포인트 사용') - g(r, '선불권 사용'),
        etc: g(r, '기타 결제'),
      });
    }
  }
  return out;
}

/** 이름 비교용: 'DIVE', 괄호 속 설명, (G)·(병) 같은 표시, 띄어쓰기·기호를 빼고 소문자로 */
export function normName(n) {
  return s(n)
    .toLowerCase()
    .replace(/^dive\s+/, '')
    .replace(/\((g|병|bottle|잔|glass)\)/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[\s·.,&'’\-_/!]+/g, '')
    .replace(/(\d+)\s*(y|yo|년)/g, '$1y');
}
const bigrams = (x) => {
  const out = new Map();
  for (let i = 0; i < x.length - 1; i++) out.set(x.slice(i, i + 2), (out.get(x.slice(i, i + 2)) || 0) + 1);
  return out;
};
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let hit = 0;
  for (const [k, n] of A) hit += Math.min(n, B.get(k) || 0);
  const tot = Math.max(1, a.length - 1 + b.length - 1);
  return (2 * hit) / tot;
}

/** 판매 이름(정리한 key) → 앱 메뉴 추천 (저장된 연결이 먼저, 다음 같은 이름, 다음 비슷한 이름) */
export function suggestMenu(key, menus, links = {}) {
  if (key in links) return { menuId: links[key] || '', sure: true };
  const bare = key.replace(/^bottle:/, '');
  const scored = menus.map((m) => {
    const k = normName(m.name);
    // 글자 쌍 비슷함은 0.85 이상만 인정 (짧은 이름끼리 우연히 겹치는 것 막기)
    let sc = similarity(bare, k);
    if (sc < 0.999) sc = sc >= 0.85 ? sc : 0;
    // 한쪽이 다른 쪽을 품으면 (기네스 ↔ 기네스잔) 겹치는 길이 비율로. '에스프레소' ⊂ '에스프레소도피오' 같은 건 낮게
    if (k && bare && (k.includes(bare) || bare.includes(k)) && Math.min(k.length, bare.length) >= 2) sc = Math.max(sc, Math.min(k.length, bare.length) / Math.max(k.length, bare.length));
    return { m, sc };
  });
  scored.sort((a, b) => b.sc - a.sc);
  const top = scored[0];
  if (top && top.sc >= 0.999) return { menuId: top.m.id, sure: !(scored[1]?.sc >= 0.999) }; // 같은 이름이 둘이면 확인 필요
  if (top && top.sc >= 0.72) return { menuId: top.m.id, sure: false };
  return { menuId: '', sure: false };
}

/** 네이버 주문에서 메뉴별 가격 추정: 메뉴 하나만 시킨 주문의 금액 ÷ 수량 중 가장 흔한 값, 그다음 모르는 메뉴가 하나뿐인 주문으로 풀기 */
export function inferNaverPrices(orders) {
  const seen = new Map();
  const key = (n) => normName(n);
  for (const o of orders) {
    if (o.items.length !== 1 || !o.items[0].qty) continue;
    const k = key(o.items[0].name);
    const p = Math.round(o.amount / o.items[0].qty);
    if (p <= 0) continue;
    const m = seen.get(k) || new Map();
    m.set(p, (m.get(p) || 0) + 1);
    seen.set(k, m);
  }
  const out = new Map([...seen].map(([k, m]) => [k, [...m].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]]));
  for (let round = 0; round < 3; round++)
    for (const o of orders) {
      const unknown = o.items.filter((it) => !out.has(key(it.name)));
      if (unknown.length !== 1) continue;
      const rest = o.amount - o.items.filter((it) => out.has(key(it.name))).reduce((t, it) => t + out.get(key(it.name)) * it.qty, 0);
      const p = rest / unknown[0].qty;
      if (p > 0 && Number.isInteger(p) && p % 100 === 0) out.set(key(unknown[0].name), p);
    }
  return out;
}

const ymOf = (d) => (d ? d.slice(0, 7) : null);

/**
 * 파일들을 합쳐 한 달 결과
 * @param {{ payhere?: ReturnType<typeof parsePayhere>, naver?: ReturnType<typeof parseNaver> }} src
 */
export function combineSales({ payhere, naver }, ym) {
  const months = new Map();
  for (const p of payhere?.payments ?? []) months.set(ymOf(p.day), (months.get(ymOf(p.day)) || 0) + p.total);
  for (const o of naver?.orders ?? []) if (!payhere?.payments?.length) months.set(ymOf(o.day), (months.get(ymOf(o.day)) || 0) + o.amount);
  const month = ym || [...months.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const inMonth = (d) => ymOf(d) === month;
  const pays = (payhere?.payments ?? []).filter((p) => inMonth(p.day));
  const ords = (naver?.orders ?? []).filter((o) => inMonth(o.day));
  const naverTotal = ords.reduce((t, o) => t + o.amount, 0);
  const sales = pays.length ? pays.reduce((t, p) => t + p.net, 0) : naverTotal;
  // 메뉴 수량 (이름별로 모음)
  const byName = new Map();
  const add = (name, qty, from, unitPrice = 0, category = '') => {
    const k = name;
    const bottle = /bottle|보틀/i.test(category + ' ' + name);
    const cur = byName.get(k) || { name, qty: 0, pos: 0, naver: 0, unitPrice: 0, category: '', kind: bottle ? 'bottle' : 'glass' };
    cur.qty += qty;
    cur[from] += qty;
    if (unitPrice) cur.unitPrice = unitPrice;
    if (category && !cur.category) cur.category = category;
    byName.set(k, cur);
  };
  for (const it of payhere?.items ?? []) add(it.name, it.qty, 'pos', it.unitPrice, it.category);
  for (const o of ords) for (const it of o.items) add(it.name, it.qty, 'naver');
  // 같은 이름(정리 후)끼리 합치기: 'DIVE 롱 블랙'(네이버) = 'DIVE 롱 블랙'(포스)
  const merged = new Map();
  for (const it of byName.values()) {
    const k = (it.kind === 'bottle' ? 'bottle:' : '') + normName(it.name);
    const cur = merged.get(k);
    if (cur) {
      cur.qty += it.qty;
      cur.pos += it.pos;
      cur.naver += it.naver;
      cur.unitPrice ||= it.unitPrice;
      cur.category ||= it.category;
    } else merged.set(k, { ...it, key: k });
  }
  // 네이버 주문만 있는 메뉴의 가격: 메뉴 1개짜리 주문 금액에서 (가장 흔한 값). 포스 단가가 있으면 그걸 씀
  const naverPrice = inferNaverPrices(ords);
  for (const it of merged.values()) if (!it.unitPrice && naverPrice.has(it.key)) it.unitPrice = naverPrice.get(it.key);
  const items = [...merged.values()].sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
  const glassQty = items.filter((i) => i.kind !== 'bottle').reduce((t, i) => t + i.qty, 0);
  // 날짜별 대조: 페이히어 기타 결제 vs 네이버 주문 (1만 원 넘게 다른 날)
  const days = new Map();
  for (const p of pays) if (p.etc) days.set(p.day, { ...(days.get(p.day) || { naver: 0, etc: 0 }), etc: (days.get(p.day)?.etc || 0) + p.etc });
  for (const o of ords) days.set(o.day, { ...(days.get(o.day) || { naver: 0, etc: 0 }), naver: (days.get(o.day)?.naver || 0) + o.amount });
  const mismatch =
    pays.length && ords.length
      ? [...days.entries()]
          .map(([day, v]) => ({ day, ...v, diff: v.etc - v.naver }))
          .filter((x) => Math.abs(x.diff) >= 10000)
          .sort((a, b) => a.day.localeCompare(b.day))
      : [];
  const etcTotal = pays.reduce((t, p) => t + p.etc, 0);
  return {
    ym: month,
    sales,
    gross: pays.reduce((t, p) => t + p.total, 0),
    naverTotal,
    etcTotal,
    orders: ords.length,
    payments: pays.length,
    reserved: naver?.reserved ?? { count: 0, amount: 0 },
    qty: glassQty, // 잔·접시 수 (보틀 판매는 빼고)
    items,
    mismatch,
    otherMonths: [...months.keys()].filter((m) => m && m !== month).sort(),
  };
}

/**
 * 메뉴와 연결한 판매 결과 분석
 * @param {{ items: {key, name, qty}[] }} result combineSales 결과(또는 저장된 것)
 * @param {Record<string,string>} links normName → menuId ('' = 연결 안 함)
 * @param {(id: string) => ({ name, cost, price } | null)} menuInfo
 */
export function analyzeSales(result, links, menuInfo) {
  let theory = 0;
  let marginSum = 0;
  let linkedQty = 0;
  const rows = result.items.map((it) => {
    const id = links[it.key];
    const m = id ? menuInfo(id, it.kind) : null;
    if (m && m.cost != null) {
      theory += m.cost * it.qty;
      linkedQty += it.qty;
      if (m.price) marginSum += (m.price - m.cost) * it.qty;
    }
    return { ...it, menu: m };
  });
  return {
    rows,
    theory: Math.round(theory),
    marginSum: Math.round(marginSum),
    linkedQty,
    unlinkedTop: rows.filter((r) => !r.menu).slice(0, 8),
  };
}
