import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'npm run dev:playground',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // The `full` preset grew past the Desktop Chrome default 1280px: one bar of 32px
        // buttons needs ~1.4k px, so the tail items would fold into the "more" menu and the
        // specs that click them at the default width would miss them. The fold itself stays
        // covered by the explicit 360px / 480px-grid cases in toolbar.spec.
        viewport: { width: 1600, height: 900 },
      },
    },
  ],
});
