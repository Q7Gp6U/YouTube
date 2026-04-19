import { defineConfig, devices } from "@playwright/test"

const port = 3001
const baseURL = `http://localhost:${port}`

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NODE_ENV: "development",
      TEST_BYPASS_AUTH: "1",
      TEST_BYPASS_USER_EMAIL: "e2e@example.com",
      TEST_BYPASS_USER_NAME: "E2E User",
      TEST_BYPASS_CREDITS: "9",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
    },
  },
})
