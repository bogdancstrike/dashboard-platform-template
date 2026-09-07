import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { sweepReports } from "./api";
import { signIn, storageStateFor } from "./auth";

/**
 * The chart builder against the real stack (§28, §44).
 *
 * The claims a component test cannot make: the thumbnails are drawn from the
 * database's own numbers rather than from a fixture, a kind that could not be
 * drawn stays refused after a reload because the refusal is derived from the
 * question and not from a click, and a chart saved here is a saved *analysis*
 * — it appears on `/reports` and answers through the same compiler.
 */

/** A question with one grouping and one measure: the plainest possible. */
const SIMPLE =
  "/charts/builder?resource=order&group=status&agg=sum&measure=total&period=all_time";

/** Every chart this suite saves is named for it, so the sweep can find them. */
const PREFIX = "Chart e2e";

/**
 * Remove them however the test ended.
 *
 * Unconditional, and through the API rather than the page: this file used to
 * delete its chart on the happy path only, so every failed run left one
 * behind — twenty of them, in the end, filling the `/reports` list somebody
 * had come to read.
 */
test.afterEach(() => sweepReports([PREFIX]));

test.describe("the chart builder", () => {
  test("draws every kind from the database's own numbers, and refuses the rest by name", async ({
    page,
  }) => {
    await signIn(page, "admin", SIMPLE);

    const gallery = page.getByTestId("chart-gallery");
    await expect(gallery).toBeVisible();

    // A real canvas, not an icon: the thumbnail answers "is this the right
    // picture for my data" only if it is drawn from that data.
    const bar = page.getByTestId("chart-kind-bar");
    await expect(bar.locator("canvas")).toBeVisible();

    // And the kinds this question cannot feed are offered and refused, with
    // the missing piece named (§76).
    await expect(page.getByTestId("chart-kind-heatmap")).toBeDisabled();
    await expect(page.getByTestId("chart-kind-heatmap")).toContainText(
      "needs a second grouping",
    );
    await expect(page.getByTestId("chart-kind-scatter")).toContainText(
      "needs a second measure",
    );
  });

  test("a second measure unlocks the scatter, and the link carries it", async ({ page }) => {
    await signIn(page, "admin", SIMPLE);
    await expect(page.getByTestId("chart-kind-scatter")).toBeDisabled();

    await page
      .locator(".ant-select")
      .filter({ has: page.getByRole("combobox", { name: "Second aggregation" }) })
      .locator(".ant-select-selector")
      .click();
    await page.locator(".ant-select-item-option").filter({ hasText: "Avg" }).first().click();
    await page
      .locator(".ant-select")
      .filter({ has: page.getByRole("combobox", { name: "Second measured column" }) })
      .locator(".ant-select-selector")
      .click();
    await page.locator(".ant-select-item-option").filter({ hasText: "Item count" }).first().click();

    await expect(page.getByTestId("chart-kind-scatter")).toBeEnabled();
    await page.getByTestId("chart-kind-scatter").click();
    await expect(page).toHaveURL(/chart=scatter/);

    // The whole question is in the address, so a half-built chart is a link
    // somebody else can open (§69, §72).
    const url = page.url();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto(url);
    await expect(page.getByTestId("chart-kind-scatter")).toBeEnabled();
    await expect(page.getByTestId("chart-preview").locator("canvas")).toBeVisible();
  });

  test("a saved chart is a saved analysis, and answers on the reports page", async ({ page }) => {
    const name = `${PREFIX} ${Date.now()}`;
    await signIn(page, "admin", SIMPLE);

    await page.getByTestId("chart-kind-hbar").click();
    // Saving is a dialog from the header: on the page that produces the thing
    // this button saves, the button used to be below the gallery.
    await page.getByTestId("open-save-chart").click();
    await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill(name);
    await page.getByTestId("save-chart").click();

    // It lands on the report it just became — one store, one lifecycle, and
    // the answer already computed by the same compiler.
    await expect(page).toHaveURL(/\/reports\?report=/);
    await expect(page.getByTestId("report-matched")).toContainText(/rows measured/);
    await expect(page.locator(".nu-queue-row", { hasText: name }).first()).toBeVisible();
  });

  test("is legible in both themes, and shows the reader both at once", async ({ page }) => {
    await signIn(page, "admin", SIMPLE);

    // The point of the page's own two-theme strip: whichever appearance the
    // reader is in, they see the other one too.
    const themes = page.getByTestId("chart-themes");
    await expect(themes).toBeVisible();
    await themes.scrollIntoViewIfNeeded();
    await expect(themes.locator(".nu-chart-preview--light canvas")).toBeVisible();
    await expect(themes.locator(".nu-chart-preview--dark canvas")).toBeVisible();

    // Measured at rest: a colour sampled mid-transition is a blend of the
    // text and whatever is behind it, which axe reports on every element at
    // once for a frame nobody sees.
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

  test("tells a role without reports.manage which permission it lacks", async ({ browser }) => {
    // An operator reads reports and cannot author them, and the navigation
    // does not offer the builder — but a pasted link still reaches the route,
    // and what it finds has to be an explanation rather than a blank page
    // (§34, §76).
    const context = await browser.newContext({ storageState: storageStateFor("operator") });
    const page = await context.newPage();
    await signIn(page, "operator", SIMPLE);

    await expect(page.getByText("Permission required")).toBeVisible();
    await expect(page.getByText("reports.manage", { exact: false })).toBeVisible();
    // And it is absent from the *navigation*, rather than offered and refused
    // on arrival — a whole page nobody may open is not a control. Scoped to
    // the sidebar: the breadcrumb naturally names the page being refused.
    await expect(page.locator(".nu-sider").getByText("Chart builder")).toHaveCount(0);
    await expect(page.locator(".nu-sider").getByText("Reports")).toBeVisible();
    await context.close();
  });
});
