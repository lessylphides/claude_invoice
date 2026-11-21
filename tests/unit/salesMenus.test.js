import { describe, it, expect, vi } from 'vitest';
vi.mock('../../src/store.js', () => ({ store: {} }));
vi.mock('../../src/ui/sheet.js', () => ({ openSheet: () => {}, toast: () => {} }));
const { guessMenuCategory, menuCandidates } = await import('../../src/views/salesImport.js');

describe('판매 이름 → 원가 탭 메뉴', () => {
  const cats = ['칵테일', '디저트', '위스키', '맥주', '커피', '티', '와인'];
  it('분류 짐작 (앱에 있는 분류만)', () => {
    const g = (name, category = '') => guessMenuCategory({ name, category }, cats);
    expect(g('하이네켄 생', '티 & 음료')).toBe('맥주');
    expect(g('DIVE 에스프레소 티라미수')).toBe('디저트');
    expect(g('DIVE 리얼 에스프레소 마티니', '칵테일')).toBe('칵테일');
    expect(g('아드벡 (아일라)')).toBe('위스키');
    expect(g('얼 그레이')).toBe('티');
    expect(g('레드 에스프레소', '티 & 음료')).toBe('티');
    expect(g('화이트. 루아르, 뮈스까데 크뤼')).toBe('와인');
    expect(g('핑크 솔트 감자칩')).toBe('디저트');
    expect(guessMenuCategory({ name: '하이네켄 생' }, ['커피'])).toBe('');
  });
  it('후보: 네이버에 있고 연결 안 된 잔 메뉴, 증정·테스트는 기본 빼기', () => {
    const month = { items: [
      { key: 'a', name: '하이네켄 생', naver: 79, kind: 'glass' },
      { key: 'b', name: '블랙 라떼', naver: 65, kind: 'glass' },
      { key: 'c', name: '롱 블랙 1잔 증정!', naver: 2, kind: 'glass' },
      { key: 'd', name: '아란 (G)', naver: 0, pos: 12, kind: 'glass' },
      { key: 'e', name: '맥캘란 보틀', naver: 1, kind: 'bottle' },
    ] };
    expect(menuCandidates(month, { b: 'm1' }).map((c) => [c.key, c.pick])).toEqual([['a', true], ['c', false]]);
  });
});
