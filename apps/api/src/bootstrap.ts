import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { invitationSchema, passwordSchema } from '@punchin/contracts';
import { openDatabase } from './database';
import { Service } from './service';
if (existsSync('.env')) process.loadEnvFile('.env');
const input = invitationSchema.parse({
  email: process.env.ADMIN_EMAIL,
  name: process.env.ADMIN_NAME,
  team: '운영',
  role: 'admin',
});
const password = passwordSchema.parse(process.env.ADMIN_PASSWORD);
const db = openDatabase(resolve(process.env.DATABASE_PATH ?? 'data/punchin.sqlite'));
try {
  await new Service(db).createAdmin(input.email, input.name, password);
  console.log('초기 관리자 계정을 생성했습니다. 비밀번호는 출력하지 않습니다.');
} finally {
  db.close();
}
