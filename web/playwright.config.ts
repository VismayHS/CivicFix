import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests for the three role journeys (e2e/*.spec.ts).
 * Uses the Chrome already installed on the machine (no browser download).
 *
 *   npm run dev            (DATA_SOURCE=postgres, databases running)
 *   npm run test:e2e       BASE_URL defaults to http://localhost:3000
 *
 * The tests file real complaints; reset the database afterwards if needed
 * (docker compose down -v && docker compose up -d).
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/warmup.ts",
  // Outside web/: the dev server watches this folder and would reload pages
  // every time a trace or screenshot is written.
  outputDir: join(tmpdir(), "civicfix-playwright"),
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1, // the journeys share seed data (Ravi's queue, the same ward)
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    navigationTimeout: 60_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" }, testIgnore: /mobile.spec.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"], channel: "chrome" }, testMatch: /mobile\.spec\.ts/ },
  ],
});
