/** Same-day Korean office policy. Overnight/multi-day shifts require a separate policy. */
export const POLICY = {
  earliestStart: 8 * 60,
  lunchStart: 11 * 60 + 30,
  lunchEnd: 13 * 60,
  target: 8 * 60,
} as const;
export function parseTime(value: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('올바른 시각을 입력해 주세요.');
  const [hours, minutes] = value.split(':').map(Number);
  return hours! * 60 + minutes!;
}
export function formatTime(minutes: number): string {
  return `${Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(minutes % 60)
    .toString()
    .padStart(2, '0')}`;
}
export function workedMinutes(start: number, end: number): number {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 1440 || end < start)
    throw new Error('같은 날의 올바른 근무 구간이 필요합니다.');
  const lunch = Math.max(0, Math.min(end, POLICY.lunchEnd) - Math.max(start, POLICY.lunchStart));
  return end - start - lunch;
}
export function expectedEnd(start: number, target: number = POLICY.target): number {
  if (
    !Number.isFinite(start) ||
    start < 0 ||
    start >= 1440 ||
    target < 0 ||
    !Number.isFinite(target)
  )
    throw new Error('올바른 근무 시작과 목표가 필요합니다.');
  if (target === 0) return start;
  const lunch =
    start < POLICY.lunchEnd && start + target > POLICY.lunchStart
      ? POLICY.lunchEnd - Math.max(start, POLICY.lunchStart)
      : 0;
  const end = start + target + lunch;
  if (end > 1440) throw new Error('다음 날에 끝나는 근무는 담당자 확인이 필요합니다.');
  return end;
}
export function duration(minutes: number): string {
  const value = Math.max(0, Math.floor(minutes));
  return `${Math.floor(value / 60)}시간 ${value % 60}분`;
}
export function koreaDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function koreaMinute(date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return (
    Number(parts.find((p) => p.type === 'hour')!.value) * 60 +
    Number(parts.find((p) => p.type === 'minute')!.value)
  );
}
