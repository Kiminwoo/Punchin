import { describe, expect, it } from 'vitest';
import { expectedEnd, workedMinutes, parseTime, koreaDate, koreaMinute } from './index';
describe('회사 근무정책: 실근무 8시간, 11:30–13:00 휴게', () => {
  it.each([
    ['08:00', '17:30'],
    ['08:30', '18:00'],
    ['09:00', '18:30'],
    ['10:00', '19:30'],
    ['12:30', '21:00'],
    ['13:00', '21:00'],
  ])('%s 출근의 종료 예상은 %s', (start, end) => {
    expect(expectedEnd(parseTime(start))).toBe(parseTime(end));
    expect(workedMinutes(parseTime(start), parseTime(end))).toBe(480);
  });
  it.each([
    ['09:00', '18:00', 450],
    ['09:00', '11:00', 120],
    ['12:30', '18:00', 300],
    ['11:30', '13:00', 0],
    ['08:00', '11:30', 210],
  ])('휴게 중첩만 제외: %s–%s', (start, end, total) => {
    expect(workedMinutes(parseTime(start), parseTime(end))).toBe(total);
  });
  it('조기·초과 퇴근을 실제 값으로 계산한다', () => {
    expect(workedMinutes(480, 1000)).toBe(430);
    expect(workedMinutes(480, 1100)).toBe(530);
  });
  it('잘못된 입력과 지원하지 않는 야간 근무를 거부한다', () => {
    expect(() => parseTime('25:00')).toThrow();
    expect(() => workedMinutes(1000, 480)).toThrow();
    expect(() => expectedEnd(1300)).toThrow();
  });
  it('호스트 시간대와 무관하게 서울 날짜와 시각을 쓴다', () => {
    const instant = new Date('2026-11-08T23:32:00Z');
    expect(koreaDate(instant)).toBe('2026-11-09');
    expect(koreaMinute(instant)).toBe(512);
  });
});
