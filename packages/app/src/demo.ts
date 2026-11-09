import { z } from 'zod';
import { koreaDate } from '@punchin/domain';
import type { DemoState } from './types';
export const today = () => koreaDate();
export function offsetDate(offset: number) {
  const d = new Date(`${today()}T12:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() + offset);
  return koreaDate(d);
}
export function dateLabel(
  date: string,
  options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', weekday: 'short' },
) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', ...options }).format(
    new Date(`${date}T12:00:00+09:00`),
  );
}
export function seed(): DemoState {
  return {
    version: 1,
    day: { date: today(), start: '08:32', end: null },
    history: [-3, -4, -5, -6].map((offset, i) => ({
      date: offsetDate(offset),
      start: ['08:45', '09:02', '08:28', '08:51'][i]!,
      end: ['18:15', '18:32', '17:58', '18:21'][i]!,
    })),
    requests: [
      {
        id: 'seed-leave',
        type: '연차',
        date: offsetDate(4),
        endDate: offsetDate(4),
        reason: '',
        status: 'approved',
        name: '김민우',
      },
      {
        id: 'seed-correction',
        type: '기록 정정',
        date: offsetDate(-3),
        endDate: offsetDate(-3),
        time: '08:45',
        reason: '출근 기록 누락으로 정정을 요청합니다.',
        status: 'pending',
        name: '김민우',
      },
    ],
  };
}
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const attendanceSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    start: timeSchema.or(z.literal('')),
    end: timeSchema.nullable(),
  })
  .refine((r) => !r.end || (!!r.start && r.end >= r.start));
const stateSchema = z.object({
  version: z.literal(1),
  day: attendanceSchema,
  history: z.array(attendanceSchema),
  requests: z.array(
    z.object({
      id: z.string(),
      type: z.enum(['연차', '오전 반차', '오후 반차', '외근', '기록 정정']),
      date: z.string(),
      endDate: z.string(),
      reason: z.string(),
      status: z.enum(['pending', 'approved', 'rejected', 'cancelled']),
      name: z.string(),
      time: timeSchema.optional(),
      field: z.enum(['start', 'end']).optional(),
    }),
  ),
});
export function loadState(): DemoState {
  try {
    const parsed = stateSchema.safeParse(
      JSON.parse(localStorage.getItem('punchin-demo-v1') ?? 'null'),
    );
    if (parsed.success) {
      const saved = parsed.data;
      if (saved.day.date !== today())
        return {
          ...saved,
          history: [saved.day, ...saved.history],
          day: { date: today(), start: '', end: null },
        };
      return saved;
    }
  } catch {
    /* Storage may be blocked or contain obsolete demo data. */
  }
  return seed();
}
export const teammates = [
  {
    name: '김민우',
    role: '프로덕트 디자이너',
    team: '프로덕트팀',
    state: '근무 중',
    start: '08:32',
    color: 'sage',
  },
  {
    name: '이지은',
    role: '프론트엔드 개발자',
    team: '개발팀',
    state: '근무 중',
    start: '08:45',
    color: 'peach',
  },
  {
    name: '박서준',
    role: '백엔드 개발자',
    team: '개발팀',
    state: '근무 중',
    start: '08:12',
    color: 'lavender',
  },
  {
    name: '최수빈',
    role: '프로덕트 매니저',
    team: '프로덕트팀',
    state: '외근',
    start: '09:00',
    color: 'sand',
  },
  {
    name: '정하늘',
    role: '마케팅 매니저',
    team: '운영팀',
    state: '연차',
    start: '—',
    color: 'blue',
  },
  {
    name: '윤도현',
    role: '프론트엔드 개발자',
    team: '개발팀',
    state: '근무 중',
    start: '08:56',
    color: 'sage',
  },
  {
    name: '한소희',
    role: '오피스 매니저',
    team: '운영팀',
    state: '근무 중',
    start: '08:03',
    color: 'peach',
  },
  {
    name: '강지호',
    role: '백엔드 개발자',
    team: '개발팀',
    state: '근무 중',
    start: '09:10',
    color: 'lavender',
  },
];
