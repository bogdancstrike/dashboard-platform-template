import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { signIn, storageStateFor } from "./auth";

/**
 * Records on a map, against the real stack (§44, §61).
 *
 * The claims that need a browser: the vendored basemap actually paints, the
 * numbers on it are the database's over the whole dataset rather than a page
 * of it, the levels reconcile with each other, and clicking a place lands on
 * the records that are there.
 */
test.describe("maps", () => {
  test("paints the world from the vendored basemap and totals the whole dataset", async ({
    page,
  }) => {
    await signIn(page, "admin", "/maps?dataset=order&metric=revenue&period=all_time");

    // A real canvas: the outlines are a committed asset, so a map that is
    // blank here is a map that is blank offline, which is the environment
    // this template exists to demonstrate.
    await expect(page.getByTestId("world-map").locator("canvas")).toBeVisible();

    const total = Number(
      ((await page.getByTestId("map-total").textContent()) ?? "").replace(/[^\d]/g, ""),
    );
    expect(total).toBeGreaterThan(0);

    // The same number the ledger reports, because the map aggregates in SQL
    // over every row rather than over a downloaded page (§71).
    await page.goto("/orders");
    const listed = ((await page.getByTestId("entity-total").textContent()) ?? "").split("of")[1];
    expect(Number((listed ?? "").replace(/[^\d]/g, ""))).toBe(total);
  });

  test("the levels reconcile: cities into countries into regions", async ({ page }) => {
    await signIn(page, "admin", "/maps?dataset=customer&metric=count&period=all_time");

    const sum = async (testId: string) => {
      const cells = await page
        .getByTestId(testId)
        .locator("tbody tr td:nth-child(3)")
        .allTextContents();
      return cells.reduce((total, cell) => total + Number(cell.replace(/[^\d]/g, "")), 0);
    };

    // A map whose levels disagree is a map nobody reconciles twice.
    await expect(
      page.getByTestId("map-regions").locator("tbody tr[data-row-key]").first(),
    ).toBeVisible();
    expect(await sum("map-regions")).toBe(await sum("map-countries"));
  });

  /**
   * Markers that would overlap are one bubble, and zooming in splits them
   * (§50).
   *
   * The tracker left clustering open with a good argument — "at thirty cities
   * there is nothing to cluster" — and the argument turns out to be about the
   * *rule*, not the feature: at the zoom this map opens on, thirteen of the
   * eighteen European cities are inside three bubbles. A rule written in
   * kilometres or in "cluster above N points" would be wrong at every zoom
   * but the one it was tuned at; this one asks whether the circles would
   * overlap on screen, which is the reader's own question.
   *
   * Asserted through the caption rather than by clicking a canvas: what the
   * picture is hiding is *said*, because a map that quietly draws thirteen
   * cities as three bubbles has answered a different question from the table
   * beside it.
   */
  test("cities too close to draw separately are one bubble until you zoom in", async ({
    page,
  }) => {
    await signIn(page, "admin", "/maps?dataset=customer&metric=count&period=all_time");
    await expect(page.getByTestId("world-map").locator("canvas")).toBeVisible();

    const note = page.getByTestId("map-clustered");
    await expect(note).toBeVisible();
    const merged = async () =>
      Number(((await note.textContent()) ?? "").replace(/^(\d+).*/s, "$1"));

    const before = await merged();
    expect(before).toBeGreaterThan(1);
    // No more places merged than there are, and the table below carries the
    // cities as rows — clustering is a drawing decision, not an answer (§55).
    const places = Number(
      (((await page.getByTestId("map-coverage").textContent()) ?? "").match(/(\d+) places/) ??
        [])[1] ?? 0,
    );
    expect(before).toBeLessThanOrEqual(places);
    await expect(
      page.getByTestId("map-cities").locator("tbody tr[data-row-key]").first(),
    ).toBeVisible();

    // Zooming in separates them: same data, more room.
    const box = (await page.getByTestId("world-map").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let step = 0; step < 6; step += 1) await page.mouse.wheel(0, -120);

    // Either fewer places are merged, or none are and the sentence is gone —
    // both are the feature working.
    await expect
      .poll(async () => ((await note.count()) === 0 ? 0 : await merged()), { timeout: 10_000 })
      .toBeLessThan(before);
  });

  test("clicking a country opens the records that are there", async ({ page }) => {
    await signIn(page, "admin", "/maps?dataset=customer&metric=count&period=all_time");

    // `tbody tr[data-row-key]` and not `tbody tr`: AntD renders its empty
    // state as a `<tr class="ant-table-placeholder">`, which *is* visible — so
    // the first version of this waited on the placeholder, read "No data" out
    // of it as the country name, clicked nothing, and failed on the URL
    // assertion fifteen seconds later. It only shows up when the table is
    // still loading, which is why it failed in a parallel sweep and passed
    // alone.
    const row = page.getByTestId("map-countries").locator("tbody tr[data-row-key]").first();
    await expect(row).toBeVisible();
    const country = ((await row.locator("td").first().textContent()) ?? "").trim();
    await row.click();

    // Filtered by what the *records* call the country, which is not always
    // what the map calls it (§44).
    await expect(page).toHaveURL(/\/customers\?f\.country=/);
    await expect(page.getByTestId("entity-total")).toBeVisible();
    const expected = country === "United States of America" ? "United States" : country;
    expect(decodeURIComponent(page.url())).toContain(`f.country=${expected}`);
  });

  test("the picture has a text equivalent and a keyboard path", async ({ browser }) => {
    // Its own persona: the smoke suite toggles the admin's theme, and a
    // colour audit read mid-toggle measures a frame nobody sees.
    const context = await browser.newContext({ storageState: storageStateFor("manager") });
    const page = await context.newPage();
    await signIn(page, "manager", "/maps?dataset=customer&metric=value&period=all_time");

    // A canvas has no text and no tab stop, so the tables carry the same
    // numbers as rows (§54, §55) — and the picture says so.
    await expect(page.getByRole("img", { name: /by place/ })).toBeVisible();
    await expect(
      page.getByTestId("map-regions").locator("tbody tr[data-row-key]").first(),
    ).toBeVisible();
    await expect(
      page.getByTestId("map-countries").locator("tbody tr[data-row-key]").first(),
    ).toBeVisible();

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
    await context.close();
  });
});
