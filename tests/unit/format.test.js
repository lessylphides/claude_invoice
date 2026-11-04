import { describe, it, expect } from 'vitest';
import { compact, won, normKey, isYmd, pct, pctShort, dateLabel, shortDate, esc } from '../../src/lib/format.js';

describe('표시 형식', () => {
  it('달력 칸 축약 금액', () => {
    expect(compact(8500)).toBe('8,500');
    expect(compact(25000)).toBe('2.5만');
    expect(compact(236000)).toBe('23.6만');
    expect(compact(1234567)).toBe('123만');
    expect(compact(150000000)).toBe('1.5억');
  });
  it('원 단위', () => expect(won(532380)).toBe('532,380원'));
  it('퍼센트', () => {
    expect(pct(14.2129)).toBe('14.2%');
    expect(pct(null)).toBe('-');
    expect(pct(Infinity)).toBe('-');
    expect(pctShort(25)).toBe('25%');
    expect(pctShort(27.5)).toBe('27.5%');
  });
  it('날짜', () => {
    expect(dateLabel('2026-11-03')).toBe('2026년 11월 3일 (화)');
    expect(shortDate('2026-10-28')).toBe('26.10.28');
    expect(isYmd('2026-02-28')).toBe(true);
    expect(isYmd('2026-02-30')).toBe(false);
    expect(isYmd('2026-1-5')).toBe(false);
    expect(isYmd(undefined)).toBe(false);
  });
  it('같은 거래처·품목 판별: 공백, (주), 주식회사, 대소문자 무시', () => {
    expect(normKey('(주)코스트코코리아 양재점')).toBe(normKey('코스트코코리아양재점'));
    expect(normKey('주식회사 싱싱농산')).toBe(normKey('㈜싱싱농산'));
    expect(normKey('양파 20kg')).toBe(normKey('양파20KG'));
    expect(normKey('KS 케틀핑크 칩')).toBe('ks케틀핑크칩');
  });
  it('HTML 이스케이프', () => expect(esc(`<b a="1">'&`)).toBe('&lt;b a=&quot;1&quot;&gt;&#39;&amp;'));
});
