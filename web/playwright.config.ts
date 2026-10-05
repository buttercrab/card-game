import { defineConfig, devices } from '@playwright/test';

// Smoke tests over every page and every /preview state, served by the real
// server (it answers /api/presets for the rulebook and the 404 status for
// unknown paths, which `vite preview` does not). Build first:
//   cargo build --release -p server && npm run build
// SERVER_BIN points at another server binary; PORT moves it. A second
// server, on the next port, has bots that move at once, for the tests that
// play a hand (play.spec.ts).
const port = Number(process.env.PORT ?? 4317);
const server = process.env.SERVER_BIN ?? '../target/release/server';
const quickBotsURL = `http://127.0.0.1:${port + 1}`;

const sizes = [
  { name: '320x568', width: 320, height: 568, mobile: true },
  { name: '375x667', width: 375, height: 667, mobile: true },
  { name: '390x844', width: 390, height: 844, mobile: true },
  { name: '1440x900', width: 1440, height: 900, mobile: false },
];

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 20_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    reducedMotion: 'reduce',
    trace: 'off',
  },
  projects: sizes.flatMap((s) =>
    (['light', 'dark'] as const).map((scheme) => ({
      name: `${s.name}-${scheme}`,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: s.width, height: s.height },
        isMobile: s.mobile,
        hasTouch: s.mobile,
        deviceScaleFactor: s.mobile ? 2 : 1,
        colorScheme: scheme,
      },
    })),
  ),
  webServer: [
    {
      command: `${server} --web dist --addr 127.0.0.1:${port}`,
      env: { STATS_TOKEN: 'x', RUST_LOG: 'warn' },
      url: `http://127.0.0.1:${port}/healthz`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `${server} --web dist --addr 127.0.0.1:${port + 1} --bot-delay-ms 20 --bot-think-ms 20`,
      env: { RUST_LOG: 'warn' },
      url: `${quickBotsURL}/healthz`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
