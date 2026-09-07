import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/supabase",
  testMatch: "**/*.spec.ts",
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:3300",
    browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "node --env-file=.env.supabase.local node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3300",
    url: "http://127.0.0.1:3300",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
