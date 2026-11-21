import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { decryptOffice, isCfb, WrongPassword } from '../../src/lib/officeCrypto.js';
import { readXlsx } from '../../src/lib/xlsx.js';
import { detectSalesFile, parseNaver, parsePayhere, combineSales, parseNaverOptions, normName, suggestMenu, businessDay, analyzeSales, inferNaverPrices } from '../../src/lib/salesImport.js';
import { menuCost } from '../../src/lib/cost.js';

const file = (n) => new Uint8Array(fs.readFileSync(new URL(`../fixtures/${n}`, import.meta.url)));

describe('판매 파일 불러오기', () => {
  it('비밀번호 걸린 네이버 엑셀을 기기 안에서 열기 (틀리면 WrongPassword)', () => {
    const u8 = file('naver-sample.xlsx');
    expect(isCfb(u8)).toBe(true);
    expect(() => decryptOffice(u8, '0000')).toThrow(WrongPassword);
    const zip = decryptOffice(u8, '1234');
    expect([zip[0], zip[1]]).toEqual([0x50, 0x4b]); // PK (zip)
    const sheets = readXlsx(zip);
    expect(sheets[0].name).toBe('구매확정내역');
    expect(sheets[0].rows[1][16]).toBe('2026-10-03 21:00:00'); // 날짜 셀
  });

  it('옵션정보: 메뉴 이름 속 쉼표, 증정 쿠폰, 예약 줄', () => {
    expect(parseNaverOptions('DIVE 레몬필, 진&토닉 x1,하이볼 x2/[증정] 쿠폰')).toEqual([{ name: 'DIVE 레몬필, 진&토닉', qty: 1 }, { name: '하이볼', qty: 2 }]);
    expect(parseNaverOptions('2026.10.04, 오후 8:00, 성인 2/추가상품:  5,000원')).toEqual([]);
  });

  it('영업일: 하루 시작 시각 전이면 전날', () => {
    expect(businessDay('2026-10-04 01:20:00', 6)).toBe('2026-10-03');
    expect(businessDay('2026-10-06 11:00:00', 12)).toBe('2026-10-05');
    expect(businessDay('2026-10-01 00:30:00', 6)).toBe('2026-09-30');
    expect(businessDay('2026-10-04 00:30:00', 0)).toBe('2026-10-04');
  });

  it('페이히어 실매출 + 네이버 메뉴 수량, 예약금 빼고, 날짜별 대조', () => {
    const naver = parseNaver(detectSalesFile(readXlsx(decryptOffice(file('naver-sample.xlsx'), '1234'))).sheet);
    const ph = detectSalesFile(readXlsx(file('payhere-sample.xlsx')));
    expect(ph.kind).toBe('payhere');
    expect(naver.reserved).toEqual({ count: 1, amount: 5000 });
    const r = combineSales({ naver, payhere: parsePayhere(ph, 12) });
    expect(r.ym).toBe('2026-10');
    expect(r.sales).toBe(144500); // 145,500 − 결제 할인 1,000 (11월 하이볼 빼고)
    expect(r.naverTotal).toBe(91500);
    expect(r.etcTotal).toBe(91500);
    expect(r.mismatch).toEqual([]);
    expect(r.otherMonths).toEqual(['2026-11']);
    const q = Object.fromEntries(r.items.map((i) => [i.name, [i.qty, i.kind]]));
    expect(q['하이볼']).toEqual([6, 'glass']); // 매장 3 + 네이버 3
    expect(q['롱 블랙']).toEqual([5, 'glass']);
    expect(q['DIVE 레몬필, 진&토닉']).toEqual([1, 'glass']);
    expect(q['글렌모렌지 14']).toEqual([1, 'bottle']);
    expect(r.qty).toBe(13); // 보틀은 잔 수에서 뺌
    // 하루 시작을 6시로 두면 다음 날 아침 입력이 다른 날로 가서 대조에 나옴
    const r6 = combineSales({ naver, payhere: parsePayhere(ph, 6) });
    expect(r6.mismatch.map((m) => [m.day, m.diff])).toEqual([['2026-10-05', -20000], ['2026-10-06', 20000]]);
  });

  it('메뉴 이름 연결 추천과 분석', () => {
    expect(normName('DIVE 블랙 라떼')).toBe(normName('블랙 라떼'));
    expect(normName('벤로막 10Y (스페이사이드)')).toBe(normName('벤로막 10Y'));
    const menus = [{ id: 'a', name: '블랙 라떼' }, { id: 'b', name: '롱 블랙 (푸릇)' }, { id: 'c', name: '진&앤 토닉' }];
    expect(suggestMenu(normName('DIVE 블랙 라떼'), menus)).toEqual({ menuId: 'a', sure: true });
    expect(suggestMenu(normName('DIVE 롱 블랙 - 프로토콜 푸릇'), menus).menuId).toBe(''); // 애매하면 추천 안 함 (사장님이 한 번 고름)
    expect(suggestMenu(normName('레드 에스프레소'), [{ id: 'e', name: '에스프레소' }]).menuId).toBe(''); // 다른 메뉴
    expect(suggestMenu(normName('기네스 (병)'), [{ id: 'g', name: '기네스 잔' }])).toEqual({ menuId: 'g', sure: false });
    expect(suggestMenu(normName('하이네켄 생'), menus).menuId).toBe('');
    expect(suggestMenu(normName('롱 블랙'), [...menus, { id: 'd', name: '롱 블랙(브라우니)' }, { id: 'e', name: '롱 블랙 (푸릇)' }]).sure).toBe(false); // 같은 이름 둘
    expect(suggestMenu('x', menus, { x: '' })).toEqual({ menuId: '', sure: true }); // '메뉴 아님'으로 기억
    const a = analyzeSales({ items: [{ key: 'k1', name: '라떼', qty: 10 }, { key: 'k2', name: '맥주', qty: 5 }] }, { k1: 'a' }, () => ({ cost: 1000, price: 6000 }));
    expect(a).toMatchObject({ theory: 10000, marginSum: 50000, linkedQty: 10 });
    expect(a.unlinkedTop.map((r) => r.name)).toEqual(['맥주']);
  });
  it('네이버 주문으로 메뉴 가격 추정 (1개짜리 주문 → 나머지는 모르는 메뉴가 하나인 주문으로 풀기)', () => {
    const p = inferNaverPrices([
      { amount: 16000, items: [{ name: '하이볼', qty: 1 }] },
      { amount: 38500, items: [{ name: '하이볼', qty: 2 }, { name: '롱 블랙', qty: 1 }] },
      { amount: 20000, items: [{ name: '롱 블랙', qty: 2 }, { name: '바스크 치즈 케이크', qty: 1 }] },
    ]);
    expect(p.get(normName('하이볼'))).toBe(16000);
    expect(p.get(normName('롱 블랙'))).toBe(6500); // 38,500 − 16,000×2
    expect(p.get(normName('바스크 치즈 케이크'))).toBe(7000); // 20,000 − 6,500×2
  });
  it('재료가 없는 메뉴는 원가율 0% 가 아니라 계산 불가', () => {
    expect(menuCost({ price: 9000, ingredients: [] }, { find: () => null }).rate).toBeNull();
  });
});
