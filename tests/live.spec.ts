import { test, expect, type Page } from '@playwright/test';
const adminUrl = 'http://127.0.0.1:5374';
const password = 'Browser-tests-only-42!';
async function login(page: Page, email: string) {
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
}
async function newEmployee(admin: Page, employee: Page, name: string, email: string) {
  await admin.goto(adminUrl);
  await login(admin, 'admin@example.test');
  await expect(admin.getByRole('heading', { name: '우리 팀의 하루를 한눈에' })).toBeVisible();
  await admin.locator('nav:visible').getByRole('link', { name: '우리 팀', exact: true }).click();
  await admin.getByRole('button', { name: '직원 초대', exact: true }).click();
  const dialog = admin.getByRole('dialog');
  await dialog.getByLabel('이름', { exact: true }).fill(name);
  await dialog.getByLabel('이메일', { exact: true }).fill(email);
  await dialog.getByLabel('팀', { exact: true }).fill('개발팀');
  await dialog.getByRole('button', { name: '초대 코드 생성' }).click();
  const token = await dialog.getByLabel('일회용 초대 코드').inputValue();
  await dialog.getByRole('button', { name: '확인', exact: true }).click();
  await employee.goto('/');
  await employee.getByRole('button', { name: '초대 코드로 처음 시작하기' }).click();
  await employee.getByLabel('초대 코드', { exact: true }).fill(token);
  await employee.getByLabel('새 비밀번호').fill(password);
  await employee.getByRole('button', { name: '계정 활성화', exact: true }).click();
  await expect(employee.getByRole('heading', { name: `좋은 하루예요, ${name}님` })).toBeVisible();
}
test('real invitation, server clock records, cross-account requests and correction approval', async ({
  page,
  browser,
}, info) => {
  const context = await browser.newContext({ viewport: info.project.use.viewport });
  const admin = await context.newPage();
  const name = `연동${info.project.name}`;
  const email = `${info.project.name}@example.test`;
  try {
    await newEmployee(admin, page, name, email);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: '출근하기', exact: true }).click();
    await expect(page.locator('.hero-bottom').getByText('10:00', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '퇴근하기', exact: true }).click();
    await page.getByRole('button', { name: '퇴근 기록하기' }).click();
    await expect(page.getByRole('button', { name: '근무 완료', exact: true })).toBeDisabled();
    await page.reload();
    await expect(page.getByRole('button', { name: '근무 완료', exact: true })).toBeDisabled();
    await page
      .getByRole('button', { name: /기록 정정/ })
      .first()
      .click();
    const form = page.getByRole('dialog');
    await form.getByLabel('날짜', { exact: true }).fill('2026-11-09');
    await form.getByLabel('정정할 출근 시각').fill('08:30');
    await form.getByLabel('내용', { exact: true }).fill('실제 출근 시각 확인');
    await form.getByRole('button', { name: '요청 등록', exact: true }).click();
    await expect(form).not.toBeVisible();
    await admin
      .locator('nav:visible')
      .getByRole('link', { name: /요청 관리/ })
      .click();
    await admin.reload();
    const request = admin
      .locator('.request-item')
      .filter({ hasText: name })
      .filter({ hasText: '기록 정정' });
    await expect(request).toBeVisible();
    await request.getByRole('button', { name: '승인', exact: true }).click();
    await expect(request.getByText('승인 완료', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator('.hero-bottom').getByText('08:30', { exact: true })).toBeVisible();
    await page.locator('nav:visible').getByRole('link', { name: '근태 기록', exact: true }).click();
    await expect(page.getByText('원본 10:00', { exact: true })).toBeVisible();
    await page.screenshot({
      path: `test-results/live-records-${info.project.name}.png`,
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
test('deactivation invalidates an already authenticated employee session', async ({
  page,
  browser,
}, info) => {
  const context = await browser.newContext({ viewport: info.project.use.viewport });
  const admin = await context.newPage();
  const name = `퇴사${info.project.name}`;
  try {
    await newEmployee(admin, page, name, `disabled-${info.project.name}@example.test`);
    await admin.getByRole('button', { name: `${name} 계정 비활성화` }).click();
    await admin
      .getByRole('dialog')
      .getByRole('button', { name: '계정 비활성화', exact: true })
      .click();
    await expect(admin.getByRole('dialog')).not.toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
test('unauthenticated login layout and server errors are usable', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await login(page, 'unknown@example.test');
  await expect(page.getByRole('alert')).toContainText('이메일 또는 비밀번호');
  await page.screenshot({ path: `test-results/login-${info.project.name}.png`, fullPage: true });
});
