import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { apiAs, endpoint, namespaced } from "./api";
import { signIn, storageStateFor, type Persona } from "./auth";

/**
 * Favourites and recents against the real stack (§38, §39).
 *
 * The claim only the whole stack can make, and the one this feature exists
 * for: **starring a saved search puts it on the favourites page.** The
 * saved-search drawer's own tooltip has said "Add to favourites" all along
 * while writing a boolean column, and `favorites` — a table whose docstring
 * reads "a bookmark on anything addressable" — had no service at all. So a
 * reader could star a search, be told where it went, and find nothing there.
 * Two stores for one fact, and the one people would act on was whichever they
 * had not looked at.
 *
 * A component test cannot show it: it takes the *search* endpoint writing and
 * the *favourites* endpoint reading, against one database.
 *
 * Plus: that a bookmark's address actually opens the thing — which is how the
 * `/search/saved/:id` redirect was caught dropping the id it was given, so
 * every bookmarked search opened an empty explorer.
 */

test.describe.configure({ mode: "serial" });

/** The analyst throughout: these are personal lists, and any persona has them. */
test.use({ storageState: storageStateFor("analyst") });

const OWNER: Persona = "analyst";

/** `/favorites` and `/recents` live beside `/notifications`. */
function favorites(path = ""): string {
  return namespaced(`/favorites${path}`);
}

function recents(path = ""): string {
  return namespaced(`/recents${path}`);
}

/** A label only this suite writes, so its rows can be found and removed. */
const MARK = "E2E Favourite";

async function mine() {
  const api = await apiAs(OWNER);
  return (await (await api.get(favorites())).json()) as {
    items: Array<Record<string, unknown>>;
    total: number;
    kinds: Array<{ key: string; count: number }>;
  };
}

/** Remove every bookmark this suite made, whatever it pointed at. */
async function sweep(): Promise<void> {
  const api = await apiAs(OWNER);
  const listing = await mine();
  for (const row of listing.items) {
    if (String(row["label"]).startsWith(MARK)) {
      await api.delete(favorites(`/${String(row["id"])}`));
    }
  }
}

test("starring a saved search puts it on the favourites page", async () => {
  const api = await apiAs(OWNER);
  const made = await api.post(endpoint("/saved-searches"), {
    data: { name: `${MARK} search`, resource_type: "ticket", is_favorite: true },
  });
  expect(made.status(), await made.text()).toBe(201);
  const search = (await made.json()) as { id: string; is_favorite: boolean };

  try {
    expect(search.is_favorite).toBe(true);

    // The *favourites* endpoint, which is the list a reader opens — and which
    // the old design could not put a search on at all.
    const listing = await mine();
    const found = listing.items.find((row) => row["resource_id"] === search.id);
    expect(found, "a starred saved search is not on the favourites page").toBeTruthy();
    expect(found!["resource_type"]).toBe("saved_search");
    // The address that actually serves one.
    expect(found!["url"]).toBe(`/search/saved/${search.id}`);
  } finally {
    await api.delete(endpoint(`/saved-searches/${search.id}`));
    await sweep();
  }
});

test("unstarring it takes it off again", async () => {
  const api = await apiAs(OWNER);
  const search = (await (
    await api.post(endpoint("/saved-searches"), {
      data: { name: `${MARK} toggled`, resource_type: "ticket", is_favorite: true },
    })
  ).json()) as { id: string };

  try {
    expect((await mine()).items.some((row) => row["resource_id"] === search.id)).toBe(true);
    await api.put(endpoint(`/saved-searches/${search.id}`), {
      data: { is_favorite: false },
    });
    expect((await mine()).items.some((row) => row["resource_id"] === search.id)).toBe(false);
  } finally {
    await api.delete(endpoint(`/saved-searches/${search.id}`));
    await sweep();
  }
});

test("a star is one person's, not the shared search's", async () => {
  // Which a column on the search cannot express. The old design starred a
  // shared search for everybody who could see it.
  const api = await apiAs(OWNER);
  const search = (await (
    await api.post(endpoint("/saved-searches"), {
      data: { name: `${MARK} shared`, resource_type: "ticket", scope: "PUBLIC" },
    })
  ).json()) as { id: string };

  try {
    await api.put(endpoint(`/saved-searches/${search.id}`), { data: { is_favorite: true } });

    const other = await apiAs("manager");
    const theirs = await other.get(endpoint(`/saved-searches/${search.id}`));
    expect(theirs.status()).toBe(200);
    expect((await theirs.json()).is_favorite).toBe(false);

    const theirList = await (await other.get(favorites())).json();
    expect(
      (theirList.items as Array<Record<string, unknown>>).some(
        (row) => row["resource_id"] === search.id,
      ),
    ).toBe(false);
  } finally {
    await api.delete(endpoint(`/saved-searches/${search.id}`));
    await sweep();
  }
});

test("a bookmarked saved search opens that search, not an empty explorer", async ({
  page,
}) => {
  // How the `/search/saved/:id` redirect was caught discarding the id it was
  // given: the route existed, answered, and threw away what it was for.
  const api = await apiAs(OWNER);
  const search = (await (
    await api.post(endpoint("/saved-searches"), {
      data: {
        name: `${MARK} openable`,
        resource_type: "ticket",
        filters: { status: "OPEN" },
        is_favorite: true,
      },
    })
  ).json()) as { id: string };

  try {
    await signIn(page, OWNER, `/search/saved/${search.id}`);
    // The id survives the redirect and the explorer loads the search from it.
    await expect(page).toHaveURL(new RegExp(`saved=${search.id}`));
    await expect(page).toHaveURL(/resource=ticket/);
    // And the question is restored, not merely the page.
    await expect(page).toHaveURL(/f\.status=OPEN/);
  } finally {
    await api.delete(endpoint(`/saved-searches/${search.id}`));
    await sweep();
  }
});

test("no seeded bookmark points at something the platform cannot bookmark", async () => {
  // Asked of the installation: a favourite naming a type nothing addresses is
  // a row the page has to apologise for.
  const api = await apiAs("admin");
  const listing = await (await api.get(favorites())).json();
  const allowed = new Set(listing.bookmarkable as string[]);
  const wrong = (listing.items as Array<Record<string, unknown>>)
    .filter((row) => !allowed.has(String(row["resource_type"])))
    .map((row) => row["label"]);
  expect(wrong).toEqual([]);
});

test("every seeded bookmark carries an in-app address", async () => {
  const api = await apiAs("admin");
  const listing = await (await api.get(favorites())).json();
  const outside = (listing.items as Array<Record<string, unknown>>)
    .filter((row) => !String(row["url"]).startsWith("/"))
    .map((row) => row["url"]);
  // A "favourite" that navigated off the platform would be a link nobody
  // expects (§76).
  expect(outside).toEqual([]);
});

test("a visit is counted rather than appended", async () => {
  const api = await apiAs(OWNER);
  const body = {
    resource_type: "ticket",
    resource_id: "e2e-visit-target",
    label: `${MARK} visited`,
    url: "/tickets/e2e-visit-target",
  };

  await api.post(recents(), { data: body });
  const after = await (await api.post(recents(), { data: body })).json();
  const found = (after.items as Array<Record<string, unknown>>).filter(
    (row) => row["resource_id"] === "e2e-visit-target",
  );
  // Upserted on the table's own unique constraint, so a place somebody works
  // accumulates a count rather than fifty rows.
  expect(found.length).toBe(1);
  expect(Number(found[0]!["visit_count"])).toBeGreaterThanOrEqual(2);
});

test("the page keeps the two lists apart and can rearrange the kept one", async ({
  page,
}) => {
  const api = await apiAs(OWNER);
  // Two bookmarks of this suite's own, so the order it changes is its own.
  for (const suffix of ["alpha", "beta"]) {
    await api.post(favorites(), {
      data: {
        resource_type: "ticket",
        resource_id: `e2e-order-${suffix}`,
        label: `${MARK} ${suffix}`,
        url: `/tickets/e2e-order-${suffix}`,
      },
    });
  }

  try {
    await signIn(page, OWNER, "/favorites");
    await expect(page.getByTestId("bookmarks-table")).toBeVisible();
    await expect(page.getByTestId("recents-table")).toBeVisible();
    // Two lists, not one: a decision must not read as a by-product.
    await expect(page.getByTestId("bookmarks-card")).toContainText("Kept");
    await expect(page.getByTestId("recents-card")).toContainText("Looked at lately");

    const listing = await mine();
    const alpha = listing.items.find((row) => row["label"] === `${MARK} alpha`)!;
    const beta = listing.items.find((row) => row["label"] === `${MARK} beta`)!;
    expect(Number(alpha["position"])).toBeLessThan(Number(beta["position"]));

    // Moved through the page's own control, which is a button rather than a
    // drag because a keyboard-only reader cannot drag (§65).
    await page.getByTestId(`up-${String(beta["id"])}`).click();
    await expect
      .poll(async () => {
        const after = await mine();
        const one = after.items.find((row) => row["label"] === `${MARK} beta`)!;
        const two = after.items.find((row) => row["label"] === `${MARK} alpha`)!;
        return Number(one["position"]) < Number(two["position"]);
      })
      .toBe(true);
  } finally {
    await sweep();
  }
});

test("the kept list offers no way to sort itself", async ({ page }) => {
  await signIn(page, OWNER, "/favorites");
  await expect(page.getByTestId("bookmarks-table")).toBeVisible();
  // The order *is* the information, so "sort by name" would invite somebody
  // to destroy the arrangement they made.
  await expect(
    page.getByTestId("bookmarks-table").locator("th.ant-table-column-has-sorters"),
  ).toHaveCount(0);
});

test.describe("what the least-privileged persona is offered", () => {
  test.use({ storageState: storageStateFor("viewer") });

  test("both lists, because they are their own", async ({ page }) => {
    await signIn(page, "viewer", "/favorites");
    await expect(page.getByTestId("bookmarks-table")).toBeVisible();
    await expect(page.getByTestId("recents-table")).toBeVisible();

    const api = await apiAs("viewer");
    expect((await api.get(favorites())).status()).toBe(200);
    expect((await api.get(recents())).status()).toBe(200);
  });
});

test("the page is legible and keyboard-reachable", async ({ page }) => {
  await signIn(page, OWNER, "/favorites");
  await expect(page.getByTestId("bookmarks-table")).toBeVisible();
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
