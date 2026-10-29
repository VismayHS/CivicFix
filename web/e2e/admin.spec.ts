import { ACCOUNTS, expect, fileViaApi, signIn, stamp, test } from "./helpers";

test.describe("admin journey", () => {
  test("commissioner reassigns a complaint", async ({ page, request, consoleErrors: _ }) => {
    const id = await fileViaApi(request, {
      title: `Broken kerb test ${stamp()} near Forum Mall`,
      description: "The kerb stones along the footpath near Forum Mall gate 2 are broken and stick out into the walking path.",
      wardId: 1,
      categoryId: 2,
    });
    await signIn(page, ACCOUNTS.admin);
    await expect(page).toHaveURL(/\/admin/);
    await page.goto(`/admin/complaints/${id}`);
    await page.locator("#reassign").click();
    await page.getByRole("option").filter({ hasNotText: "Ravi Kumar" }).first().click();
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(page.getByText(/reassigned|assigned to/i).first()).toBeVisible();
    await expect(page.getByText("Reassigned by municipal admin").first()).toBeVisible(); // history row, allowed by RLS
  });

  test("SLA sweep, DB Lab and Vector console work on real data", async ({ page, consoleErrors: _ }) => {
    await signIn(page, ACCOUNTS.admin);

    await page.goto("/admin/escalations");
    await page.getByRole("button", { name: /Run SLA sweep now/ }).click();
    await expect(page.getByText(/Sweep (escalated|finished)/)).toBeVisible();

    await page.goto("/admin/db-lab");
    await page.getByRole("button", { name: /RBAC: privilege matrix/ }).click();
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByRole("cell", { name: "SELECT(cols)" }).first()).toBeVisible();
    await page.getByRole("button", { name: /Slowest resolutions/ }).click();
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByRole("cell", { name: /\d+ days? \d\d:\d\d/ }).first()).toBeVisible(); // interval formatted

    await page.goto("/admin/vector");
    await page.getByLabel("Query text").fill("water leaking from a burst pipe");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("button", { name: "Inspect" }).first()).toBeVisible();
  });

  test("all-complaints list pages through results", async ({ page, consoleErrors: _ }) => {
    await signIn(page, ACCOUNTS.admin);
    await page.goto("/admin/complaints");
    await expect(page.getByText(/Page 1 of \d+/)).toBeVisible();
    await page.getByRole("link", { name: "Next" }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText(/Page 2 of \d+/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Previous" })).toBeVisible();
  });

  test("ward admin only sees their own ward", async ({ page, consoleErrors: _ }) => {
    await signIn(page, ACCOUNTS.wardAdmin);
    await page.goto("/admin/complaints");
    await expect(page.getByText("Koramangala").first()).toBeVisible();
    await expect(page.getByText("Whitefield")).toHaveCount(0);
  });
});
