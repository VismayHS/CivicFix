import { ACCOUNTS, expect, fileViaApi, ref, signIn, stamp, test } from "./helpers";

test.describe("staff journey", () => {
  test("assignee starts work and resolves, citizen confirms the fix", async ({ page, request, consoleErrors: _ }) => {
    const id = await fileViaApi(request, {
      title: `Streetlight test ${stamp()} on 5th Block`,
      description: "The streetlight outside house 42 on 5th Block has been flickering and then going dark every night for a week.",
      wardId: 1,
      categoryId: 1,
    });
    await signIn(page, ACCOUNTS.staff);
    await expect(page).toHaveURL(/\/staff\/queue/);

    await page.goto(`/staff/complaints/${id}`);
    await expect(page.getByText(ref(id)).first()).toBeVisible();
    await expect(page.getByText("Ananya Rao").first()).toBeVisible(); // filer name via vw_user_directory

    await page.getByRole("button", { name: "Start work" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Start work" }).click();
    await expect(page.getByText("In progress").first()).toBeVisible();

    await page.getByRole("button", { name: "Mark resolved" }).click();
    await page.getByRole("dialog").getByRole("textbox").fill("Replaced the lamp and the starter; tested after dark.");
    await page.getByRole("dialog").getByRole("button", { name: "Mark resolved" }).click();
    await expect(page.getByText("Resolved").first()).toBeVisible();
    await expect(page.getByText("Replaced the lamp and the starter").first()).toBeVisible(); // remarks in the timeline

    // The citizen confirms the fix, which closes it.
    await page.context().clearCookies();
    await signIn(page, ACCOUNTS.citizen);
    await page.goto(`/me/complaints/${id}`);
    await page.getByRole("button", { name: "Confirm it's fixed" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm it's fixed" }).click();
    await expect(page.getByText("Closed").first()).toBeVisible();
  });

  test("staff merges a detected duplicate", async ({ page, request, consoleErrors: _ }) => {
    const id = await fileViaApi(request, {
      title: "Huge pothole near Sony World junction",
      description: "There is a large pothole in the road near Sony World junction. Two-wheelers swerve to avoid it and it fills with water when it rains.",
      wardId: 1,
      categoryId: 1,
    });
    await signIn(page, ACCOUNTS.staff);
    await page.goto("/staff/duplicates");
    const card = page.locator("li").filter({ hasText: ref(id) }).first();
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Same issue, merge" }).click();

    // The merge runs as a server action; reload the complaint until it shows the new status.
    await expect(async () => {
      await page.goto(`/staff/complaints/${id}`);
      await expect(page.getByText("Duplicate").first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
  });
});
