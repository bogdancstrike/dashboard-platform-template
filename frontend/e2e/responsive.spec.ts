import { expect, test, type Page } from "@playwright/test";

import { signIn, storageStateFor } from "./auth";

/**
 * The four breakpoints, on the pages a reader spends the day in (§56).
 *
 * §56 shipped as four breakpoints, a collapsing sidebar, a mobile drawer and
 * tables that scroll — and *one* page asserted at mobile width, in a spec
 * about a preview drawer. One page is not a responsive layout: the failure
 * mode of a breakpoint is a single screen that overflows, and it is invisible
 * on every other screen.
 *
 * Two claims per page, both of which only a browser can make:
 *
 * **Nothing overflows sideways.** A page whose body is wider than the window
 * is a page a phone scrolls left and right to read — and on a laptop it is the
 * table pushing the layout, which is the defect `scroll.x` exists to prevent.
 *
 * **The navigation is a drawer below `lg`, and a rail above it.** 240px of a
 * 1024px screen is a quarter of the width spent on a menu nobody is reading.
 */

test.use({ storageState: storageStateFor("admin") });

/** The widths that matter, named as §56 names them. */
const WIDTHS = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  laptop: { width: 1280, height: 800 },
} as const;

/** The pages with the widest content — a board, three tables and a grid. */
const PAGES = ["/home", "/tasks", "/tickets", "/orders", "/customers", "/admin/users"];

/**
 * How far the page can be dragged sideways, in pixels.
 *
 * The *content area* rather than the document, and that distinction is the
 * whole assertion: `.nu-content` carries `overflow-x: auto` so that a wide
 * table cannot stretch the shell, which means the document never scrolls and
 * a reader on a phone is dragging the content pane instead. Measuring the
 * document reported zero for a strip 1600px wide — a page that overflows in
 * every way that matters and in none this could see.
 *
 * A table's own scroller is deliberate and does not count: it is inside the
 * content area, so it never widens it.
 */
async function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const content = document.querySelector(".nu-content");
    const document_overflow = Math.max(0, root.scrollWidth - root.clientWidth);
    const content_overflow = content
      ? Math.max(0, content.scrollWidth - content.clientWidth)
      : 0;
    return Math.max(document_overflow, content_overflow);
  });
}

async function settle(page: Page): Promise<void> {
  await expect(page.locator("#nu-main")).toBeVisible();
  await page
    .waitForFunction(
      () => document.getAnimations().every((animation) => animation.playState !== "running"),
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => undefined);
}

for (const [name, size] of Object.entries(WIDTHS)) {
  test(`no page scrolls sideways at ${name} width`, async ({ page }) => {
    await page.setViewportSize(size);
    await signIn(page, "admin", "/home");

    const overflowing: string[] = [];
    for (const path of PAGES) {
      // `signIn` rather than `goto`: a navigation inside a long loop can land
      // on a silent Keycloak round trip — the SSO session having been revoked
      // by `security.spec`, or a token having aged out — and a bare `goto`
      // then waits for `#nu-main` while the browser is still at the identity
      // provider. `signIn` knows about all three outcomes and has the budget
      // for them.
      await signIn(page, "admin", path);
      await settle(page);
      const overflow = await sidewaysOverflow(page);
      // A pixel or two is a scrollbar's rounding; a table pushing the layout
      // is tens or hundreds.
      if (overflow > 2) overflowing.push(`${path} by ${overflow}px`);
    }
    expect(overflowing).toEqual([]);
  });
}

test("the sidebar is a drawer on a phone and a rail on a laptop", async ({ page }) => {
  await page.setViewportSize(WIDTHS.mobile);
  await signIn(page, "admin", "/tasks");

  // Below `lg`: no rail, and a control that opens one.
  const rail = page.locator("aside.nu-sider");
  await expect(rail).not.toBeInViewport();
  const opener = page.getByRole("button", { name: "Open navigation" });
  await expect(opener).toBeVisible();

  await opener.click();
  await expect(rail).toBeInViewport();
  // Choosing a destination closes it: leaving a drawer open over the page
  // somebody just navigated to is the classic drawer bug.
  await page.getByRole("menuitem", { name: /Tickets/ }).click();
  await expect(page).toHaveURL(/\/tickets/);
  await expect(rail).not.toBeInViewport();

  // Above `lg` the drawer control is gone and the rail is simply there.
  await page.setViewportSize(WIDTHS.laptop);
  await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
  await expect(rail).toBeInViewport();
});

test("a phone gets controls a thumb can hit, whatever density was chosen", async ({ page }) => {
  await page.setViewportSize(WIDTHS.mobile);
  await signIn(page, "admin", "/tasks");
  await settle(page);

  // Whatever the reader chose — and this suite's other specs change it — the
  // rendered density below the mobile breakpoint is never `compact`, which is
  // the *mouse* setting: 28px controls and 21px small buttons.
  await expect(page.locator("html")).not.toHaveAttribute("data-density", "compact");

  const small = await page.evaluate(() =>
    [...document.querySelectorAll("#nu-main button")]
      // Rendered *and* visible: AntD keeps a search box's clear "×" in the
      // DOM with `visibility: hidden`, and a control nobody can see is not a
      // target anybody has to hit.
      .filter((node) => node.checkVisibility({ visibilityProperty: true }))
      .map((node) => node.getBoundingClientRect())
      .filter((box) => box.width > 0 && box.height > 0 && box.height < 24).length,
  );
  // WCAG 2.2's minimum is 24×24 (2.5.8). Buttons only: an inline link inside a
  // sentence is exempt, and shrinking one to hit a target size would break the
  // sentence it lives in.
  expect(small).toBe(0);

  // And the choice survives the trip: whatever the stored preference is, it
  // is what a laptop renders. Read from the page rather than assumed, because
  // `smoke.spec` and `preferences.spec` both change it.
  await page.setViewportSize(WIDTHS.laptop);
  // Stored as a bare string, not as JSON — `AppearanceProvider` writes the
  // value it reads back.
  const chosen = await page.evaluate(
    () => window.localStorage.getItem("nucleus.density") ?? "middle",
  );
  await expect(page.locator("html")).toHaveAttribute("data-density", chosen);
});

test("a wide table scrolls inside itself rather than stretching the page", async ({ page }) => {
  await page.setViewportSize(WIDTHS.mobile);
  await signIn(page, "admin", "/orders");
  await settle(page);

  // `.ant-table-content` and not `.ant-table-body`: AntD splits the header
  // from the body only when a *vertical* scroll is set. With `scroll.x` alone
  // the whole table sits in one horizontal scroller, which is the element
  // under test.
  const body = page.locator(".ant-table-content, .ant-table-body").first();
  await expect(body).toBeVisible();
  const scroll = await body.evaluate((element) => ({
    canScroll: element.scrollWidth > element.clientWidth,
    overflow: getComputedStyle(element).overflowX,
  }));

  // The ledger is 1080px of columns. On a phone it has to scroll *inside its
  // own frame*, with the reference column pinned, rather than making the whole
  // document 1080px wide.
  expect(scroll.canScroll).toBe(true);
  expect(["auto", "scroll"]).toContain(scroll.overflow);
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(2);
  await expect(page.locator(".ant-table-cell-fix-left").first()).toBeVisible();
});
