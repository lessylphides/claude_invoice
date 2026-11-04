import { describe, it, expect } from 'vitest';
import { backupReminder, daysBetween, addDays } from '../../src/lib/backup.js';

describe('백업 알림', () => {
  const today = '2026-11-04';
  it('쌓인 매입이 적으면 알리지 않음', () => expect(backupReminder({ count: 9, today })).toBeNull());
  it('한 번도 백업하지 않았으면 알림', () => expect(backupReminder({ count: 10, today })).toEqual({ days: null }));
  it('마지막 백업 후 30일이 지나면 알림', () => {
    expect(backupReminder({ count: 50, lastBackupAt: '2026-10-06', today })).toBeNull();
    expect(backupReminder({ count: 50, lastBackupAt: '2026-10-05', today })).toEqual({ days: 30 });
  });
  it('나중에(미룬 날짜 전)는 알리지 않음', () => {
    expect(backupReminder({ count: 50, snoozeUntil: '2026-11-05', today })).toBeNull();
    expect(backupReminder({ count: 50, snoozeUntil: '2026-11-04', today })).toEqual({ days: null });
  });
  it('날짜 계산 (달·해 넘김, 서머타임 없음)', () => {
    expect(daysBetween('2026-10-28', '2026-11-04')).toBe(7);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
    expect(addDays('2026-11-28', 7)).toBe('2026-12-05');
  });
});
