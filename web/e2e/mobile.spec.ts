import { ACCOUNTS, expect, signIn, test } from "./helpers";

// Runs in the "mobile" project (Pixel 7 viewport). Checks that each page fits
// the screen: no sideways scrolling of the whole page.
const fits = async (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test("public pages fit a phone screen", async ({ page, consoleErrors: _ }) => {
  for (const path of ["/", "/search", "/dashboard", "/track/37", "/login", "/register"]) {
    await page.goto(path);
    expect(await fits(page), `${path} scrolls sideways`).toBe(true);
  }
});

test("portal pages fit a phone screen", async ({ page, consoleErrors: _ }) => {
  await signIn(page, ACCOUNTS.citizen);
  for (const path of ["/me/complaints", "/report", "/notifications"]) {
    await page.goto(path);
    expect(await fits(page), `${path} scrolls sideways`).toBe(true);
  }
  await page.context().clearCookies();
  await signIn(page, ACCOUNTS.staff);
  for (const path of ["/staff/queue", "/staff/duplicates"]) {
    await page.goto(path);
    expect(await fits(page), `${path} scrolls sideways`).toBe(true);
  }
});
