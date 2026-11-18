// 원가 계산: 메뉴 1잔(1조각)의 원가와 원가율
// 매입 품목 재료는 '가장 최근 매입 단가(할인 반영)'로 계산하므로 새 영수증이 들어오면 원가율도 바로 바뀝니다.

/**
 * 재료 1개의 1잔당 원가. cost=null 이면 계산 불가(reason)
 * 1개 용량은 메뉴에 직접 적은 값 → 그 매입 건의 용량 → 같은 품목의 최근 용량 기록 순으로 사용
 */
export function ingredientCost(g, index) {
  if (g.type === 'manual') {
    const c = Number(g.cost) || 0;
    return { cost: c, prevCost: c, source: null };
  }
  const hist = index.history(g.itemName);
  if (!hist.length) return { cost: null, reason: '매입 기록 없음' };
  const spec = index.spec(g.itemName);
  const packOf = (row) => Number(g.packSize) || Number(row.item.packSize) || spec?.packSize || 0;
  const [latest, previous] = hist;
  const unit = g.unit || latest.item.packUnit || spec?.packUnit || '';
  const pack = packOf(latest);
  if (!pack || !g.use) return { cost: null, reason: !g.use ? '사용량 미입력' : '1개 용량 미입력', source: latest, pack, unit };
  const per = (row) => (row.price * g.use) / packOf(row);
  const prevRow = previous && packOf(previous) ? previous : latest;
  return { cost: per(latest), prevCost: per(prevRow), source: latest, prev: previous, pack, unit };
}

/**
 * 메뉴 원가·원가율.
 * rate 는 판매가가 없거나 계산할 수 있는 재료가 하나도 없으면 null (0% 로 보이지 않게).
 * 일부 재료만 빠졌으면(missing>0) 원가·원가율은 '최소값'입니다.
 */
export function menuCost(menu, index) {
  let cost = 0;
  let prevCost = 0;
  let missing = 0;
  const parts = menu.ingredients.map((g) => {
    const r = ingredientCost(g, index);
    if (r.cost == null) missing++;
    else {
      cost += r.cost;
      prevCost += r.prevCost;
    }
    return { g, ...r };
  });
  const price = Number(menu.price) || 0;
  const nothing = parts.length > 0 && missing === parts.length;
  return { cost, prevCost, delta: cost - prevCost, rate: price && !nothing ? (cost / price) * 100 : null, missing, parts };
}

/** 목표 원가율에 맞추려면 필요한 판매가 (100원 단위 올림) */
export const priceForTarget = (cost, target) => Math.ceil(cost / (target / 100) / 100) * 100;

/** 최소 마진을 남기려면 필요한 판매가 (100원 단위 올림) */
export const priceForMargin = (cost, minMargin) => Math.ceil((cost + minMargin) / 100) * 100;

/**
 * 분류의 현재 최소 마진 (설정 안 했거나 0 이면 null)
 * @param {'glass'|'bottle'} kind 잔 / 보틀
 */
export function currentMinMargin(margins, category, kind = 'glass') {
  // 분류 이름이 constructor 같은 이름이어도 안전하게 (자기 값만)
  const hist = margins && Object.hasOwn(margins, category) ? margins[category] : null;
  const last = Array.isArray(hist) ? hist.at(-1) : null;
  const v = kind === 'bottle' ? last?.bottle : last?.value;
  return v > 0 ? v : null;
}

/**
 * 보틀 원가: 메뉴의 첫 번째 매입 품목 재료 한 병(구매 단위 1개)의 최근 매입가(할인 반영).
 * glasses: 한 병에서 나오는 잔 수(1개 용량 ÷ 한 잔 사용량, 모르면 null). 매입 기록이 없으면 null
 */
export function bottleCost(menu, index) {
  const g = menu.ingredients.find((x) => x.type === 'item');
  if (!g) return null;
  const r = ingredientCost(g, index);
  if (!r.source) return null;
  return {
    itemName: g.itemName,
    cost: r.source.price,
    prevCost: r.prev ? r.prev.price : r.source.price,
    pack: r.pack || 0,
    unit: r.unit,
    glasses: r.pack && g.use ? r.pack / g.use : null,
    source: r.source,
  };
}

/**
 * 보틀 판정 (보틀 판매가가 없으면 null). 잔과 같은 규칙: 원가율 목표 이하 또는 보틀 최소 마진 이상이면 합격
 * @returns {null | {status, margin, minMargin, rate, b}}
 */
export function judgeBottle(menu, index, target, minBottleMargin) {
  const price = Number(menu.bottlePrice) || 0;
  if (!price) return null;
  const b = bottleCost(menu, index);
  if (!b) return { status: 'unknown', margin: null, minMargin: minBottleMargin, rate: null, b: null };
  const rate = (b.cost / price) * 100;
  return { ...judgeMenu({ cost: b.cost, rate, missing: 0 }, price, target, minBottleMargin), rate, b };
}

/**
 * 보틀 가격 참고값 (100원 단위 올림)
 * byMargin: 1병 원가 + 보틀 최소 마진 = 설정한 마진을 남기는 가장 싼 값(최소 마진을 정했을 때만), 잔 합계(잔 가격 × 잔 수)의 60%, 원가 × 2, 원가 × 2.5
 */
export function bottleRefs(b, glassPrice, minBottleMargin = null) {
  const up = (v) => Math.ceil(v / 100) * 100;
  const glasses = b?.glasses ? Math.floor(b.glasses) : null;
  return {
    glasses,
    glassSum: glasses && glassPrice ? glasses * glassPrice : null,
    byMargin: b && minBottleMargin ? priceForMargin(b.cost, minBottleMargin) : null,
    glassSum60: glasses && glassPrice ? up(glasses * glassPrice * 0.6) : null,
    x2: b ? up(b.cost * 2) : null,
    x25: b ? up(b.cost * 2.5) : null,
  };
}

/** 참고 가격 버튼·목록용: [이름, 금액] (계산할 수 없는 것은 뺌) */
export function bottleRefList(refs) {
  return [
    ['최소 마진선', refs.byMargin],
    ['잔 합계 60%', refs.glassSum60],
    ['원가 × 2', refs.x2],
    ['원가 × 2.5', refs.x25],
  ].filter(([, v]) => v);
}

/**
 * 메뉴 판정
 * - 'rate'    원가율이 목표 이하 → 합격
 * - 'margin'  원가율은 넘었지만 한 잔 마진이 최소 마진 이상 → 합격(마진 기준). 일부 재료가 빠졌으면 실제 마진이 더 작을 수 있어 이 판정은 하지 않음
 * - 'over'    둘 다 못 채움 → ⚠
 * - 'unknown' 원가율을 계산할 수 없음
 */
export function judgeMenu(c, price, target, minMargin) {
  const margin = (Number(price) || 0) - c.cost;
  if (c.rate == null) return { status: 'unknown', margin, minMargin };
  if (c.rate <= target) return { status: 'rate', margin, minMargin };
  if (minMargin != null && !c.missing && margin >= minMargin) return { status: 'margin', margin, minMargin };
  return { status: 'over', margin, minMargin };
}

/**
 * 원가 탭 요약: 잔 원가율 높은 순(계산 불가는 맨 뒤), ⚠ 수, 마진 기준 충족 수, 평균.
 * ⚠: 잔이나 보틀 중 하나라도 원가율·최소 마진을 둘 다 못 채운 메뉴 (일부 재료가 빠져도 이미 넘었으면 셈)
 * 마진 기준 충족: ⚠ 가 아니면서 잔이나 보틀 중 하나라도 마진 기준으로 합격한 메뉴
 * 평균: 잔 원가율, 모든 재료가 계산된 메뉴만.
 * @param {object} margins 분류별 최소 마진 기록
 */
export function summarizeMenus(menus, index, target, margins = {}) {
  const rows = menus
    .map((m) => {
      const c = menuCost(m, index);
      return {
        m,
        c,
        j: judgeMenu(c, m.price, target, currentMinMargin(margins, m.category)),
        jb: judgeBottle(m, index, target, currentMinMargin(margins, m.category, 'bottle')),
      };
    })
    .sort((a, b) => (b.c.rate ?? -1) - (a.c.rate ?? -1));
  const isOver = (r) => r.j.status === 'over' || r.jb?.status === 'over';
  const complete = rows.filter((r) => r.c.rate != null && !r.c.missing);
  return {
    rows,
    over: rows.filter(isOver).length,
    byMargin: rows.filter((r) => !isOver(r) && (r.j.status === 'margin' || r.jb?.status === 'margin')).length,
    avg: complete.length ? complete.reduce((s, r) => s + r.c.rate, 0) / complete.length : null,
  };
}

/** 1,000원 단위 올림 (잔 가격 추천) */
export const up1000 = (v) => Math.ceil(v / 1000) * 1000;

/**
 * 잔 가격 정하기: 원가 탭 판정과 같은 규칙
 * - min (최소 가격): 이 값 이상이면 ✓ — 목표 원가율 가격과 최소 마진 가격 중 낮은 값 (둘 중 하나만 채워도 합격)
 * - goal (목표 가격): 목표 원가율을 지키는 가격
 * 일부 재료 원가가 빠졌으면(missing) 마진 기준은 쓰지 않음 (판정과 같음). 1,000원 단위 올림
 */
export function glassPriceGuide(cost, target, minMargin, missing = 0) {
  if (!(cost > 0) || !(target > 0)) return null;
  const goal = up1000(cost / (target / 100));
  const byMargin = minMargin && !missing ? up1000(cost + minMargin) : null;
  const min = byMargin != null ? Math.min(goal, byMargin) : goal;
  return { min, goal, minBy: byMargin != null && byMargin < goal ? 'margin' : 'rate' };
}

/**
 * 같은 분류 다른 메뉴들이 최소~목표 가격 사이 어디쯤 팔리는지 (0 = 최소, 1 = 목표, 중간값)
 * 가게의 가격 기준을 그대로 새 메뉴에 이어 쓰려고. 비교할 메뉴가 2개 미만이면 null
 * @param {Array<{price:number, cost:number, missing:number, minMargin:number|null}>} others
 */
export function housePosition(others, target) {
  const pos = [];
  for (const o of others) {
    if (!(o.price > 0) || o.missing) continue;
    const g = glassPriceGuide(o.cost, target, o.minMargin);
    if (!g || g.goal <= g.min) continue;
    pos.push(Math.max(0, Math.min(1.5, (o.price - g.min) / (g.goal - g.min))));
  }
  if (pos.length < 2) return null;
  pos.sort((a, b) => a - b);
  const mid = pos.length % 2 ? pos[(pos.length - 1) / 2] : (pos[pos.length / 2 - 1] + pos[pos.length / 2]) / 2;
  return { position: mid, count: pos.length };
}

/** 가게 기준 가격: 최소 + (목표 - 최소) × 가게 위치, 1,000원 올림 (최소 아래로는 안 내려감) */
export const housePrice = (guide, position) => Math.max(guide.min, up1000(guide.min + (guide.goal - guide.min) * position));

/**
 * 같은 분류 메뉴들이 가장 많이 쓰는 한 잔 양 {use, unit, count} (2개 이상 메뉴가 같은 양일 때만, 없으면 null)
 * @param {(name:string)=>{packUnit:string}|null} specOf 매입 기록의 용량 단위
 */
export function commonPour(menus, category, specOf = () => null) {
  if (!category) return null;
  const count = new Map();
  for (const m of menus) {
    if ((m.category || '') !== category) continue;
    for (const g of m.ingredients || []) {
      if (g.type !== 'item' || !(Number(g.use) > 0)) continue;
      const unit = g.unit || specOf(g.itemName)?.packUnit || '';
      const k = `${Number(g.use)}|${unit}`;
      count.set(k, (count.get(k) || 0) + 1);
    }
  }
  let best = null;
  for (const [k, n] of count) if (!best || n > best.count) best = { use: Number(k.split('|')[0]), unit: k.split('|')[1], count: n };
  return best && best.count >= 2 ? best : null;
}
