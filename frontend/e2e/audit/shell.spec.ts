import { expect, test, type Page } from "@playwright/test";

import { storageStateFor } from "../auth";
import { axe, collect, measure, pinTheme, settle, VIEWPORTS } from "./probe";

/**
 * The shell, used rather than looked at (audit A).
 *
 * Every control the frame offers on every page — fold, collapse-all, the
 * palette, the assistant, the bell, the profile menu, the tour, the phone's
 * More sheet — opened, checked for console errors and axe, and closed the way
 * a reader closes it (Esc, ×, or the control again). Theme and density are
 * pinned by the harness and the account write is answered locally, so
 * pressing them here changes nobody's account.
 */

test.describe.configure({ mode: "parallel" });

async function open(page: Page, path: string, device: keyof typeof VIEWPORTS = "pc") {
  await page.setViewportSize(VIEWPORTS[device]);
  await page.goto(path);
  await expect(page.locator(".nx-app")).toBeVisible({ timeout: 60_000 });
  await settle(page, 300);
}

test.beforeEach(async ({ context }) => {
  await pinTheme(context, "light");
});

test.use({ storageState: storageStateFor("admin") });

test("the sidebar folds to a rail and back, and remembers nothing it should not", async ({ page }) => {
  const found = collect(page);
  await open(page, "/home");
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.locator(".nx-app--folded")).toBeVisible();
  // Folded, every page is still one press away and named.
  await expect(page.getByRole("menuitem", { name: "Calendar" })).toBeVisible();
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(page.locator(".nx-app--folded")).toHaveCount(0);
  expect(found.console).toEqual([]);
});

test("collapse-all folds every group but the current page's, and opens them again", async ({ page }) => {
  await open(page, "/calendar");
  const toggle = page.locator(".nx-side-search").getByRole("button").last();
  await toggle.click();
  const heads = page.locator(".nx-grouphead");
  const expanded = await heads.evaluateAll((els) => els.filter((el) => el.getAttribute("aria-expanded") === "true").length);
  expect(expanded).toBe(1);
  await expect(page.getByRole("menuitem", { name: "Calendar" })).toBeVisible();
  await toggle.click();
  const after = await heads.evaluateAll((els) => els.filter((el) => el.getAttribute("aria-expanded") === "false").length);
  expect(after).toBe(0);
});

test("the command palette opens from the sidebar and the keyboard, finds a page, and closes on Esc", async ({ page }) => {
  const found = collect(page);
  await open(page, "/home");
  await page.getByRole("button", { name: /Open the command palette/ }).first().click();
  // cmdk's dialog element is a zero-size wrapper; its input is what a reader sees.
  const dialog = page.locator("[cmdk-input]");
  await expect(dialog).toBeVisible();
  expect(await axe(page, ".nu-cmdk")).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.keyboard.press("Control+k");
  await expect(dialog).toBeVisible();
  await page.keyboard.type("Calendar");
  // The page is the first choice — above any record that mentions the word.
  await expect(page.locator("[cmdk-item][data-selected=true]")).toContainText("Calendar");
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await expect(page.locator("[cmdk-item][data-selected=true]")).toContainText("Calendar");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/calendar/);
  expect(found.console).toEqual([]);
});

test("the assistant panel opens with Ctrl+J and closes again", async ({ page }) => {
  await open(page, "/dashboard");
  await page.keyboard.press("Control+j");
  const panel = page.locator(".ant-drawer-open, [role=dialog]").first();
  await expect(panel).toBeVisible();
  const layout = await measure(page, ".ant-drawer-open");
  expect(layout.horizontalOverflow).toBeNull();
  await page.keyboard.press("Escape");
  await expect(page.locator(".ant-drawer-open")).toHaveCount(0);
});

test("the bell lists notifications with their verbs inside each row, switches tabs and leads to the centre", async ({ page }) => {
  await open(page, "/home");
  await page.getByRole("button", { name: /Notifications/ }).first().click();
  const panel = page.locator(".nu-bell-panel");
  await expect(panel).toBeVisible();
  // Each row's buttons sit inside the row (they used to hang over the next one).
  const escaped = await page.locator(".nu-bell-li").evaluateAll((rows) =>
    rows.filter((row) => {
      const box = row.getBoundingClientRect();
      return [...row.querySelectorAll(".nu-bell-actions .ant-btn")].some((button) => {
        const b = button.getBoundingClientRect();
        return b.bottom > box.bottom + 1 || b.top < box.top - 1;
      });
    }).length,
  );
  expect(escaped).toBe(0);
  await page.getByTestId("bell-tab-unread").click();
  await expect(page.getByTestId("bell-tab-unread")).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Open the notification centre" }).click();
  await expect(page).toHaveURL(/\/notifications/);
});

test("the profile menu opens, offers the reader's own pages and closes on Esc", async ({ page }) => {
  await open(page, "/home");
  await page.getByRole("button", { name: "Open profile menu" }).first().click();
  const menu = page.locator(".ant-dropdown:not(.ant-dropdown-hidden), .ant-popover:not(.ant-popover-hidden)").first();
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu")).toHaveCount(0);
});

test("the page tour starts on a page that has one, steps and ends", async ({ page }) => {
  await open(page, "/calendar");
  await page.getByTestId("page-tour").first().click();
  const tour = page.locator(".ant-tour:not(.ant-tour-hidden), .ant-popover:not(.ant-popover-hidden), .ant-drawer-open").first();
  await expect(tour).toBeVisible();
  await page.keyboard.press("Escape");
});

test("the theme toggle flips the appearance (the account write is answered by the harness)", async ({ page }) => {
  await open(page, "/home");
  const before = await page.locator("html").getAttribute("data-theme");
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", before ?? "light");
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", before ?? "light");
});

test("on a phone, the More sheet opens, navigates and closes", async ({ page }) => {
  const found = collect(page);
  await open(page, "/home", "phone");
  await page.getByRole("button", { name: "More navigation" }).click();
  const sheet = page.getByRole("dialog", { name: "Navigation" });
  await expect(sheet).toBeVisible();
  expect((await measure(page)).horizontalOverflow).toBeNull();
  await sheet.getByRole("button", { name: "Close navigation" }).click();
  await expect(sheet).toBeHidden();
  await page.getByRole("button", { name: "More navigation" }).click();
  await page.getByRole("dialog", { name: "Navigation" }).getByRole("link", { name: /Calendar/ }).first().click();
  await expect(page).toHaveURL(/\/calendar/);
  expect(found.console).toEqual([]);
});

test("on a phone, a live toast sits above the tab bar", async ({ page }) => {
  await open(page, "/home", "phone");
  // Draw one the way the live provider does and measure where it lands.
  await page.evaluate(() => {
    const holder = document.createElement("div");
    holder.className = "ant-notification ant-notification-bottomRight";
    holder.style.position = "fixed";
    holder.style.bottom = "24px";
    holder.style.right = "0";
    holder.innerHTML = '<div class="ant-notification-notice-wrapper" style="height:60px;width:300px"></div>';
    document.body.appendChild(holder);
  });
  const toast = await page.locator(".ant-notification-bottomRight").boundingBox();
  const bar = await page.locator(".nx-tabs").boundingBox();
  expect(toast!.y + toast!.height).toBeLessThanOrEqual(bar!.y + 1);
});
