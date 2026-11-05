import { describe, it, expect } from 'vitest';
import { groupKey, canonicalName, linkInto, unlink, sanitizeLinks, pairKey, nameSimilarity, findSimilar } from '../../src/lib/itemLinks.js';
import { normKey } from '../../src/lib/format.js';

describe('같은 품목 묶기', () => {
  it('묶으면 같은 묶음 키, 대표 이름은 묶은 쪽(into)', () => {
    const links = linkInto({}, '러셀 싱글배럴 750', '러셀싱글베럴');
    expect(groupKey(links, '러셀 싱글배럴 750')).toBe(normKey('러셀싱글베럴'));
    expect(groupKey(links, '러셀싱글베럴')).toBe(normKey('러셀싱글베럴'));
    expect(canonicalName(links, '러셀 싱글배럴 750')).toBe('러셀싱글베럴');
    expect(canonicalName(links, '대파')).toBe('대파');
  });
  it('이미 묶인 묶음을 다른 묶음에 합치면 한 단계로 이어짐', () => {
    let links = linkInto({}, 'B', 'A'); // B → A
    links = linkInto(links, 'C', 'B'); // C 를 B 묶음에 → 대표는 A
    expect(links).toEqual({ [normKey('B')]: 'A', [normKey('C')]: 'A' });
    links = linkInto(links, 'A', 'D'); // A 묶음 전체를 D 로
    expect(Object.values(links).every((v) => v === 'D')).toBe(true);
    expect(groupKey(links, 'C')).toBe(normKey('D'));
    expect(links[normKey('D')]).toBeUndefined();
  });
  it('같은 묶음끼리 다시 묶으면 그대로', () => {
    const links = linkInto({}, 'B', 'A');
    expect(linkInto(links, 'A', 'B')).toBe(links);
  });
  it('묶음에서 빼기 (원본은 바뀌지 않음)', () => {
    const links = linkInto({}, 'B', 'A');
    const next = unlink(links, 'B');
    expect(next).toEqual({});
    expect(links).toEqual({ [normKey('B')]: 'A' });
    expect(unlink(next, 'A')).toBe(next);
  });
  it('저장된 묶음 정리: 자기 자신·빈 값 제거, 여러 단계 → 최종 대표, 고리는 끊음', () => {
    // a→A 는 자기 자신, b 는 빈 값이라 버림. 'B' 키는 'b' 로 정규화되어 c→B→D 가 c→D 로
    expect(sanitizeLinks({ a: 'A', b: '', c: 'B', B: 'D' })).toEqual({ c: 'D', b: 'D' });
    expect(sanitizeLinks({ c: 'B', b: 'D' })).toEqual({ c: 'D', b: 'D' });
    expect(sanitizeLinks({ a: 'A' })).toEqual({});
    // x→Y, y→X 처럼 고리면 하나만 남겨 끊음 (둘 다 버리지 않음)
    expect(sanitizeLinks({ x: 'Y', y: 'X' })).toEqual({ y: 'X' });
    expect(sanitizeLinks(null)).toEqual({});
  });
  it('쌍 키는 순서와 표기 차이에 상관없이 같음', () => {
    expect(pairKey('러셀 싱글배럴', '대파')).toBe(pairKey('대파', '러셀싱글배럴'));
  });
});

describe('비슷한 이름', () => {
  it.each([
    ['러셀싱글베럴', '러셀 싱글배럴 750'],
    ['몽키숄더700ML', '몽키 숄더'],
    ['오비라거330MLX24', '오비라거'],
    ['(주)코스트코 러셀', '러셀'],
  ])('%s ≈ %s', (a, b) => expect(nameSimilarity(a, b)).toBeGreaterThanOrEqual(0.8));
  it.each([
    ['양파 20kg', '대파'],
    ['KS LONDON DRY GIN', 'KS PROSECCO DOCG'],
    ['바스크치즈케이크', '뉴욕치즈케이크'],
    ['우유', ''],
    ['조니워커 12년', '조니워커 18년'],
    ['품목1', '품목2'],
  ])('%s ≠ %s', (a, b) => expect(nameSimilarity(a, b)).toBeLessThan(0.8));
  it('가장 비슷한 후보, 건너뛸 후보 제외', () => {
    const cands = ['대파', '러셀싱글베럴', '러셀 리저브'];
    expect(findSimilar('러셀 싱글배럴 750', cands)?.name).toBe('러셀싱글베럴');
    expect(findSimilar('러셀 싱글배럴 750', cands, (c) => c === '러셀싱글베럴')).toBeNull();
    expect(findSimilar('양파', cands)).toBeNull();
  });
});
