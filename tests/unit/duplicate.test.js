// 같은 영수증을 두 번 올렸는지
import { describe, it, expect } from 'vitest';
import { findDuplicate } from '../../src/lib/duplicate.js';

const item = (amount) => ({ id: `i${amount}`, name: 'x', qty: 1, unitPrice: amount, discount: 0, amount });
const p = (id, date, vendor, amounts) => ({ id, date, vendor, items: amounts.map(item) });
const saved = [p('a', '2026-11-04', '(주)코스트코코리아 양재점', [65900, 49790]), p('b', '2026-11-04', '가락청과', [28000])];

describe('같은 영수증 찾기', () => {
  it('같은 날짜·합계·거래처(표기 차이 허용)면 같은 영수증', () => {
    expect(findDuplicate(saved, p(undefined, '2026-11-04', '코스트코코리아', [115690]))?.id).toBe('a');
    expect(findDuplicate(saved, p(undefined, '2026-11-04', '가락 청과', [10000, 18000]))?.id).toBe('b');
  });
  it('날짜·합계·거래처 중 하나라도 다르면 아님', () => {
    expect(findDuplicate(saved, p(undefined, '2026-11-05', '가락청과', [28000]))).toBeNull();
    expect(findDuplicate(saved, p(undefined, '2026-11-04', '가락청과', [28500]))).toBeNull();
    expect(findDuplicate(saved, p(undefined, '2026-11-04', '서광컴퍼니', [28000]))).toBeNull();
  });
  it('수정 중인 자기 자신은 빼고, 금액이 0이면 비교하지 않음', () => {
    expect(findDuplicate(saved, saved[1])).toBeNull();
    expect(findDuplicate(saved, p(undefined, '2026-11-04', '가락청과', [0]))).toBeNull();
  });
});
