import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  outputDir: 'test-results/demo',
  testMatch: 'workspace.spec.ts',
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:5273',
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox'],
    },
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1100 } } },
    {
      name: 'mobile',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: [
    {
      command: 'pnpm dev --port 5273',
      url: 'http://127.0.0.1:5273',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm dev:admin --port 5274',
      url: 'http://127.0.0.1:5274',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
