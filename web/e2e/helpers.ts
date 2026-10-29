import { expect, test as base, type APIRequestContext, type Page } from "@playwright/test";

export const PASSWORD = "civicfix123";
export const ACCOUNTS = {
  citizen: "ananya@civicfix.test",
  staff: "ravi.kumar@civicfix.test",
  admin: "commissioner@civicfix.test",
  wardAdmin: "meera.iyer@civicfix.test",
} as const;

/**
 * `page` that fails the test on any browser console error or uncaught
 * exception, so a page that "loads" but throws in React still fails.
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: async ({ page }, provide) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && !/favicon|Download the React DevTools/.test(m.text())) errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await provide(errors);
    expect(errors, "browser console errors").toEqual([]);
  },
});
export { expect };

/** Signs in through the real login form. */
export async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** Files a complaint through the REST API (setup for staff/admin journeys). */
export async function fileViaApi(request: APIRequestContext, body: { title: string; description: string; wardId: number; categoryId: number }) {
  const login = await request.post("/api/v1/auth/login", { data: { email: ACCOUNTS.citizen, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const res = await request.post("/api/v1/complaints", { data: body });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data.complaintId as number;
}

export const ref = (id: number) => `CF-${String(id).padStart(5, "0")}`;
/** Unique text so a test's complaint never matches an earlier run's. */
export const stamp = () => new Date().toISOString().slice(11, 19).replace(/:/g, "");
