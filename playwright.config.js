import { defineConfig, devices } from '@playwright/test';

// PW_PORT lets parallel worktrees run the browser suite side by side. The
// default differs from safety.viz's (8099) so the two repositories never share
// a fixture server on one machine.
const port = Number(process.env.PW_PORT || 8199);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  webServer: {
    // Serve the repo root so fixture pages can load the committed dist/ bundles.
    command: `python3 -m http.server ${port} --directory .`,
    url: `http://127.0.0.1:${port}/`,
    // Never reuse a server already on the port: it may be serving another
    // checkout, and the suite would pass or fail against the wrong tree. A busy
    // port is a loud error instead; set PW_PORT to pick another.
    reuseExistingServer: false,
    timeout: 10_000
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1
      }
    }
  ]
});
