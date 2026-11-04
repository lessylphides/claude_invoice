// 백업 알림 규칙: 데이터는 이 기기에만 있으므로, 어느 정도 쌓였는데 오래 백업하지 않았으면 알려 줌
import { ymd } from './format.js';

export const REMIND_AFTER_DAYS = 30; // 마지막 백업 후 이만큼 지나면 알림
export const MIN_PURCHASES = 10; // 이만큼 쌓이기 전에는 알리지 않음
export const SNOOZE_DAYS = 7; // '나중에'를 누르면 이만큼 쉼

const toTime = (d) => {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(y, m - 1, dd).getTime();
};

export const daysBetween = (from, to) => Math.round((toTime(to) - toTime(from)) / 864e5);

export function addDays(date, n) {
  const d = new Date(toTime(date));
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/**
 * @returns {null | {days: number|null}} 알릴 필요가 없으면 null, 있으면 마지막 백업 후 지난 날 수(한 번도 안 했으면 null)
 */
export function backupReminder({ count, lastBackupAt, snoozeUntil, today }) {
  if (count < MIN_PURCHASES) return null;
  if (snoozeUntil && today < snoozeUntil) return null;
  if (!lastBackupAt) return { days: null };
  const days = daysBetween(lastBackupAt, today);
  return days >= REMIND_AFTER_DAYS ? { days } : null;
}
