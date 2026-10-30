import { defineConfig, devices } from '@playwright/test';

// Driven by scripts/consumer-smoke.sh, which builds and serves each consumer app
// and passes its URL via CONSUMER_URL (no webServer here).
export default defineConfig({
  testDir: 'consumer-e2e',
  outputDir: process.env.CONSUMER_OUTPUT_DIR ?? '../test-results/consumers',
  reporter: 'line',
  use: { baseURL: process.env.CONSUMER_URL },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
