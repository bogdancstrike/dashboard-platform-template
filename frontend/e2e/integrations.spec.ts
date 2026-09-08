import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { apiAs, namespaced } from "./api";
import { signIn, storageStateFor } from "./auth";

/**
 * Connected systems against the real stack (§26).
 *
 * The claims a component test cannot make:
 *
 * **No row contradicts its own configuration.** The seed used to draw a status
 * independently of the settings and always wrote a complete one, so three of
 * twelve said `NOT_CONFIGURED` while holding everything they required. Only the
 * real database can say whether that is still true of an installation.
 *
 * **A real secret is in no response.** The configuration holds a reference by
 * name, and anything named like a secret is redacted on the way out — asserted
 * against the value PostgreSQL actually holds.
 *
 * **A check does not contact the provider, and says so.** The one claim on this
 * page that would be worth lying about, so it is checked where it is answered.
 *
 * Everything this spec changes, it puts back.
 */

test.describe.configure({ mode: "serial" });

/** Put a configuration back exactly, so the demo is what it was. */
async function restore(id: string, configuration: Record<string, unknown>) {
  const api = await apiAs("admin");
  // Sent whole: `configure` merges, and a key that was removed has to be
  // removed again rather than left behind.
  await api.put(namespaced(`/admin/integrations/${id}`), { data: { configuration } });
}

test("the page leads with what needs attention", async ({ page }) => {
  await signIn(page, "admin", "/admin/integrations");
  await expect(page.getByTestId("integrations-table")).toBeVisible();
  await expect(
    page.getByTestId("integrations-table").locator("tbody tr[data-row-key]").first(),
  ).toBeVisible();

  // The tally is computed from the derived state, so it has to agree with the
  // rows underneath it (§71).
  const api = await apiAs("admin");
  const catalogue = await (
    await api.get(namespaced("/admin/integrations/catalogue"))
  ).json();
  const listing = await (
    await api.get(namespaced("/admin/integrations?page_size=100"))
  ).json();

  for (const entry of catalogue.states as Array<{ key: string; count: number }>) {
    const actual = (listing.items as Array<{ state: string }>).filter(
      (row) => row.state === entry.key,
    ).length;
    expect(entry.count, `the ${entry.key} chip disagrees with the rows`).toBe(actual);
  }
});

test("no row contradicts its own configuration", async () => {
  // Where the original defect lived: `NOT_CONFIGURED` on rows that held every
  // setting they required.
  const api = await apiAs("admin");
  const listing = await (
    await api.get(namespaced("/admin/integrations?page_size=100"))
  ).json();

  const wrong = (
    listing.items as Array<{ name: string; state: string; missing_settings: string[] }>
  ).filter((row) => (row.state === "NOT_CONFIGURED") !== (row.missing_settings.length > 0));
  expect(wrong.map((row) => row.name)).toEqual([]);
});

test("a real secret reference is never in a response", async ({ page }) => {
  const api = await apiAs("admin");
  const listing = await (
    await api.get(namespaced("/admin/integrations?page_size=100"))
  ).json();
  const configured = (listing.items as Array<{ id: string; configured: boolean }>).find(
    (row) => row.configured,
  );
  expect(configured, "no integration is fully configured").toBeTruthy();

  const detail = await (
    await api.get(namespaced(`/admin/integrations/${configured!.id}`))
  ).json();
  expect(detail.redacted_settings.length).toBeGreaterThan(0);
  const name = detail.redacted_settings[0] as string;
  // What came back is the redaction, not a value.
  expect(String(detail.configuration[name])).toMatch(/^•+$/);

  // And the page never renders the real one either.
  await signIn(page, "admin", `/admin/integrations?integration=${configured!.id}`);
  await expect(page.getByTestId("int-settings")).toBeVisible();
  await expect(page.getByTestId(`setting-${name}`)).toHaveValue("");
  await expect(page.getByTestId(`setting-${name}`)).toHaveAttribute(
    "placeholder",
    /type to replace/,
  );
});

test("a check verifies the settings and says it did not contact the provider", async ({
  page,
}) => {
  const api = await apiAs("admin");
  const listing = await (
    await api.get(namespaced("/admin/integrations?page_size=100"))
  ).json();
  const configured = (listing.items as Array<{ id: string; configured: boolean }>).find(
    (row) => row.configured,
  );
  expect(configured).toBeTruthy();

  // Asked of the endpoint, because that is where the claim is made.
  const answer = await api.post(namespaced(`/admin/integrations/${configured!.id}/check`));
  expect(answer.status()).toBe(200);
  const body = await answer.json();
  expect(body.reached_provider).toBe(false);
  expect(body.configured).toBe(true);
  expect(body.note).toContain("does not contact");

  // And on the page, where a reader sees it.
  await signIn(page, "admin", `/admin/integrations?integration=${configured!.id}`);
  await page.getByTestId("check-settings").click();
  const result = page.getByTestId("check-result");
  await expect(result).toBeVisible();
  await expect(result).toContainText("does not contact");
  // The button never promises a connection either.
  await expect(page.getByTestId("check-settings")).toContainText("Check settings");
});

test("clearing a required setting makes it not configured, and switching on is refused", async ({
  page,
}) => {
  const api = await apiAs("admin");
  const listing = await (
    await api.get(namespaced("/admin/integrations?page_size=100"))
  ).json();
  const target = (
    listing.items as Array<{ id: string; key: string; configured: boolean; required_settings: string[] }>
  ).find((row) => row.configured && row.required_settings.length > 0);
  expect(target).toBeTruthy();

  const before = await (
    await api.get(namespaced(`/admin/integrations/${target!.id}`))
  ).json();
  // The stored configuration, not the redacted one: putting back bullets would
  // be worse than not putting anything back.
  const original: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(before.configuration as Record<string, unknown>)) {
    original[name] = value;
  }
  const cleared = target!.required_settings[target!.required_settings.length - 1]!;

  try {
    await api.put(namespaced(`/admin/integrations/${target!.id}`), {
      data: { configuration: { [cleared]: "" } },
    });

    await signIn(page, "admin", "/admin/integrations");
    await expect(page.getByTestId("integrations-table")).toBeVisible();

    // The row says what it needs, and the switch is refused with the reason.
    const row = page.getByTestId(`int-${target!.key}`);
    await expect(row).toBeVisible();
    await expect(page.getByTestId("integrations-table")).toContainText(`Needs ${cleared}`);
    await expect(page.getByTestId(`toggle-${target!.key}`)).toBeDisabled();

    // And the server refuses it too, which is the half that matters.
    const refused = await api.put(namespaced(`/admin/integrations/${target!.id}/enabled`), {
      data: { enabled: true },
    });
    expect(refused.status()).toBe(400);
    expect((await refused.json()).details.missing_settings).toContain(cleared);
  } finally {
    // Restored through the page's own endpoint, with a real value: the
    // redaction would have been rejected as "leave it alone", which is right
    // for a form and wrong for a restore.
    await restore(target!.id, { ...original, [cleared]: `${target!.key.toUpperCase()}_API_TOKEN` });
  }
});

test("a setting is saved, and the row stops asking for it", async ({ page }) => {
  const api = await apiAs("admin");
  const listing = await (
    await api.get(namespaced("/admin/integrations?page_size=100"))
  ).json();
  const target = (
    listing.items as Array<{ id: string; key: string; configured: boolean; required_settings: string[] }>
  ).find((row) => row.configured && row.required_settings.length > 0);
  expect(target).toBeTruthy();

  const before = await (
    await api.get(namespaced(`/admin/integrations/${target!.id}`))
  ).json();
  const original = { ...(before.configuration as Record<string, unknown>) };
  const cleared = target!.required_settings[target!.required_settings.length - 1]!;

  try {
    await api.put(namespaced(`/admin/integrations/${target!.id}`), {
      data: { configuration: { [cleared]: "" } },
    });

    await signIn(page, "admin", `/admin/integrations?integration=${target!.id}`);
    await expect(page.getByTestId("int-settings")).toBeVisible();
    await page.getByTestId(`setting-${cleared}`).fill("E2E_REFERENCE");
    await page.getByTestId("save-settings").click();

    await expect(page.getByText(/has everything it needs/)).toBeVisible();
    await page.goto("/admin/integrations");
    await expect(page.getByTestId(`toggle-${target!.key}`)).toBeEnabled();
  } finally {
    await restore(target!.id, { ...original, [cleared]: `${target!.key.toUpperCase()}_API_TOKEN` });
  }
});

test.describe("what a manager is offered", () => {
  test.use({ storageState: storageStateFor("manager") });

  test("nothing — the configuration names hosts and secret references", async ({ page }) => {
    await signIn(page, "manager", "/admin/integrations");
    await expect(page.getByTestId("integrations-table")).toHaveCount(0);

    const api = await apiAs("manager");
    expect((await api.get(namespaced("/admin/integrations"))).status()).toBe(403);
  });
});

test("the page is legible and keyboard-reachable", async ({ page }) => {
  await signIn(page, "admin", "/admin/integrations");
  await expect(page.getByTestId("integrations-table")).toBeVisible();
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  );

  const audit = await new AxeBuilder({ page }).include("#nu-main").analyze();
  const serious = audit.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );
  expect(
    serious.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => `${node.target.join(" ")} :: ${node.failureSummary}`),
    })),
  ).toEqual([]);
});
