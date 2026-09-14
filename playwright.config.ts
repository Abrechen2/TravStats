import { defineConfig, devices } from '@playwright/test';
import { STORAGE_STATE } from './e2e/storageState';

export default defineConfig({
  testDir: './e2e',
  // ONE worker, and not because the suite is slow.
  //
  // Every spec signs in as the same account, and several of them WRITE: the
  // importers commit flights and clean up after themselves. Run in parallel,
  // those writes land underneath specs that are reading the same account —
  // measured 2026-09-14, the cruise deep-link case passes alone and fails in a
  // full run, in all three engines. A suite that answers differently depending
  // on what else is running cannot be trusted about anything (CAMPAIGN.md,
  // CAMP-07).
  //
  // Per-spec accounts would restore the parallelism and are the better answer;
  // this is the honest one until then, and it costs about a minute.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
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
