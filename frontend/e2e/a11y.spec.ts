import { readFileSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signIn, storageStateFor } from "./auth";

/**
 * Every page in the router, audited (§55).
 *
 * Twelve specs audit a page each, and every one of them was added *because*
 * somebody had already shipped a page with a broken contrast or an unnamed
 * control. That is the wrong order, and it leaves the same hole every time: a
 * rule remembered per page covers the pages somebody thought of. Six entity
 * lists went their whole life unaudited, and the first run over them found
 * nine unnamed progress bars.
 *
 * So the route list is not a list. It is read out of `App.tsx`, the same way
 * `showcase/templates.test.ts` reads it — a page added to the router is
 * audited by being in the router, and cannot be forgotten.
 */

test.use({ storageState: storageStateFor("admin") });

/** Every concrete route the router serves — no wildcards, no parameters. */
function routerRoutes(): string[] {
  const source = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
  const found = [
    ...[...source.matchAll(/path="([^"]+)"/g)].map((match) => match[1]!),
    // The six entity pages are declared as data rather than as JSX.
    ...[...source.matchAll(/path:\s*"([^"]+)"/g)].map((match) => match[1]!),
  ];
  return [
    ...new Set(
      found.filter((route) => route !== "*" && !route.includes(":") && route !== ""),
    ),
  ].sort();
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  // A colour sampled mid-transition is a blend of the ink and what is behind
  // it, which axe reports as a contrast failure that no reader ever sees.
  await page
    .waitForFunction(
      () => document.getAnimations().every((animation) => animation.playState !== "running"),
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => undefined);
}

test("every route in the router is axe-clean", async ({ page }) => {
  // Sixty pages in one test rather than sixty tests: one sign-in, and a
  // failure that lists every route at fault instead of the first one.
  test.slow();
  const routes = routerRoutes();
  // If the route table is ever written differently this says so, rather than
  // the audit silently going quiet.
  expect(routes.length).toBeGreaterThan(50);

  await signIn(page, "admin", "/home");
  /**
   * The appearance this measured, named in the failure.
   *
   * One appearance, and deliberately the reader's own rather than a switched
   * one: switching writes the persona's preference (§40), and a spec that
   * leaves a shared persona in the other theme changes what every other
   * spec's audit measures. The other appearance is covered where it belongs —
   * `theme/contrast.test.ts` asserts every ink in the palette against both
   * grounds in *both* modes, in milliseconds, for pages nobody has written
   * yet; and `record-pages.spec` audits a record page in each. What is left
   * to a browser here is the structural half — names, roles, nesting,
   * scrollable regions — and that does not change with the theme.
   */
  const appearance = await page.locator("html").getAttribute("data-theme");
  const offences: Record<string, string[]> = {};

  for (const route of routes) {
    await page.goto(`/${route}`);
    await settle(page);
    const audit = await new AxeBuilder({ page })
      .include("#nu-main")
      // AntD's own zero-height measuring row under `scroll.x`: `aria-hidden`
      // and `tabindex="-1"`, unreachable by tab, and not ours to remove
      // without giving up the sticky columns three tables rely on.
      .exclude(".ant-table-measure-row")
      .analyze();
    const serious = audit.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    );
    if (serious.length) {
      offences[`/${route}`] = serious.map(
        (violation) =>
          `${violation.id} :: ${violation.nodes
            .map((node) => node.target.join(" "))
            .slice(0, 4)
            .join(" | ")}`,
      );
    }
  }

  expect(offences, `audited in the ${appearance} appearance`).toEqual({});
});
