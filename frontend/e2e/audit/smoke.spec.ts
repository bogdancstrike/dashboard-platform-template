import { expect, test } from "@playwright/test";

import { storageStateFor } from "../auth";
import { axe, collect, measure, pinTheme, settle, VIEWPORTS, type Device, type Theme } from "./probe";
import { resolve, ROUTES } from "./routes";

/**
 * One smoke test per page audit A owns, on a desk and on a phone (§audit A).
 *
 * Each asserts the four things the crawl found most often and a reader
 * notices first: nothing in the console, nothing failing on the network,
 * nothing wider than the screen, and nothing axe can name. The geometry the
 * crawl also measures (clipped text, overlaps, corners) is reported there
 * rather than gated here, because a pixel-level heuristic that fails a build
 * is one that gets deleted.
 */

test.describe.configure({ mode: "parallel" });

const CASES: { device: Device; theme: Theme }[] = [
  { device: "pc", theme: "light" },
  { device: "phone", theme: "dark" },
];

for (const route of ROUTES) {
  for (const { device, theme } of CASES) {
    test(`${route.name} on ${device} in ${theme} is clean`, async ({ browser }) => {
      const context = await browser.newContext({
        storageState: storageStateFor("admin"),
        viewport: VIEWPORTS[device],
        colorScheme: theme,
        hasTouch: device === "phone",
      });
      await pinTheme(context, theme);
      const page = await context.newPage();
      const found = collect(page);
      const path = await resolve(page, route);
      test.skip(!path, `no ${route.name} record in this database`);
      found.console.length = 0;
      found.requests.length = 0;

      await page.goto(path!);
      await expect(page.locator(".nx-app")).toBeVisible({ timeout: 60_000 });
      await settle(page, 600);

      const layout = await measure(page);
      expect.soft(layout.horizontalOverflow, "horizontal overflow").toBeNull();
      expect.soft(await axe(page), "axe").toEqual([]);
      expect.soft(found.console, "console").toEqual([]);
      expect.soft(found.requests, "failed requests").toEqual([]);
      await context.close();
    });
  }
}
