// 레벨·포인트 계산
import { describe, it, expect } from 'vitest';
import { computeLevel, levelStart, levelOf, levelName, rewardFor, rewardsBetween, nextGiftLevel, MAX_LEVEL, DAILY_RECEIPT_CAP } from '../../src/lib/levels.js';

const T = (ymd, h = 12) => Date.parse(`${ymd}T${String(h).padStart(2, '0')}:00:00+09:00`);
const buy = (date, vendor, amount, createdAt = T(date)) => ({ id: `${date}${vendor}${amount}${createdAt}`, date, vendor, createdAt, items: [{ amount }] });
const NOW = T('2026-11-11');

describe('레벨 곡선·이름·선물', () => {
  it('Lv.2 50, Lv.3 120, Lv.4 210 점부터', () => {
    expect([1, 2, 3, 4, 10].map(levelStart)).toEqual([0, 50, 120, 210, 1170]);
    expect([0, 49, 50, 119, 120, 1170].map(levelOf)).toEqual([1, 1, 2, 2, 3, 10]);
  });
  it('테마 이름, 사이 레벨은 앞 이름', () => {
    expect(levelName(1)).toBe('새내기 사장');
    expect(levelName(10)).toBe('원가 고수');
    expect(levelName(11)).toBe('원가 고수');
    expect(levelName(31)).toBe('원가 마스터');
    expect(levelName(95)).toBe('전설의 사장님');
    expect(levelName(99)).toBe('명예의 전당');
  });
  it('최고 레벨 99: 하루 영수증 3장 꾸준히(하루 약 42점) → Lv.50 약 1년, Lv.90 3년 안, Lv.99 약 3.4년', () => {
    const years = (lv) => (levelStart(lv) - 1450) / 42 / 365; // 처음 메뉴·재료 등록 약 1,450점
    expect(years(50)).toBeGreaterThan(0.9);
    expect(years(50)).toBeLessThan(1.15);
    expect(years(90)).toBeLessThan(3);
    expect(years(99)).toBeGreaterThan(3);
    expect(years(99)).toBeLessThan(3.6);
    expect(levelOf(10 ** 9)).toBe(MAX_LEVEL);
    const top = computeLevel({ itemLinks: Object.fromEntries(Array.from({ length: 20000 }, (_, i) => [i, 'x'])) }, NOW);
    expect(top).toMatchObject({ level: 99, max: true, progress: 1, toNext: 0, name: '명예의 전당' });
  });
  it('선물: Lv.2~4 3장, 5~9 5장, 10~19 10장, 20부터 5레벨마다 20장, Lv.99 50장', () => {
    expect([1, 2, 4, 5, 9, 10, 19, 20, 21, 24, 25, 95, 98, 99, 100].map(rewardFor)).toEqual([0, 3, 3, 5, 5, 10, 10, 20, 0, 0, 20, 20, 0, 50, 0]);
    expect(nextGiftLevel(20)).toBe(25);
    expect(nextGiftLevel(96)).toBe(99);
    expect(nextGiftLevel(99)).toBe(null);
    const all = rewardsBetween(1, 99);
    expect(all).toBe(9 + 25 + 100 + 16 * 20 + 50);
    expect(rewardsBetween(1, 5)).toBe(3 + 3 + 3 + 5);
    expect(rewardsBetween(5, 5)).toBe(0);
  });
});

describe('장부로 포인트 계산', () => {
  it('영수증 10점, 메뉴 20점, 메뉴에 연결한 매입 품목 재료 5점(메뉴마다 같은 품목은 한 번), 품목 묶기 5점', () => {
    const r = computeLevel(
      {
        purchases: [buy('2026-11-01', '가락청과', 28000), buy('2026-11-03', '코스트코', 50000)],
        menus: [
          { ingredients: [{ type: 'item', itemName: '우유 1L' }, { type: 'item', itemName: '우유1L' }, { type: 'manual', name: '얼음' }] },
          { ingredients: [] },
        ],
        itemLinks: { a: 'b' },
      },
      NOW,
    );
    expect(r.parts).toMatchObject({ receipts: 2, menus: 2, ingredients: 1, links: 1 });
    expect(r.points).toBe(20 + 40 + 5 + 5);
    expect(r).toMatchObject({ level: 2, name: '영수증 모으는 사장', toNext: 120 - 70 });
  });

  it('같은 영수증 두 번, 금액 0, 하루 10건 넘는 영수증은 포인트 없음', () => {
    const many = Array.from({ length: 13 }, (_, i) => buy('2026-11-05', `가게${i}`, 1000 + i, T('2026-11-05', 9) + i));
    const r = computeLevel({ purchases: [buy('2026-11-01', '가락청과', 28000), buy('2026-11-01', '(주)가락청과', 28000), buy('2026-11-02', 'x', 0), ...many] }, NOW);
    expect(r.parts.receipts).toBe(1 + DAILY_RECEIPT_CAP / 10);
  });

  it('지우면 포인트도 빠짐 (장부에서 다시 계산)', () => {
    const a = buy('2026-11-01', '가락청과', 28000);
    expect(computeLevel({ purchases: [a] }, NOW).points).toBe(10);
    expect(computeLevel({ purchases: [] }, NOW).points).toBe(0);
  });

  it('연속 기록: 3일째 +15, 7일째 +50, 지금 이어지는 일수', () => {
    const days = ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11'];
    const r = computeLevel({ purchases: days.map((d, i) => buy(d, `v${i}`, 1000 + i)) }, NOW);
    expect(r.parts.streakBonus).toBe(15 * 2 + 50); // 3·6일째 +15, 7일째 +50
    expect(r.streak).toBe(7);
    // 어제까지 이어졌으면 오늘 아직 안 적어도 유지, 이틀 비면 0
    expect(computeLevel({ purchases: [buy('2026-11-10', 'a', 1)] }, NOW).streak).toBe(1);
    expect(computeLevel({ purchases: [buy('2026-11-08', 'a', 1)] }, NOW).streak).toBe(0);
  });
});
