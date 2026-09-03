import { defineConfig, devices } from '@playwright/test';

// The suite runs against the production build, not the dev server: the claims
// in the README are about what a visitor gets, and a Vite dev bundle is not
// that. `reuseExistingServer` keeps a local `npm run preview` usable while
// iterating.
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'list' : 'line',
  use: {
    baseURL: 'http://localhost:5233',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview -- --port 5233',
    url: 'http://localhost:5233',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
