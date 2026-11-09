import { z } from 'zod';
export const POLICY_VERSION = 'gasan-2026-11-v1';
export const passwordSchema = z.string().min(12, '비밀번호는 12자 이상 입력해 주세요.').max(128);
export const loginSchema = z
  .object({
    code: z.string().trim().max(32).optional(),
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(1).max(128),
  })
  .strict();
export const invitationSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    name: z.string().trim().min(1).max(40),
    team: z.string().trim().min(1).max(50),
    role: z.enum(['employee', 'admin']).default('employee'),
  })
  .strict();
export const activateSchema = z
  .object({
    code: z.string().trim().max(32).optional(),
    token: z.string().min(30).max(100),
    password: passwordSchema,
  })
  .strict();
export const requestSchema = z
  .object({
    type: z.enum(['연차', '오전 반차', '오후 반차', '외근', '기록 정정']),
    date: z.iso.date(),
    endDate: z.iso.date(),
    reason: z.string().trim().max(200),
    leaveDays: z.number().int().min(1).max(366).optional(),
    field: z.enum(['start', 'end']).optional(),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.type === '연차' && r.date !== r.endDate && !r.leaveDays)
      ctx.addIssue({ code: 'custom', message: '실제 연차 사용일수를 입력해 주세요.' });
    if (r.leaveDays && r.type !== '연차')
      ctx.addIssue({ code: 'custom', message: '연차만 사용일수를 입력할 수 있습니다.' });
    if (r.endDate < r.date)
      ctx.addIssue({ code: 'custom', message: '종료일은 시작일 이후여야 합니다.' });
    if (r.type !== '연차' && r.endDate !== r.date)
      ctx.addIssue({ code: 'custom', message: '이 요청은 하루 단위로 등록해 주세요.' });
    if (['외근', '기록 정정'].includes(r.type) && !r.reason)
      ctx.addIssue({ code: 'custom', message: '외근·정정에는 사유가 필요합니다.' });
    if (r.type === '기록 정정' && !r.time)
      ctx.addIssue({ code: 'custom', message: '정정할 시각이 필요합니다.' });
    if (r.type !== '기록 정정' && (r.time || r.field))
      ctx.addIssue({ code: 'custom', message: '출근 시각은 기록 정정에서만 입력할 수 있습니다.' });
  });
export const decisionSchema = z
  .object({
    chargedMinutes: z.number().int().positive().optional(),
    status: z.enum(['approved', 'rejected', 'cancelled']),
    reason: z.string().trim().max(200).default(''),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.status === 'rejected' && !r.reason)
      ctx.addIssue({ code: 'custom', message: '반려 사유를 입력해 주세요.' });
  });
export type Person = {
  id: string;
  name: string;
  team: string;
  role: 'admin' | 'employee';
  status: 'active' | 'invited' | 'inactive';
  email?: string;
  state: string;
  start: string;
  color: string;
  roleLabel: string;
};
export type SessionUser = {
  id: string;
  name: string;
  email: string;
  team: string;
  role: 'admin' | 'employee';
};
export type RecordView = {
  date: string;
  start: string;
  end: string | null;
  originalStart?: string;
  originalEnd?: string | null;
  corrected?: boolean;
  startCorrected?: boolean;
  endCorrected?: boolean;
  needsReview?: boolean;
  userId?: string;
  name?: string;
};
export type RequestView = z.infer<typeof requestSchema> & {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  name: string;
  userId: string;
  decisionReason?: string;
  createdAt: string;
  baseVersion?: number;
  requestedMinutes?: number;
  approvedMinutes?: number;
  cancellationStatus?: 'pending' | 'approved' | 'rejected';
  cancellationReason?: string;
};
export type Snapshot = {
  version: 1;
  day: RecordView;
  history: RecordView[];
  requests: RequestView[];
  people: Person[];
  user: SessionUser;
  serverNow: string;
  policyVersion: string;
  locationVerification: 'not_configured' | 'enabled';
  office: Office;
  leave: { balanceMinutes: number; pendingMinutes: number; configured: boolean };
};
export const locationSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(10000),
    capturedAt: z.iso.datetime(),
  })
  .strict();
export const officeSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    address: z.string().trim().min(1).max(200),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    radius: z.number().int().min(50).max(500),
    enabled: z.boolean(),
    confirmed: z.boolean(),
  })
  .strict()
  .superRefine((o, ctx) => {
    if (o.enabled && (!o.confirmed || o.latitude === null || o.longitude === null))
      ctx.addIssue({
        code: 'custom',
        message: '실제 사무실 좌표를 확인한 뒤 위치 인증을 켜 주세요.',
      });
  });
export type Office = z.infer<typeof officeSchema> & { revision: number };

export const clockSchema = z
  .object({ action: z.enum(['in', 'out']), location: locationSchema.optional() })
  .strict();

export type MonthlyReport = {
  month: string;
  state: 'open' | 'closed';
  version: number;
  generatedAt: string;
  policyVersion: string;
  rows: {
    userId: string;
    name: string;
    team: string;
    date: string;
    start: string;
    end: string | null;
    originalStart: string;
    originalEnd: string | null;
    minutes: number | null;
    needsReview: boolean;
    corrected: boolean;
  }[];
  summary: {
    employees: number;
    records: number;
    minutes: number;
    incomplete: number;
    pending: number;
  };
  closedAt?: string;
  closedBy?: string;
};
