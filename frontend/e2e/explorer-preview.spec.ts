/** Complete record previews against seeded data, real routing and keyboard focus. */
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { RecordDetail } from "../src/api/records";
import { signIn } from "./auth";

test("a narrow table opens full text, metadata and related records, and survives reload", async ({ page }) => {
  await signIn(page, "admin", "/explore?resource=ticket&columns=reference");
  const button = page.getByRole("button", { name: /^Preview / }).first();
  await expect(button).toBeVisible();
  const detailResponse = page.waitForResponse((response) => response.url().includes("/api/records/ticket/"));
  await button.focus();
  await page.keyboard.press("Enter");
  const detail = await (await detailResponse).json() as RecordDetail;
  const dialog = page.getByRole("dialog");
  const text = detail.fields.find((field) => field.name === "description")?.value;
  expect(typeof text).toBe("string");
  await expect(dialog.getByRole("article").locator("p")).toHaveText(String(text));
  await expect(dialog.getByRole("heading", { name: "Metadata", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/columns=reference/);
  await expect(page).toHaveURL(new RegExp(`record=${detail.id}`));
  await dialog.screenshot({ path: "test-results/explorer-record-preview.png" });

  await dialog.getByRole("tab", { name: "Related records" }).click();
  await expect(dialog.locator(".ant-list-item").first()).toBeVisible();
  await page.reload();
  await expect(dialog.getByRole("article").locator("p")).toHaveText(String(text));

  // Let the drawer finish arriving before measuring it.
  //
  // AntD fades and slides the panel in, and a colour sampled mid-transition is
  // a *blend* of the text and whatever is behind it — which axe then reports
  // as a serious contrast failure on every element at once, for a frame no
  // reader ever sees. Measured at rest the same link is 5.4:1 in light mode
  // and 4.8:1 in dark. So the wait is for the document to stop animating,
  // not a sleep: a fixed delay is either too short on a loaded machine or
  // wasted on a fast one.
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  );

  const accessibility = await new AxeBuilder({ page }).include(".ant-drawer-content").analyze();
  expect(accessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  // AntD animates width changes for 300ms; inspect the settled layout.
  await expect.poll(async () => (await dialog.boundingBox())?.width ?? Infinity)
    .toBeLessThanOrEqual(390);
  await dialog.screenshot({ path: "test-results/explorer-record-preview-mobile.png" });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page).not.toHaveURL(/record=/);
  await expect(page).toHaveURL(/columns=reference/);
});

test("back and forward restore the record selection without replacing the question", async ({ page }) => {
  await signIn(page, "admin", "/explore?resource=project&columns=code&view=cards");
  await expect(page.locator(".nu-result--cards").first()).toBeVisible();
  await page.locator(".nu-result--cards").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const selected = page.url();
  await page.goBack();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.goForward();
  await expect(page).toHaveURL(selected);
  await expect(page.getByRole("dialog").getByRole("article")).toBeVisible();
});

test("a missing record leaves the search usable and reports a traceable error", async ({ page }) => {
  await signIn(page, "admin", "/explore?resource=ticket&record=00000000-0000-0000-0000-000000000000");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Record not found", { exact: true })).toBeVisible();
  // The id to quote, and what to do about it — the shared failure surface
  // prints the id alone and makes it copyable, rather than labelling it
  // "Correlation ID:" as one of the six hand-written copies used to.
  const failure = dialog.getByTestId("failure-alert");
  await expect(failure).toHaveAttribute("data-failure", "not_found");
  // The correlation id is a bare hex string, not a dashed UUID.
  await expect(failure).toContainText(/[0-9a-f]{16,}/);
  await expect(failure).toContainText(/deleted, or the link may be wrong/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Preview / }).first()).toBeVisible();
});
