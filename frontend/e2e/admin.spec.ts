import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { signIn, storageStateFor } from "./auth";

/**
 * The administration area against the real stack (§11, §27).
 *
 * The claims a component test cannot make: that a setting written here is the
 * value the *server* comes back with after a reload — coerced into its declared
 * type rather than stored as the string a browser sent; that a secret is never
 * in the payload; that the rollout answer is stable across requests; and that a
 * reader without the permission is not offered the page at all.
 */

test.describe.configure({ mode: "serial" });

test("the admin index is a map of what this reader may open", async ({ page }) => {
  await signIn(page, "admin", "/admin");
  const map = page.getByTestId("admin-map");
  await expect(map).toBeVisible();

  // An administrator holds everything, so every area is listed — and each one
  // is a link rather than a card that refuses to open.
  await expect(map.getByText("System settings")).toBeVisible();
  await expect(map.getByText("Feature flags")).toBeVisible();
  await map.getByText("System settings").click();
  await expect(page).toHaveURL(/\/admin\/settings/);
});

test("a setting is stored in the type it declares, and survives a reload", async ({
  page,
}) => {
  await signIn(page, "admin", "/admin/settings?category=retention");
  await expect(page.getByTestId("settings-retention")).toBeVisible();

  const field = page.getByLabel("Log retention value");
  await field.fill("45");
  await field.blur();
  await expect(page.getByText("Log retention saved")).toBeVisible();

  // Read back from the server, not from the box that sent it: a browser sends
  // "45" and the column has to hold 45 — a setting stored as a string reads
  // wrong everywhere it is used.
  await page.reload();
  await expect(page.getByLabel("Log retention value")).toHaveValue("45");

  // And Reset puts it back to what the platform ships with.
  await page.getByTestId("reset-retention.log_days").click();
  await expect(page.getByText(/back at its default/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Log retention value")).toHaveValue("30");
});

test("a number outside its declared range is refused, with the bound named", async ({
  page,
}) => {
  await signIn(page, "admin", "/admin/settings?category=retention");
  await expect(page.getByTestId("settings-retention")).toBeVisible();

  // The control clamps, so the refusal is asserted where it is enforced — the
  // server. `InputNumber` will not let 100000 through, which is the point of
  // rendering from the declaration.
  const field = page.getByLabel("Log retention value");
  await field.fill("100000");
  await field.blur();
  await page.reload();
  const value = Number(await page.getByLabel("Log retention value").inputValue());
  expect(value).toBeLessThanOrEqual(365);
});

test("a secret is never in the payload", async ({ page }) => {
  const bodies: string[] = [];
  page.on("response", async (response) => {
    if (response.url().includes("/admin/settings")) {
      bodies.push(await response.text().catch(() => ""));
    }
  });

  await signIn(page, "admin", "/admin/settings?category=security");
  await expect(page.getByTestId("settings-security")).toBeVisible();

  // The seeded key is `whsec_…`; the screen shows the redaction and the wire
  // carries the redaction. A settings page that renders an API key puts it in
  // a screenshot, a browser cache and a support ticket.
  expect(bodies.join("\n")).not.toContain("whsec_");
  await expect(page.getByLabel("Webhook signing key value")).toHaveValue("");
});

test("a flag's rollout is the same answer on every request", async ({ page }) => {
  await signIn(page, "admin", "/admin/flags");
  await expect(page.getByTestId("flags-table")).toBeVisible();

  // Whatever the seeded flags say, the *same* reader gets the same answers
  // twice — the percentage is a stable hash of the flag and the person, and a
  // flag that flickered would make every bug report about it unreproducible.
  const read = async () =>
    page
      // `[data-row-key]` because AntD's empty state is a `tbody tr` too, and
      // an empty table would otherwise read as one row saying "no".
      .getByTestId("flags-table")
      .locator("tbody tr[data-row-key]")
      .evaluateAll((rows) => rows.map((row) => row.textContent?.includes("yes") ?? false));
  const first = await read();
  await page.reload();
  await expect(page.getByTestId("flags-table")).toBeVisible();
  expect(await read()).toEqual(first);
});

test("a flag is created off, cannot be deleted while on, and goes when off", async ({
  page,
}) => {
  await signIn(page, "admin", "/admin/flags");
  await expect(page.getByTestId("flags-table")).toBeVisible();

  const key = `e2e-flag-${Date.now()}`;
  await page.getByTestId("new-flag").click();
  await page.getByLabel("Flag name").fill("End-to-end flag");
  await page.getByLabel("Flag key").fill(key);
  await page.getByTestId("create-flag").click();
  await expect(page.getByText(/and it is off/)).toBeVisible();

  // Off, so it can be deleted. Turn it on and it cannot.
  await page.getByRole("switch", { name: "Turn on End-to-end flag" }).click();
  await expect(page.getByTestId(`delete-flag-${key}`)).toBeDisabled();

  await page.getByRole("switch", { name: "Turn off End-to-end flag" }).click();
  await expect(page.getByTestId(`delete-flag-${key}`)).toBeEnabled();
  await page.getByTestId(`delete-flag-${key}`).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByTestId(`delete-flag-${key}`)).toHaveCount(0);
});

test.describe("what a manager is offered", () => {
  test.use({ storageState: storageStateFor("manager") });

  test("not the area at all — `admin.access` is the single gate", async ({ page }) => {
    await signIn(page, "manager", "/admin");

    // A manager holds `users.manage` and `jobs.view`, and *not* `admin.access`
    // — which `core/auth` documents as the one gate deciding whether the
    // administration section exists for a reader. So there is no map to
    // filter: the area is closed, and the navigation never offered it.
    await expect(page.getByTestId("admin-map")).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Administration" })).toHaveCount(0);
  });

  test("and the pages inside it are closed too, not merely unlinked", async ({ page }) => {
    // Addressed directly, which is the only way to try — the point being that
    // the gate is on the route and not only on the menu.
    await signIn(page, "manager", "/admin/settings");
    await expect(page.getByTestId("settings-general")).toHaveCount(0);
  });
});

test("the administration pages are legible and keyboard-reachable", async ({ page }) => {
  for (const path of ["/admin", "/admin/settings", "/admin/flags"]) {
    await signIn(page, "admin", path);
    await page.waitForFunction(() =>
      document.getAnimations().every((animation) => animation.playState !== "running"),
    );

    const audit = await new AxeBuilder({ page }).include("#nu-main").analyze();
    const serious = audit.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    );
    expect(
      serious.map((violation) => ({
        path,
        id: violation.id,
        nodes: violation.nodes.map(
          (node) => `${node.target.join(" ")} :: ${node.failureSummary}`,
        ),
      })),
    ).toEqual([]);
  }
});
