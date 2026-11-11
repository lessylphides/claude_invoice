// 오늘의 운세: 같은 사람·같은 날은 같은 운세, 장부에서 팁 뽑기
import { describe, it, expect } from 'vitest';
import { todayFortune, ledgerTips, todayTip } from '../../src/lib/fortune.js';
import { HEADLINES, ADVICE } from '../../src/lib/fortuneText.js';

const NOW = Date.parse('2026-11-11T12:00:00+09:00');

describe('오늘의 운세', () => {
  it('같은 사람·같은 날이면 몇 번을 열어도 같고, 날이 바뀌면 달라짐', () => {
    const a = todayFortune('u1', '2026-11-11');
    expect(todayFortune('u1', '2026-11-11')).toEqual(a);
    const week = ['12', '13', '14', '15', '16', '17'].map((d) => todayFortune('u1', `2026-11-${d}`).headline);
    expect(new Set([a.headline, ...week]).size).toBeGreaterThan(3);
    expect(HEADLINES).toContain(a.headline);
    expect(ADVICE).toContain(a.advice);
    for (const k of ['money', 'guest', 'vendor']) expect(a[k].stars).toBeGreaterThanOrEqual(3);
    expect(a.luckyTime).toMatch(/^(오전|오후|낮) \d+시$/);
  });

  it('장부 팁: 세금계산서 미발행, 단가 인상, 판매가 빈 메뉴, 기록 공백', () => {
    const tips = ledgerTips(
      {
        purchases: [
          { date: '2026-11-02', vendor: '서광컴퍼니', payType: 'tax', taxIssued: false, createdAt: Date.parse('2026-11-02T10:00:00+09:00'), items: [{ name: '우유 1L', qty: 10, amount: 25000 }] },
          { date: '2026-11-05', vendor: '서광컴퍼니', payType: 'tax', taxIssued: true, createdAt: Date.parse('2026-11-05T10:00:00+09:00'), items: [{ name: '우유1L', qty: 10, amount: 28000 }] },
        ],
        menus: [{ price: 0 }, { price: 5000 }],
      },
      NOW,
    );
    const text = tips.map((t) => t.text).join('\n');
    expect(tips[0].text).toContain('세금계산서 미발행이 25,000원');
    expect(text).toContain('우유1L 단가가 지난번보다 12% 올랐어요');
    expect(text).toContain('판매가가 비어 있는 메뉴가 1개');
    expect(text).toContain('마지막 기록이 6일 전');
    expect(text).not.toContain('서광컴퍼니예요'); // 한 거래처 몰림은 이번 달 3건 이상일 때만
  });

  it('장부가 비어 있으면 일반 장사 팁', () => {
    expect(todayTip({}, 'u1', '2026-11-11', NOW)).toMatchObject({ icon: '💡', fromLedger: false });
  });
});
