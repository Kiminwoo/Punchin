import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('punchin-demo-mode', '1'));
  await page.clock.install({ time: new Date('2026-11-09T01:00:00Z') });
});
test('dashboard renders without horizontal overflow and navigation works', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /좋은 하루예요/ })).toBeVisible();
  await expect(page.getByText('18:02', { exact: false }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `test-results/dashboard-${info.project.name}.png`,
    fullPage: true,
  });
  await page.locator('nav:visible').getByRole('link', { name: '근태 기록', exact: true }).click();
  await expect(page.getByRole('heading', { name: '나의 근태 기록', exact: false })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '내보내기' }).click();
  expect((await download).suggestedFilename()).toContain('punchin-demo-');
  expect(errors).toEqual([]);
});
test('leave request persists and can be cancelled', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /휴가 등록/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('메모 (선택)').fill('시연 휴가 테스트');
  await dialog.getByRole('button', { name: '요청 등록', exact: true }).click();
  await page
    .locator('nav:visible')
    .getByRole('link', { name: /휴가 · 요청/ })
    .click();
  await expect(page.getByText('시연 휴가 테스트', { exact: true })).toBeVisible();
  await page.reload();
  const request = page.locator('.request-item').filter({ hasText: '시연 휴가 테스트' });
  await request.getByRole('button', { name: '신청 취소' }).click();
  await expect(request.getByText('취소', { exact: true })).toBeVisible();
});
test('early checkout preserves time and remains completed after refresh', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '퇴근하기', exact: true }).click();
  await expect(page.getByText(/목표보다 .* 적어요/)).toBeVisible();
  await page.getByRole('button', { name: '퇴근 기록하기' }).click();
  await expect(page.getByRole('button', { name: '근무 완료', exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('button', { name: '근무 완료', exact: true })).toBeDisabled();
  await expect(page.locator('.hero-bottom').getByText('10:00', { exact: true })).toBeVisible();
});
test('team search and calendar interactions are functional', async ({ page }) => {
  await page.goto('/team');
  await page.getByRole('textbox', { name: '직원 검색' }).fill('이지은');
  await expect(page.locator('.team-member')).toHaveCount(1);
  await page.getByRole('textbox', { name: '직원 검색' }).fill('존재하지않음');
  await expect(page.getByText('검색 결과가 없어요')).toBeVisible();
  await page.goto('/');
  await page.getByRole('button', { name: '다음 달' }).click();
  await expect(page.getByRole('heading', { name: '2026년 12월' })).toBeVisible();
  await page.getByRole('button', { name: '이전 달' }).click();
  await page.getByRole('button', { name: '2026-11-13', exact: true }).click();
  await expect(page.locator('.calendar-events').getByText('연차', { exact: true })).toBeVisible();
});
test('admin can process a demo request', async ({ page }, info) => {
  await page.goto('http://127.0.0.1:5274');
  await expect(page.getByRole('heading', { name: '우리 팀의 하루를 한눈에' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: `test-results/admin-${info.project.name}.png`, fullPage: true });
  await page
    .locator('nav:visible')
    .getByRole('link', { name: /요청 관리/ })
    .click();
  const request = page.locator('.request-item').filter({ hasText: '기록 정정' });
  await request.getByRole('button', { name: '승인', exact: true }).click();
  await expect(request.getByText('승인 완료')).toBeVisible();
});
