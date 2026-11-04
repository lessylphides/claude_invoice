import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { sanitizeMinMargins, parseMargin, itemAmount, netUnitPrice, purchaseTotal, guessPack, sanitizeItem, sanitizePurchase, sanitizeMenu, sanitizeCostTarget, sanitizeCategories, migrate, mergeLegacy, normalizeDate, parseTarget, DEFAULT_CATEGORIES, DATA_VERSION } from '../../src/lib/model.js';

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-04T10:00:00'));
});
afterAll(() => vi.useRealTimers());

describe('금액 계산', () => {
  it('수량×정가-할인', () => {
    expect(itemAmount(2, 98000)).toBe(196000);
    expect(itemAmount(1, 65900, 14000)).toBe(51900);
    expect(itemAmount('3', '2500')).toBe(7500);
  });
  it('수량이나 단가가 없으면 null (직접 적은 금액 유지)', () => {
    expect(itemAmount('', 1000)).toBeNull();
    expect(itemAmount(2, '')).toBeNull();
  });
  it('할인 반영 1개당 실제 단가', () => {
    expect(netUnitPrice({ qty: 1, amount: 39790, unitPrice: 49790 })).toBe(39790);
    expect(netUnitPrice({ qty: 2, amount: 55980, unitPrice: 27990 })).toBe(27990);
    expect(netUnitPrice({ qty: 0, amount: 5000 })).toBe(5000);
    expect(netUnitPrice({ qty: 0, amount: 0, unitPrice: 700 })).toBe(700);
  });
  it('영수증 합계는 품목 금액(할인 반영, 음수 포함)의 합', () => {
    expect(purchaseTotal({ items: [{ amount: 51900 }, { amount: -3000 }, { amount: '1000' }] })).toBe(49900);
  });
});

describe('이름에서 용량 추정', () => {
  it.each([
    ['몽키숄더700ML', 700, 'ml'],
    ['휘핑크림35% 2L', 2000, 'ml'],
    ['블루베리510G', 510, 'g'],
    ['양파 20kg', 20000, 'g'],
    ['위스키 0.7l', 700, 'ml'],
    ['오비라거330MLX24', 330, 'ml'],
  ])('%s → %d %s', (name, size, unit) => {
    expect(guessPack(name)).toEqual({ packSize: size, packUnit: unit });
  });
  it.each(['대파', '바스크치즈케이크', 'KS PISTACHIOS', 'GL 세트', '5Lemon', '', null])('%s → 없음', (name) => {
    expect(guessPack(name)).toBeNull();
  });
});

describe('형식 정리', () => {
  it('품목: 숫자 변환, 금액이 없으면 계산, 용량이 없으면 단위 비움', () => {
    const i = sanitizeItem({ name: ' 양파 ', qty: '2', unitPrice: '1000', discount: -5, packSize: 0, packUnit: 'ml' });
    expect(i).toMatchObject({ name: '양파', category: '기타', qty: 2, unitPrice: 1000, discount: 0, amount: 2000, packSize: 0, packUnit: '' });
    expect(i.id).toBeTruthy();
    expect(sanitizeItem({ name: 'x', qty: 1, unitPrice: 0, amount: -3000 }).amount).toBe(-3000);
    expect(sanitizeItem({}).name).toBe('(품목명 없음)');
  });
  it('없는 날짜는 그달 마지막 날로(그달 합계 유지), 알아볼 수 없으면 오늘로', () => {
    expect(normalizeDate('2026-02-30')).toBe('2026-02-28');
    expect(normalizeDate('2028-02-31')).toBe('2028-02-29');
    expect(normalizeDate('2026-04-31')).toBe('2026-04-30');
    expect(normalizeDate('2026-13-01')).toBe('2026-11-04');
    expect(normalizeDate('어제')).toBe('2026-11-04');
    expect(normalizeDate('2026-10-28')).toBe('2026-10-28');
  });
  it('영수증: 결제 구분이 세금계산서가 아니면 발행 여부는 항상 false, 없는 날짜는 그달 말일로', () => {
    expect(sanitizePurchase({ payType: 'card', taxIssued: true }).taxIssued).toBe(false);
    expect(sanitizePurchase({ payType: 'tax', taxIssued: 1 }).taxIssued).toBe(true);
    expect(sanitizePurchase({ payType: 'cash' }).payType).toBe('');
    expect(sanitizePurchase({ date: '2026-02-30' }).date).toBe('2026-02-28');
    expect(sanitizePurchase({ date: '2026-10-28' }).date).toBe('2026-10-28');
    expect(sanitizePurchase({ vendor: '  ' }).vendor).toBe('(거래처 미상)');
  });
  it('메뉴: 품목 이름이 빈 재료는 빼고, 음수는 0으로', () => {
    const m = sanitizeMenu({ name: '진토닉', price: '9000', ingredients: [{ type: 'item', itemName: '', use: 30 }, { type: 'item', itemName: 'GIN', use: '45', packSize: -1 }, { type: 'manual', name: '', cost: -900 }] });
    expect(m.price).toBe(9000);
    expect(m.ingredients).toHaveLength(2);
    expect(m.ingredients[0]).toMatchObject({ type: 'item', itemName: 'GIN', use: 45, packSize: 0 });
    expect(m.ingredients[1]).toMatchObject({ type: 'manual', name: '기타 재료', cost: 0 });
  });
  it('분류: 빈 줄·중복 제거, 기타는 항상 포함, 비면 기본 목록', () => {
    expect(sanitizeCategories(['주류', '', ' 안주 ', '주류'])).toEqual(['주류', '안주', '기타']);
    expect(sanitizeCategories([])).toEqual(DEFAULT_CATEGORIES);
  });
  it('목표 원가율 기록: 잘못된 값은 버리고, 없으면 기본 25%', () => {
    expect(sanitizeCostTarget(null)).toEqual({ history: [{ value: 25, at: '2026-11-04', note: '기본값' }] });
    expect(sanitizeCostTarget({ history: [{ value: 0 }, { value: 'x' }, { value: 30.04, at: '2026-10-01' }] })).toEqual({ history: [{ value: 30, at: '2026-10-01' }] });
  });
  it('목표 원가율 입력 검사', () => {
    expect(parseTarget('27.55')).toBe(27.6);
    expect(() => parseTarget(0)).toThrow();
    expect(() => parseTarget(100)).toThrow();
    expect(() => parseTarget('abc')).toThrow();
  });
});

describe('저장 형식 변환 (migrate)', () => {
  it('처음 쓰는 기기: 빈 데이터', () => {
    const d = migrate(null);
    expect(d).toMatchObject({ version: DATA_VERSION, purchases: [], menus: [], categories: DEFAULT_CATEGORIES });
    expect(d.costTarget.history[0].value).toBe(25);
  });
  it('v1 데이터(원가·용량 필드 없음)도 그대로 읽힌다', () => {
    const v1 = { purchases: [{ id: 'a', date: '2026-10-28', vendor: '코스트코', payType: 'card', items: [{ id: 'i', name: '몽키숄더700ML', qty: 1, unitPrice: 49790, discount: 10000, amount: 39790 }] }], categories: ['주류·음료'] };
    const d = migrate(v1);
    expect(d.version).toBe(DATA_VERSION);
    expect(d.purchases[0].items[0]).toMatchObject({ amount: 39790, packSize: 0, packUnit: '' });
    expect(d.categories).toEqual(['주류·음료', '기타']);
    expect(d.menus).toEqual([]);
  });
  it('밖에서 들어온 데이터는 현재 버전 표시가 있어도 전부 검사, 앱이 저장한 데이터만 빠르게 통과', () => {
    const forged = { version: DATA_VERSION, purchases: [{ id: 'x', date: 'bad', items: [{ name: 'a', qty: 'x' }] }], menus: [], menuCategories: [], minMargins: {}, categories: ['a'], costTarget: { history: [{ value: 25, at: '2026-11-04' }] } };
    expect(migrate(forged).purchases[0].date).toBe('2026-11-04');
    expect(migrate(forged).purchases[0].items[0].qty).toBe(0);
    expect(migrate(forged, { trusted: true })).toBe(forged);
  });
  it('깨진 항목(null 등)이 있어도 멈추지 않고 그 항목만 버린다', () => {
    const d = migrate({ purchases: [null, 'x', { id: 'a', date: '2026-10-28', vendor: 'v', items: [null, { name: 'i', qty: 1, unitPrice: 5, amount: 5 }] }], menus: [null, { id: 'm', name: 'n', price: 1, ingredients: [null] }] });
    expect(d.purchases).toHaveLength(1);
    expect(d.purchases[0].items).toHaveLength(1);
    expect(d.menus).toHaveLength(1);
    expect(d.menus[0].ingredients).toEqual([]);
    expect(() => sanitizePurchase(null)).not.toThrow();
  });
  it('예전 저장소에 남은 내역 합치기: 없는 영수증·메뉴만 더함', () => {
    const cur = migrate({ purchases: [{ id: 'a', date: '2026-10-01', vendor: 'v', items: [] }], menus: [{ id: 'm1', name: 'x', price: 1 }] });
    const old = migrate({ purchases: [{ id: 'a', date: '2026-09-01', vendor: 'OLD', items: [] }, { id: 'b', date: '2026-10-02', vendor: 'new', items: [] }], menus: [{ id: 'm2', name: 'y', price: 1 }] });
    const { data, added } = mergeLegacy(cur, old);
    expect(added).toBe(2);
    expect(data.purchases.map((p) => [p.id, p.vendor])).toEqual([['a', 'v'], ['b', 'new']]); // 같은 id 는 현재 것을 유지
    expect(data.menus.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(mergeLegacy(cur, cur)).toEqual({ data: cur, added: 0 });
  });
  it('v2 데이터: 메뉴 분류가 없으면 기본 분류, 메뉴는 미분류로', () => {
    const d = migrate({ version: 2, menus: [{ id: 'm', name: '진토닉', price: 9000 }] }, { trusted: true });
    expect(d.version).toBe(DATA_VERSION);
    expect(d.menuCategories).toEqual(['커피', '위스키', '칵테일', '맥주', '티', '디저트']);
    expect(d.menus[0].category).toBe('');
  });
  it('메뉴에 적힌 분류가 목록에 없으면 목록 끝에 더하고, 예약어(전체·미분류)는 분류로 쓰지 않음', () => {
    const d = migrate({ menuCategories: ['커피', ' 커피 ', '전체', ''], menus: [{ name: 'a', category: '와인' }, { name: 'b', category: '미분류' }] });
    expect(d.menuCategories).toEqual(['커피', '와인']);
    expect(d.menus.map((m) => m.category)).toEqual(['와인', '']);
  });
  it('v3 데이터: 최소 마진 기록이 없으면 빈 상태로 시작', () => {
    const d = migrate({ version: 3, menuCategories: ['위스키'], menus: [] }, { trusted: true });
    expect(d.version).toBe(DATA_VERSION);
    expect(d.minMargins).toEqual({});
  });
  it('최소 마진 기록 정리: 없는 분류·잘못된 값 정리', () => {
    expect(sanitizeMinMargins({ 위스키: [{ value: '12000.4', at: '2026-11-04' }, null], 없는분류: [{ value: 1 }], 칵테일: [] }, ['위스키', '칵테일'])).toEqual({
      위스키: [{ value: 12000, at: '2026-11-04' }],
    });
    expect(sanitizeMinMargins(null, ['위스키'])).toEqual({});
  });
  it('최소 마진 입력 검사', () => {
    expect(parseMargin('')).toBe(0);
    expect(parseMargin('12000')).toBe(12000);
    expect(() => parseMargin('-1')).toThrow();
    expect(() => parseMargin('abc')).toThrow();
  });
  it('이미 정리된 데이터는 다시 넣어도 같다', () => {
    const once = migrate({ purchases: [{ id: 'a', date: '2026-10-28', vendor: 'x', createdAt: 1, items: [{ id: 'i', name: 'y', qty: 1, unitPrice: 10, amount: 10 }] }] });
    expect(migrate(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });
});
