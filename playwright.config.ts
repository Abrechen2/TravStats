import { defineConfig, devices } from '@playwright/test';
import { STORAGE_STATE } from './e2e/storageState';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
    locale: 'de-DE',
    // Animations never settle, and Playwright will not click an element whose
    // bounding box is still moving. The account-menu button was located and
    // enabled and still timed out for that reason alone. Asking the browser for
    // reduced motion is also the honest test environment: it is what a user
    // with that preference gets.
    reducedMotion: 'reduce',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // Signs in once and writes the session to disk. Everything below depends
    // on it, so a run that cannot authenticate stops here instead of reporting
    // passes about screens it never reached (AUD-098).
    { name: 'setup', testMatch: /auth\.setup\.ts/ },

    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
  ],

  webServer: {
    command: 'cd frontend && npm run dev',
    url: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
