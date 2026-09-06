import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run start -- --port 3100",
    url: "http://127.0.0.1:3100",
    env: {
      DATABASE_URL: `file:data/e2e-${process.pid}.db`,
      TURSO_DATABASE_URL: "",
      TURSO_AUTH_TOKEN: "",
    },
    reuseExistingServer: false,
    timeout: 30000,
  },
});
