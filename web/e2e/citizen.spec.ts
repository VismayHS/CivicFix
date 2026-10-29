import { ACCOUNTS, expect, signIn, test } from "./helpers";

test.describe("citizen journey", () => {
  test("signed-out visitor can browse, search and track", async ({ page, consoleErrors: _ }) => {
    await page.goto("/");
    await expect(page.getByRole("heading").first()).toBeVisible();
    await page.goto("/search?q=water");
    await expect(page.getByRole("link", { name: /water/i }).first()).toBeVisible();
    await page.goto("/track/37");
    await expect(page.getByText("CF-00037").first()).toBeVisible();
    // Portal pages bounce to the login form.
    await page.goto("/me/complaints");
    await expect(page).toHaveURL(/\/login/);
  });

  test("report wizard suggests the existing report, then files, then withdraws", async ({ page, consoleErrors: _ }) => {
    await signIn(page, ACCOUNTS.citizen);
    await expect(page).toHaveURL(/\/me\/complaints/);

    await page.goto("/report");
    await page.locator("#ward").click();
    await page.getByRole("option", { name: /Koramangala/ }).click();
    await page.locator("#category").click();
    await page.getByRole("option", { name: "Pothole or damaged road" }).click();
    await page.getByLabel("Short title").fill("Big pothole on the road near Sony World junction");
    await page.getByLabel("What's wrong?").fill(
      "A deep pothole has opened in the middle of the road near Sony World junction. Bikes swerve into traffic to avoid it, and it fills with rain water.",
    );

    // Live semantic duplicate check (Qdrant) in the side panel.
    const panel = page.locator("aside");
    await expect(panel.getByText(/match$/).first()).toBeVisible();
    await expect(panel.getByText(/Sony World junction/).first()).toBeVisible();

    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Review" }).click();
    await expect(page.getByText(/\d+ similar open reports? exists?/)).toBeVisible();
    await page.getByRole("button", { name: "File complaint" }).click();

    await page.waitForURL(/\/me\/complaints\/\d+/);
    await expect(page.getByText("Assigned").first()).toBeVisible();
    await expect(page.getByText("Ravi Kumar").first()).toBeVisible(); // assignee name via vw_user_directory
    await expect(page.getByText("Auto-assigned to Ravi Kumar")).toBeVisible(); // recorded as the system
    await expect(page.getByRole("button", { name: "Confirm it's fixed" })).toHaveCount(0); // nothing to confirm yet

    await page.getByRole("button", { name: "Withdraw this complaint" }).click();
    await expect(page.getByText("Closed").first()).toBeVisible();
  });
});
