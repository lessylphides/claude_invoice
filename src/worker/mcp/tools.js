// 클로드 연결: 도구가 하는 일 (장부 데이터만 다루는 순수 함수 → 단위 테스트로 검증)
// 숫자는 앱 원가 탭과 같은 계산(lib/cost.js)을 씀
import { buildItemIndex } from '../../lib/itemIndex.js';
import { menuCost, judgeMenu, currentMinMargin, bottleCost, judgeBottle, priceForTarget, priceForMargin, bottleRefs } from '../../lib/cost.js';
import { netUnitPrice, UNCATEGORIZED } from '../../lib/model.js';
import { normKey } from '../../lib/format.js';
import { LedgerError } from './ledger.js';

const r0 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v));
const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const targetOf = (data) => data.costTarget.history.at(-1).value;
const STATUS = { rate: '목표 원가율 이내', margin: '원가율은 넘지만 최소 마진 충족', over: '목표 원가율·최소 마진 모두 미달', unknown: '원가 계산 불가' };
const PAY = { tax: '세금계산서', card: '카드', '': '미지정' };

/** 전체 요약: 목표 원가율, 분류별 최소 마진, 분류·메뉴·매입 개수 */
export function overview(data) {
  const cats = data.menuCategories.map((name) => ({
    name,
    menus: data.menus.filter((m) => m.category === name).length,
    min_margin_glass: currentMinMargin(data.minMargins, name, 'glass'),
    min_margin_bottle: currentMinMargin(data.minMargins, name, 'bottle'),
  }));
  const dates = data.purchases.map((p) => p.date).sort();
  return {
    target_cost_rate_percent: targetOf(data),
    target_history: data.costTarget.history,
    menu_categories: cats,
    uncategorized_menus: data.menus.filter((m) => !m.category).length,
    menus: data.menus.length,
    menus_without_price: data.menus.filter((m) => !m.price && !m.bottlePrice).length,
    purchases: data.purchases.length,
    purchase_period: dates.length ? { from: dates[0], to: dates.at(-1) } : null,
    note: '원가는 메뉴에 연결한 매입 품목의 가장 최근 매입 단가(할인 반영)로 계산합니다. 금액 단위는 원.',
  };
}

function menuView(m, index, data) {
  const target = targetOf(data);
  const c = menuCost(m, index);
  const minGlass = currentMinMargin(data.minMargins, m.category, 'glass');
  const minBottle = currentMinMargin(data.minMargins, m.category, 'bottle');
  const j = judgeMenu(c, m.price, target, minGlass);
  const b = bottleCost(m, index);
  const jb = judgeBottle(m, index, target, minBottle);
  const refs = b ? bottleRefs(b, m.price, minBottle) : null;
  return {
    id: m.id,
    name: m.name,
    category: m.category || UNCATEGORIZED,
    glass: {
      price: m.price || null,
      cost: r0(c.cost),
      cost_rate_percent: r1(c.rate),
      margin: m.price ? r0(j.margin) : null,
      status: m.price ? STATUS[j.status] : '판매가 없음',
      min_margin: minGlass,
      ingredients_without_cost: c.missing,
      price_for_target_rate: c.cost ? priceForTarget(c.cost, target) : null,
      price_for_min_margin: c.cost && minGlass ? priceForMargin(c.cost, minGlass) : null,
    },
    bottle: b
      ? {
          price: m.bottlePrice || null,
          cost: r0(b.cost),
          cost_rate_percent: jb ? r1(jb.rate) : null,
          margin: jb ? r0(jb.margin) : null,
          status: jb ? STATUS[jb.status] : '보틀 판매가 없음',
          min_margin: minBottle,
          glasses_per_bottle: refs?.glasses ?? null,
          reference_prices: refs && { min_margin_line: refs.byMargin, glass_total_60pct: refs.glassSum60, cost_x2: refs.x2, cost_x2_5: refs.x25 },
        }
      : null,
    ingredients: c.parts.map((p) =>
      p.g.type === 'manual'
        ? { kind: '직접 입력 재료', name: p.g.name, cost_per_serving: r0(p.cost) }
        : {
            kind: '매입 품목',
            name: p.g.itemName,
            use_per_serving: p.g.use || null,
            unit: p.unit || null,
            pack_size: p.pack || null,
            latest_unit_price: p.source ? r0(p.source.price) : null,
            latest_purchase: p.source ? { date: p.source.date, vendor: p.source.vendor } : null,
            previous_unit_price: p.prev ? r0(p.prev.price) : null,
            cost_per_serving: r0(p.cost),
            problem: p.reason ?? null,
          },
    ),
  };
}

/** 메뉴별 원가·원가율·마진 (분류로 거르기, 이름 일부로 찾기) */
export function listMenus(data, { category, name } = {}) {
  const index = buildItemIndex(data.purchases, data.itemLinks);
  let menus = data.menus;
  if (category) menus = menus.filter((m) => (category === UNCATEGORIZED ? !m.category : m.category === category));
  if (name) menus = menus.filter((m) => normKey(m.name).includes(normKey(name)));
  return { target_cost_rate_percent: targetOf(data), count: menus.length, menus: menus.map((m) => menuView(m, index, data)) };
}

const totalOf = (p) => p.items.reduce((s, i) => s + (Number(i.amount) || 0), 0);

/** 매입 기록 찾기 (최근 순): 품목·거래처 이름 일부, 기간 */
export function searchPurchases(data, { query, vendor, from, to, limit = 30 } = {}) {
  const q = query ? normKey(query) : '';
  const v = vendor ? normKey(vendor) : '';
  const rows = [];
  for (const p of [...data.purchases].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)) {
    if (from && p.date < from) continue;
    if (to && p.date > to) continue;
    if (v && !normKey(p.vendor).includes(v)) continue;
    const items = q ? p.items.filter((i) => normKey(i.name).includes(q)) : p.items;
    if (q && !items.length) continue;
    rows.push({
      date: p.date,
      vendor: p.vendor,
      payment: PAY[p.payType] ?? '미지정',
      tax_invoice_issued: p.payType === 'tax' ? p.taxIssued : null,
      total: r0(totalOf(p)),
      items: items.map((i) => ({
        name: i.name,
        category: i.category,
        qty: i.qty,
        unit: i.unit || null,
        list_unit_price: r0(i.unitPrice),
        discount: r0(i.discount) || 0,
        amount: r0(i.amount),
        net_unit_price: r0(netUnitPrice(i)),
        pack: i.packSize ? `${i.packSize}${i.packUnit}` : null,
      })),
    });
    if (rows.length >= Math.min(Math.max(1, Number(limit) || 30), 100)) break;
  }
  return { count: rows.length, purchases: rows };
}

/** 품목 하나의 매입 단가 기록 (같은 품목으로 묶은 이름 포함, 최근 순) */
export function itemHistory(data, { item }) {
  const index = buildItemIndex(data.purchases, data.itemLinks);
  const hist = index.history(item);
  if (!hist.length) return { item, found: false, hint: '이 이름의 매입 기록이 없어요. search_purchases 로 이름 일부를 찾아보세요.' };
  return {
    item,
    found: true,
    names: index.names(item),
    history: hist.slice(0, 30).map((r) => ({
      date: r.date,
      vendor: r.vendor,
      name: r.name,
      net_unit_price: r0(r.price),
      qty: r.item.qty,
      unit: r.item.unit || null,
      pack: r.item.packSize ? `${r.item.packSize}${r.item.packUnit}` : null,
    })),
  };
}

// ── 쓰기 ──

/** 메뉴 찾기: id 가 같거나 이름이 같은(띄어쓰기 무시) 메뉴 하나 */
export function findMenu(data, ref) {
  const s = String(ref ?? '').trim();
  if (!s) throw new LedgerError('bad_input', '메뉴 이름이나 id 를 알려 주세요.');
  const byId = data.menus.find((m) => m.id === s);
  if (byId) return byId;
  const same = data.menus.filter((m) => normKey(m.name) === normKey(s));
  if (same.length === 1) return same[0];
  if (same.length > 1)
    throw new LedgerError('ambiguous', `"${s}" 이름의 메뉴가 ${same.length}개예요. id 로 알려 주세요: ${same.map((m) => `${m.name}(${m.category || UNCATEGORIZED}, id ${m.id})`).join(', ')}`);
  const near = data.menus.filter((m) => normKey(m.name).includes(normKey(s))).slice(0, 5);
  throw new LedgerError('not_found', `"${s}" 메뉴를 찾지 못했어요.${near.length ? ` 비슷한 메뉴: ${near.map((m) => m.name).join(', ')}` : ''}`);
}

const money = (v, label) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > 100000000) throw new LedgerError('bad_input', `${label}는 0원 이상 1억 원 이하로 알려 주세요.`);
  return n;
};
const change = (o) => ({ id: crypto.randomUUID(), at: Date.now(), ...o });

/** 판매가 바꾸기 (잔·보틀). 바꾼 내용을 change 기록으로 돌려줌 */
export function setMenuPrice(data, { menu, price, bottle_price }) {
  if (price == null && bottle_price == null) throw new LedgerError('bad_input', '바꿀 잔 판매가(price)나 보틀 판매가(bottle_price)를 알려 주세요.');
  const m = findMenu(data, menu);
  const changes = [];
  for (const [field, v, label] of [
    ['price', price, '잔 판매가'],
    ['bottlePrice', bottle_price, '보틀 판매가'],
  ]) {
    if (v == null) continue;
    const next = money(v, label);
    if (m[field] === next) continue;
    changes.push(change({ kind: 'menu_field', menuId: m.id, menuName: m.name, field, label, before: m[field], after: next }));
    m[field] = next;
  }
  const index = buildItemIndex(data.purchases, data.itemLinks);
  return { changes, menu: menuView(m, index, data) };
}

const RESERVED = ['전체', UNCATEGORIZED];
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty']);

/** 여러 메뉴 판매가를 한 번에 (동시에 여러 번 부르면 서로 엇갈려서) */
export function setMenuPrices(data, { items }) {
  if (!Array.isArray(items) || !items.length) throw new LedgerError('bad_input', '바꿀 메뉴 목록(items)을 알려 주세요.');
  if (items.length > 50) throw new LedgerError('bad_input', '한 번에 50개까지 바꿀 수 있어요.');
  for (const it of items) findMenu(data, it.menu); // 하나라도 못 찾으면 아무것도 안 바꿈
  const changes = [];
  const menus = [];
  for (const it of items) {
    const r = setMenuPrice(data, it);
    changes.push(...r.changes);
    menus.push(r.menu);
  }
  return { changes, menus };
}

/** 메뉴 분류 만들기 */
export function createCategory(data, { name }) {
  const n = String(name ?? '').trim();
  if (!n || n.length > 20) throw new LedgerError('bad_input', '분류 이름은 1~20자로 알려 주세요.');
  if (RESERVED.includes(n) || UNSAFE.has(n) || /[\u0000-\u001f\u007f<>]/.test(n)) throw new LedgerError('bad_input', `"${n}"은(는) 쓸 수 없는 분류 이름이에요.`);
  if (data.menuCategories.includes(n)) throw new LedgerError('exists', `"${n}" 분류는 이미 있어요.`);
  if (data.menuCategories.length >= 30) throw new LedgerError('bad_input', '분류는 30개까지 만들 수 있어요.');
  data.menuCategories.push(n);
  return { changes: [change({ kind: 'category_create', category: n })], categories: data.menuCategories };
}

/** 메뉴를 다른 분류로 옮기기 ('미분류' 로 빼기 가능) */
export function moveMenu(data, { menu, category }) {
  const m = findMenu(data, menu);
  const c = String(category ?? '').trim();
  const next = c === UNCATEGORIZED ? '' : c;
  if (next && !data.menuCategories.includes(next))
    throw new LedgerError('not_found', `"${c}" 분류가 없어요. 먼저 create_menu_category 로 만들거나, 있는 분류 중에서 골라 주세요: ${data.menuCategories.join(', ')}`);
  if (m.category === next) return { changes: [], menu: { id: m.id, name: m.name, category: c || UNCATEGORIZED } };
  const ch = change({ kind: 'menu_field', menuId: m.id, menuName: m.name, field: 'category', label: '분류', before: m.category, after: next });
  m.category = next;
  return { changes: [ch], menu: { id: m.id, name: m.name, category: next || UNCATEGORIZED } };
}

/**
 * 되돌리기: 바꾼 뒤 그대로일 때만 (그 사이 사장님이 앱에서 또 바꿨으면 건드리지 않음)
 * @returns {{ok: boolean, message: string}}
 */
export function undoChange(data, ch) {
  if (ch.kind === 'menu_field') {
    const m = data.menus.find((x) => x.id === ch.menuId);
    if (!m) return { ok: false, message: `"${ch.menuName}" 메뉴가 지워져서 되돌릴 수 없어요.` };
    if (m[ch.field] !== ch.after) return { ok: false, message: `"${ch.menuName}" ${ch.label}가 그 뒤에 다시 바뀌어서 되돌리지 않았어요.` };
    if (ch.field === 'category' && ch.before && !data.menuCategories.includes(ch.before)) data.menuCategories.push(ch.before);
    m[ch.field] = ch.before;
    return { ok: true, message: `"${ch.menuName}" ${ch.label}를 되돌렸어요.` };
  }
  if (ch.kind === 'category_create') {
    if (!data.menuCategories.includes(ch.category)) return { ok: true, message: `"${ch.category}" 분류는 이미 없어요.` };
    if (data.menus.some((m) => m.category === ch.category)) return { ok: false, message: `"${ch.category}" 분류에 메뉴가 있어서 지우지 않았어요.` };
    data.menuCategories = data.menuCategories.filter((c) => c !== ch.category); // 그 사이 정한 최소 마진 기록은 남겨 둠
    return { ok: true, message: `"${ch.category}" 분류를 지웠어요.` };
  }
  return { ok: false, message: '되돌릴 수 없는 기록이에요.' };
}
