/**
 * Captures README/report screenshots and the duplicate-detection demo frames
 * from a running app (DATA_SOURCE=postgres), using the installed Chrome.
 *
 *   npm run dev                      (fresh seed recommended)
 *   npm run screenshots              BASE_URL defaults to http://localhost:3000
 *   python ../docs/screenshots/make_gif.py
 *
 * Writes docs/screenshots/*.png and docs/screenshots/frames/*.png.
 * Files one complaint and merges it (the demo flow).
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "@playwright/test";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/screenshots");
const FRAMES = resolve(OUT, "frames");
mkdirSync(FRAMES, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(800); // map tiles and charts finish animating
}
async function shot(page: Page, path: string, name: string, full = false) {
  await page.goto(`${BASE}${path}`);
  await settle(page);
  await page.screenshot({ path: resolve(OUT, `${name}.png`), fullPage: full });
  console.log(`  ${name}.png`);
}
async function signIn(page: Page, email: string) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("civicfix123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

// ---------------------------------------------------------------- public
{
  const page = await (await browser.newContext(desktop)).newPage();
  await shot(page, "/", "01-home");
  await shot(page, "/dashboard", "02-public-dashboard");
  await shot(page, "/search?q=water%20leak", "03-search");
  await shot(page, "/track/37", "04-track");
}

// ---------------------------------------------- demo: duplicate detection
let filedId = 0;
{
  const page = await (await browser.newContext(desktop)).newPage();
  const frame = async (n: number) => {
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(FRAMES, `${String(n).padStart(2, "0")}.png`) });
  };
  await signIn(page, "ananya@civicfix.test");
  await page.goto(`${BASE}/report`);
  await settle(page);
  await frame(1);
  await page.locator("#ward").click();
  await page.getByRole("option", { name: /Koramangala/ }).click();
  await page.locator("#category").click();
  await page.getByRole("option", { name: "Pothole or damaged road" }).click();
  await frame(2);
  await page.getByLabel("Short title").pressSequentially("Big pothole on the road near Sony World junction", { delay: 15 });
  await frame(3);
  await page.getByLabel("What's wrong?").fill(
    "A deep pothole has opened in the middle of the road near Sony World junction. Bikes swerve into traffic to avoid it, and it fills with rain water.",
  );
  await page.locator("aside").getByText(/match$/).first().waitFor();
  await frame(4);
  await page.screenshot({ path: resolve(OUT, "05-report-duplicate-suggestion.png") });
  console.log("  05-report-duplicate-suggestion.png");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Review" }).click();
  await frame(5);
  await page.getByRole("button", { name: "File complaint" }).click();
  await page.waitForURL(/\/me\/complaints\/\d+/);
  filedId = Number(page.url().match(/complaints\/(\d+)/)![1]);
  await settle(page);
  await frame(6);
  await page.screenshot({ path: resolve(OUT, "06-citizen-complaint.png") });
  console.log("  06-citizen-complaint.png");

  const staff = await (await browser.newContext(desktop)).newPage();
  await signIn(staff, "ravi.kumar@civicfix.test");
  await staff.goto(`${BASE}/staff/duplicates`);
  await settle(staff);
  await staff.screenshot({ path: resolve(OUT, "08-staff-duplicates.png") });
  console.log("  08-staff-duplicates.png");
  const card = staff.locator("li").filter({ hasText: `CF-${String(filedId).padStart(5, "0")}` }).first();
  await card.scrollIntoViewIfNeeded();
  await staff.waitForTimeout(400);
  await staff.screenshot({ path: resolve(FRAMES, "07.png") });
  await card.getByRole("button", { name: "Same issue, merge" }).click();
  await staff.waitForTimeout(1500);
  await staff.goto(`${BASE}/staff/complaints/${filedId}`);
  await settle(staff);
  await staff.screenshot({ path: resolve(FRAMES, "08.png") });
  await shot(staff, "/staff/queue", "07-staff-queue");
}

// ----------------------------------------------------------------- admin
{
  const page = await (await browser.newContext(desktop)).newPage();
  await signIn(page, "commissioner@civicfix.test");
  await shot(page, "/admin", "09-admin-dashboard");
  await shot(page, "/admin/escalations", "10-admin-escalations");

  await page.goto(`${BASE}/admin/db-lab`);
  await page.getByRole("button", { name: /RBAC: privilege matrix/ }).click();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.getByRole("cell", { name: "SELECT(cols)" }).first().waitFor();
  await page.getByRole("cell", { name: "app_user" }).first().scrollIntoViewIfNeeded(); // show the result, not just the SQL
  await settle(page);
  await page.screenshot({ path: resolve(OUT, "11-db-lab-rbac.png") });
  console.log("  11-db-lab-rbac.png");
  await page.getByRole("button", { name: /Recursive|supervisor/i }).first().click();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.getByRole("table").last().scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: resolve(OUT, "12-db-lab-recursive.png") });
  console.log("  12-db-lab-recursive.png");

  await page.goto(`${BASE}/admin/vector`);
  await page.getByLabel("Query text").fill("water leaking from a burst pipe");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: "Inspect" }).first().waitFor();
  await page.getByRole("button", { name: "Inspect" }).first().click();
  await settle(page);
  await page.screenshot({ path: resolve(OUT, "13-vector-console.png") });
  console.log("  13-vector-console.png");
}

// ---------------------------------------------------------------- mobile
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await shot(page, "/", "14-mobile-home");
  await signIn(page, "ananya@civicfix.test");
  await shot(page, `/me/complaints/${filedId}`, "15-mobile-complaint");
}

await browser.close();
console.log(`Done. Demo complaint: CF-${String(filedId).padStart(5, "0")}.`);
