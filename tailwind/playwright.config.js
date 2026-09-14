import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  use: {
    baseURL: 'http://localhost:8788',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'python3 -m http.server 8788',
    url: 'http://localhost:8788/index.html',
    reuseExistingServer: true,
  },
});
