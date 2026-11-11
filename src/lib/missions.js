// 성장 미션: 장부 내용으로 자동 확인 (앱·서버가 같은 규칙, 기록을 지우면 다시 계산)
// - 시작 미션: 한 번만, 장부를 쓸모 있게 만드는 첫걸음
// - 주간 미션: 매주 월요일(한국 시간)에 새로, 지난주 기록도 그대로 인정

/** 시작 미션 */
export const START_MISSIONS = [
  { id: 'first', title: '첫 영수증 기록하기', goal: 1, points: 20, of: (c) => c.receipts },
  { id: 'menus3', title: '판매가 넣은 메뉴 3개 만들기', goal: 3, points: 30, of: (c) => c.pricedMenus },
  { id: 'costed3', title: '재료까지 연결한 메뉴 3개', goal: 3, points: 40, of: (c) => c.costedMenus },
  { id: 'link1', title: '같은 품목 한 번 묶어 보기', goal: 1, points: 20, of: (c) => c.links },
  { id: 'vendors5', title: '거래처 5곳 기록하기', goal: 5, points: 30, of: (c) => c.vendors },
  { id: 'month20', title: '한 달에 영수증 20장 기록하기', goal: 20, points: 50, of: (c) => c.bestMonth },
];

/** 주간 미션 */
export const WEEK_MISSIONS = [
  { id: 'w5', title: '이번 주 영수증 5장 기록', goal: 5, points: 30, of: (w) => w.receipts },
  { id: 'w3d', title: '이번 주 3일 이상 기록', goal: 3, points: 20, of: (w) => w.days },
];

/** 한국 날짜(YYYY-MM-DD) → 월요일 시작 주 번호 (1970-01-01 은 목요일) */
export const weekOf = (dayN) => Math.floor((dayN + 3) / 7);

/**
 * @param {{receipts, pricedMenus, costedMenus, links, vendors, bestMonth, weeks: Map<number,{receipts,days:Set}>}} c
 * @param {number} thisWeek 이번 주 번호
 */
export function missionsOf(c, thisWeek) {
  const start = START_MISSIONS.map((m) => {
    const have = Math.min(m.goal, m.of(c));
    return { id: m.id, title: m.title, goal: m.goal, have, points: m.points, done: have >= m.goal };
  });
  let bonus = start.reduce((s, m) => s + (m.done ? m.points : 0), 0);
  let weeksDone = 0;
  for (const w of c.weeks.values()) {
    const v = { receipts: w.receipts, days: w.days.size };
    for (const m of WEEK_MISSIONS)
      if (m.of(v) >= m.goal) {
        bonus += m.points;
        weeksDone++;
      }
  }
  const cur = c.weeks.get(thisWeek);
  const v = { receipts: cur?.receipts || 0, days: cur?.days.size || 0 };
  const week = WEEK_MISSIONS.map((m) => {
    const have = Math.min(m.goal, m.of(v));
    return { id: m.id, title: m.title, goal: m.goal, have, points: m.points, done: have >= m.goal };
  });
  return { start, week, bonus, weeksDone };
}
