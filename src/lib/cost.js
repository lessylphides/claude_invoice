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

/**
 * 원가 탭 요약: 원가율 높은 순(계산 불가는 맨 뒤), 목표 초과 수, 평균.
 * 초과 수: 일부 재료가 빠져도 이미 목표를 넘었으면 셈(실제로는 더 높으므로).
 * 평균: 모든 재료가 계산된 메뉴만.
 */
export function summarizeMenus(menus, index, target) {
  const rows = menus.map((m) => ({ m, c: menuCost(m, index) })).sort((a, b) => (b.c.rate ?? -1) - (a.c.rate ?? -1));
  const complete = rows.filter((r) => r.c.rate != null && !r.c.missing);
  return {
    rows,
    over: rows.filter((r) => r.c.rate != null && r.c.rate > target).length,
    avg: complete.length ? complete.reduce((s, r) => s + r.c.rate, 0) / complete.length : null,
  };
}
