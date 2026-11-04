import { defineConfig, devices } from '@playwright/test';

// 아이폰 13 화면 크기로 실제 사용 흐름을 검사합니다.
// 로컬에서는 Chromium, CI 에서는 아이폰 Safari 와 같은 엔진인 WebKit 도 함께 돌립니다.
const iphone = devices['iPhone 13'];

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:4173/',
    trace: 'retain-on-failure',
    // 서비스워커가 페이지를 장악하면 WebKit 에서는 테스트의 가짜 Claude API 가 요청을 가로채지 못함
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'chromium', use: { ...iphone, browserName: 'chromium' } },
    ...(process.env.CI ? [{ name: 'webkit', use: { ...iphone, browserName: 'webkit' } }] : []),
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
