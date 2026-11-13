import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import App from "@/App";
import { classified } from "@/pages/showcase/templates";
import { renderWithProviders } from "@/test/render";
import { restoreViewport, viewport, type WIDTHS } from "@/test/viewport";

/**
 * Every page, on the devices the design draws (§3).
 *
 * The page tests are written at desk width — jsdom's default — so every
 * branch a page takes for a phone or a tablet (cards for a table, a sheet for
 * a side panel, chips for a rail) went unexercised, and a phone layout that
 * throws on mount would reach a phone before it reached a test. This renders
 * each route through the real router and shell at a device width and asks the
 * two things that hold for every page: it draws its header, and nothing broke.
 *
 * Split across several files by `shard` so the routes render in parallel.
 */
const ROUTES = classified().filter(
  (route) =>
    // Redirects land somewhere else, which the route-table test covers.
    !["system", "search", "search/saved"].includes(route) &&
    // Problem pages are device-independent copy.
    !route.startsWith("errors/"),
);

export function devicePages(device: keyof typeof WIDTHS, shard: number, of: number): void {
  const mine = ROUTES.filter((_, index) => index % of === shard);
  afterEach(restoreViewport);

  describe(`every page on a ${device} (${shard + 1} of ${of})`, () => {
    it.each(mine)(`/%s`, async (route) => {
      viewport(device);
      renderWithProviders(<App />, { route: `/${route}` });
      await waitFor(
        () => {
          // A skeleton in a closed drawer or modal is not on screen.
          const loading = [...document.querySelectorAll(".ant-skeleton")].filter(
            (node) => !node.closest(".ant-drawer, .ant-modal-root"),
          );
          expect(loading).toEqual([]);
          expect(document.querySelector("h1")).not.toBeNull();
        },
        { timeout: 15_000 },
      );
      expect(screen.queryByText("Something broke on this page")).not.toBeInTheDocument();
    });
  });
}
