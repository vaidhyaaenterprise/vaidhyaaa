import { defineConfig } from '@playwright/test';

const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: process.env.WEB_BASE_URL ?? 'http://localhost:3001',
    trace: 'on-first-retry',
    ...(browserChannel ? { channel: browserChannel } : {}),
  },
});
