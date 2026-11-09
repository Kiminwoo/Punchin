export type Audience = 'employee' | 'admin';
export type Request = {
  id: string;
  type: string;
  date: string;
  endDate: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  name: string;
  time?: string;
  field?: 'start' | 'end';
  userId?: string;
  decisionReason?: string;
};
export type Attendance = import('@punchin/contracts').RecordView;
export type DemoState = { version: 1; day: Attendance; history: Attendance[]; requests: Request[] };
