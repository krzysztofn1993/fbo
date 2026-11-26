import { randomBytes } from "node:crypto";

import { defineConfig, devices } from "@playwright/test";

import { passwordHash, username } from "./e2e/fixtures/test-account";

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

// A fresh secret on every run, so no session from an earlier run is valid.
const sessionSecret = randomBytes(32).toString("base64url");

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Serves the production build, so `npm run build` has to run first.
    command: `npm run start -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    // Values passed to the process take precedence over a local `.env.local`.
    env: {
      ADMIN_USERNAME: username,
      ADMIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: sessionSecret,
      SESSION_COOKIE_SECURE: "true",
    },
  },
});
