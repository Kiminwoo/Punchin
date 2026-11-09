import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  outputDir: 'test-results/live',
  testMatch: 'live.spec.ts',
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:5373',
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox'],
    },
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'server-desktop', use: { viewport: { width: 1440, height: 1050 } } },
    {
      name: 'server-mobile',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @punchin/api exec tsx ../../tests/support/server.ts',
      env: { NODE_ENV: 'test' },
      url: 'http://127.0.0.1:5390/api/health',
      reuseExistingServer: false,
    },
    {
      command: 'pnpm dev --port 5373',
      env: { API_PROXY_TARGET: 'http://127.0.0.1:5390' },
      url: 'http://127.0.0.1:5373',
      reuseExistingServer: false,
    },
    {
      command: 'pnpm dev:admin --port 5374',
      env: { API_PROXY_TARGET: 'http://127.0.0.1:5390' },
      url: 'http://127.0.0.1:5374',
      reuseExistingServer: false,
    },
  ],
});
