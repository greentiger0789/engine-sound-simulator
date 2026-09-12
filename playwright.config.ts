import { defineConfig, devices } from "@playwright/test";

const devBaseUrl = process.env.E2E_DEV_BASE_URL ?? "http://dev.localhost:5173";
const webBaseUrl = process.env.E2E_WEB_BASE_URL ?? "http://web.localhost:8080";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    browserName: "chromium",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    // Keep the test origins inside the browser-defined trustworthy .localhost
    // namespace while resolving them to their Compose services.
    launchOptions: {
      args: [
        "--host-resolver-rules=MAP dev.localhost vite-app,MAP web.localhost web-app",
      ],
    },
  },
  projects: [
    {
      name: "dev",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: devBaseUrl,
      },
    },
    {
      name: "web",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: webBaseUrl,
      },
    },
  ],
});
