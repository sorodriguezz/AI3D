import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  workers: 1,
  use: {
    browserName: "webkit",
    baseURL: "http://127.0.0.1:1430",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:1430",
    reuseExistingServer: false,
  },
});
