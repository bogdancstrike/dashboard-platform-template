import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./auth";

/**
 * The relationship explorer (§44, §50) against the real stack.
 *
 * What is worth protecting is the trail. Following four links to an
 * interesting order and finding no way back to the customer it started from is
 * the failure this page exists to avoid, so the tests walk forward and back
 * and assert the path is in the URL the whole time.
 */
async function startFrom(page: Page, reference: string): Promise<void> {
  await page.getByPlaceholder("Search a record to start from…").fill(reference);
  await expect(page.getByRole("button", { name: "Start here" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Start here" }).first().click();
  await expect(page.getByRole("heading", { name: reference })).toBeVisible();
}

test.describe("community analysis", () => {
  test.beforeEach(async ({ page }) => signIn(page, "admin", "/find/relationships"));

  test("opens on the clustered record graph, not an empty search box", async ({ page }) => {
    // The landing state answers the question a reader arrives with — what
    // does this data look like — rather than asking them to already know.
    await expect(page.getByTestId("force-graph")).toBeVisible();
    await expect(page.getByTestId("community-list")).toBeVisible();

    // Clustered on the server over the real rows, and scored so the reader
    // knows whether to believe the picture.
    const graph = page.getByRole("img", { name: /records in \d+ communities/ });
    await expect(graph).toBeVisible();
    await expect(page.getByTestId("modularity")).toContainText(/Q 0\.\d\d/);
    await expect(page.locator(".nu-statcard-label", { hasText: "Communities" })).toBeVisible();
    await expect(page.locator(".nu-statcard-label", { hasText: "Bridges" })).toBeVisible();
  });

  test("the same slice is clustered the same way twice", async ({ page }) => {
    // Detected on the server precisely so two people see one picture. A
    // reload that re-partitioned would make the analysis unciteable.
    const clusters = page.getByTestId("community-list");
    await expect(clusters.getByRole("row").nth(1)).toBeVisible();
    const before = await clusters.getByRole("row").allInnerTexts();
    const score = await page.getByTestId("modularity").innerText();

    await page.reload();

    await expect(clusters.getByRole("row").nth(1)).toBeVisible();
    expect(await clusters.getByRole("row").allInnerTexts()).toEqual(before);
    expect(await page.getByTestId("modularity").innerText()).toBe(score);
  });

  test("re-clusters around another entity, server-side, and says so in the URL", async ({
    page,
  }) => {
    await expect(page.getByTestId("force-graph")).toBeVisible();
    const clusters = page.getByTestId("community-list");
    const before = await clusters.getByRole("row").allInnerTexts();

    await page.getByTestId("focus-picker").getByText("Projects", { exact: true }).click();

    await expect(page).toHaveURL(/focus=project/);
    await expect
      .poll(async () => clusters.getByRole("row").allInnerTexts())
      .not.toEqual(before);
  });

  test("focusing one cluster dims the rest rather than hiding them", async ({ page }) => {
    const clusters = page.getByTestId("community-list");
    await expect(clusters.getByRole("row").nth(1)).toBeVisible();
    await clusters.getByRole("row").nth(1).click();

    await expect(page.locator("g.nu-force-node.nu-dimmed").first()).toBeVisible();
    await page.getByRole("button", { name: /Show every cluster/ }).click();
    await expect(page.locator("g.nu-force-node.nu-dimmed")).toHaveCount(0);
  });
});

test.describe("the connection map", () => {
  test.beforeEach(async ({ page }) => signIn(page, "admin", "/find/relationships?view=map"));

  test("shows how the entity types connect, not just how records do", async ({ page }) => {
    await expect(page.getByTestId("schema-graph")).toBeVisible();
    await expect(page.getByTestId("relation-strength")).toBeVisible();
    await expect(page.getByTestId("hub-records")).toBeVisible();

    // Drawn from the real schema and the real rows.
    const graph = page.getByRole("img", { name: /entities connected by \d+ relations/ });
    await expect(graph).toBeVisible();
    await expect(graph.getByLabel(/Tickets, [\d,]+ records/)).toBeVisible();
    await expect(page.getByText("Relations", { exact: true })).toBeVisible();
  });

  test("a hub record is a place to start exploring", async ({ page }) => {
    const hubs = page.getByTestId("hub-records");
    await expect(hubs.getByText(/links$/).first()).toBeVisible();

    await hubs.getByRole("button", { name: /Explore/ }).first().click();

    // Straight into the per-record view, with the record chosen for them.
    await expect(page).toHaveURL(/resource=[a-z]+&id=[0-9a-f-]{36}/);
    await expect(page.getByTestId("relationship-view")).toBeVisible();
  });

  test("searching replaces the analysis rather than burying it", async ({ page }) => {
    await expect(page.getByTestId("schema-graph")).toBeVisible();

    await page.getByPlaceholder("Search a record to start from…").fill("CUS-00001");

    await expect(page.getByTestId("schema-graph")).toBeHidden();
    await expect(page.getByTestId("force-graph")).toBeHidden();
    await expect(page.getByRole("button", { name: "Start here" }).first()).toBeVisible();
  });
});

test.describe("relationship explorer", () => {
  test.beforeEach(async ({ page }) => signIn(page, "admin", "/find/relationships"));

  test("starts from any record found by name", async ({ page }) => {
    await startFrom(page, "CUS-00001");

    // Both directions, read from this record's side.
    await expect(page.getByText("Account manager")).toBeVisible();
    await expect(page.getByText(/· as customer/).first()).toBeVisible();
  });

  test("following a connection keeps the way back", async ({ page }) => {
    const first = "CUS-00001";
    await startFrom(page, first);

    await page.getByRole("button", { name: "Follow" }).first().click();

    // Somewhere else now, with a breadcrumb back to where it began.
    await expect(page.getByRole("heading", { name: first })).toBeHidden();
    const trail = page.getByRole("button", { name: first, exact: true });
    await expect(trail).toBeVisible();
    expect(new URL(page.url()).searchParams.get("trail")).toContain(first);

    await trail.click();
    await expect(page.getByRole("heading", { name: first })).toBeVisible();
    // Stepping back discards what came after it.
    expect(new URL(page.url()).searchParams.get("trail")).toBe("[]");
  });

  test("the graph shows the same connections as the list", async ({ page }) => {
    await startFrom(page, "CUS-00001");
    const connections = Number(
      (await page.getByText(/\d+ connections/).innerText()).replace(/\D/g, ""),
    );

    await page.getByTestId("relationship-view").getByText("Graph", { exact: true }).click();

    const graph = page.getByRole("img", { name: /nearest connections/ });
    await expect(graph).toBeVisible();
    // The root plus one node per connection.
    await expect(graph.locator("g.nu-force-node")).toHaveCount(connections + 1);
  });

  test("hands the record to Data Explorer", async ({ page }) => {
    await startFrom(page, "CUS-00001");

    await page.getByRole("button", { name: /Open in Data Explorer/ }).click();

    await expect(page).toHaveURL(/\/explore\?resource=customer&f\.id=/);
    await expect(page.getByRole("cell", { name: "CUS-00001", exact: true })).toBeVisible();
  });
});
