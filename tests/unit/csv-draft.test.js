import { describe, it, expect } from 'vitest';
import { csvCell, purchasesCsv } from '../../src/lib/csv.js';
import { draftFromOcr, fillSpec } from '../../src/lib/draft.js';

describe('CSV', () => {
  it('따옴표 이스케이프', () => expect(csvCell('a"b')).toBe('"a""b"'));
  it('엑셀 수식 실행 방지 (음수는 그대로)', () => {
    expect(csvCell('=SUM(A1)')).toBe(`"'=SUM(A1)"`);
    expect(csvCell('+82')).toBe(`"'+82"`);
    expect(csvCell('@cmd')).toBe(`"'@cmd"`);
    expect(csvCell('-x')).toBe(`"'-x"`);
    expect(csvCell(-3000)).toBe('"-3000"');
    expect(csvCell(null)).toBe('""');
  });
  it('BOM, 머리글, 날짜순, 결제 구분 표시', () => {
    const csv = purchasesCsv([
      { date: '2026-11-03', vendor: 'B', payType: 'tax', taxIssued: false, items: [{ name: '양파', category: '채소', qty: 1, unit: '망', unitPrice: 31000, discount: 1000, amount: 30000, packSize: 20000, packUnit: 'g' }] },
      { date: '2026-11-01', vendor: 'A', payType: 'card', taxIssued: false, items: [{ name: '우유', category: '유제품', qty: 2, unit: '', unitPrice: 2500, discount: 0, amount: 5000, packSize: 0, packUnit: '' }] },
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0].split(',')).toHaveLength(13);
    expect(lines[1]).toBe('"2026-11-01","A","카드","","우유","유제품","2","","","","2500","0","5000"');
    expect(lines[2]).toBe('"2026-11-03","B","세금계산서","미발행","양파","채소","1","망","20000","g","31000","1000","30000"');
  });
});

describe('인식 결과 → 입력 초안', () => {
  const base = { documentType: '영수증', date: '2026-10-28', vendor: '코스트코', paymentHint: 'card', total: 51900, items: [{ name: '멈', category: '주류·음료', qty: 1, unit: '', unitPrice: 65900, discount: 14000, amount: 51900, packSize: 0, packUnit: '' }] };

  it('그대로 옮기고 결제 구분을 정함', () => {
    const { draft, note } = draftFromOcr(base, '2026-11-04');
    expect(draft).toMatchObject({ date: '2026-10-28', vendor: '코스트코', payType: 'card', taxIssued: false });
    expect(draft.items[0]).toMatchObject({ amount: 51900, discount: 14000, unitPrice: 65900 });
    expect(note).toBe('');
  });
  it('세금계산서 문서면 세금계산서 + 발행 받음', () => {
    expect(draftFromOcr({ ...base, documentType: '세금계산서', paymentHint: 'unknown' }, 'x').draft).toMatchObject({ payType: 'tax', taxIssued: true });
    expect(draftFromOcr({ ...base, paymentHint: 'tax' }, 'x').draft).toMatchObject({ payType: 'tax', taxIssued: false });
    expect(draftFromOcr({ ...base, paymentHint: 'cash' }, 'x').draft.payType).toBe('');
  });
  it('날짜를 못 읽거나 합계가 다르면 안내', () => {
    const { draft, note } = draftFromOcr({ ...base, date: '2026-13-01', total: 60000 }, '2026-11-04');
    expect(draft.date).toBe('2026-11-04');
    expect(note).toContain('날짜를 읽지 못해');
    expect(note).toContain('품목 합계(51,900원)와 문서 합계(60,000원)');
  });
  it('단가가 없으면 (금액+할인)/수량, 금액이 없으면 수량×단가-할인', () => {
    const a = draftFromOcr({ ...base, items: [{ name: 'x', qty: 2, unitPrice: 0, discount: 1000, amount: 9000 }] }, 'x').draft.items[0];
    expect(a.unitPrice).toBe(5000);
    const b = draftFromOcr({ ...base, items: [{ name: 'x', qty: 2, unitPrice: 5000, discount: 1000, amount: 0 }] }, 'x').draft.items[0];
    expect(b.amount).toBe(9000);
  });
  it('품목이 없고 합계만 있으면 "합계" 한 줄', () => {
    const { draft } = draftFromOcr({ ...base, items: [], total: 12000 }, 'x');
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]).toMatchObject({ name: '합계', amount: 12000 });
  });
  it('용량: 이전 기록 > 인식값 > 이름에서 추정', () => {
    const specOf = (n) => (n === '케이크' ? { packSize: 7, packUnit: '개' } : null);
    const items = draftFromOcr(
      {
        ...base,
        items: [
          { name: '케이크', qty: 1, unitPrice: 100, amount: 100, packSize: 8, packUnit: '개' },
          { name: '몽키700ML', qty: 1, unitPrice: 100, amount: 100, packSize: 750, packUnit: 'ml' },
          { name: '블루베리510G', qty: 1, unitPrice: 100, amount: 100, packSize: 0, packUnit: '' },
          { name: '대파', qty: 1, unitPrice: 100, amount: 100, packSize: 0, packUnit: '' },
        ],
      },
      'x',
      specOf,
    ).draft.items;
    expect(items.map((i) => [i.packSize, i.packUnit, i._specFrom ?? null])).toEqual([
      [7, '개', 'history'],
      [750, 'ml', null],
      [510, 'g', ''],
      [0, '', null],
    ]);
  });
  it('fillSpec: 채우면 true', () => {
    const it = { name: '대파' };
    expect(fillSpec(it, () => null)).toBe(false);
    expect(fillSpec({ name: '우유1L' }, () => null)).toBe(true);
  });
});
