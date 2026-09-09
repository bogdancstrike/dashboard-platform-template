import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { signIn, type Persona } from "./auth";

/**
 * The guided tour actually works, stop by stop (§77).
 *
 * `docs/WALKTHROUGH.md` is the answer to "a developer who has never seen this
 * repository opens it and finds a working example of each of eighteen
 * capabilities". A document that sends that person to a page which is empty,
 * refused or gone is worse than no document — they conclude the template is
 * broken, and they are not wrong.
 *
 * So the tour is walked. Each stop is visited **as the persona the document
 * names**, because that is the instruction a reader follows, and each has to
 * show the thing it promises: not that the shell rendered, but that the page's
 * own content is there. The personas matter — the tour deliberately sends the
 * reader through five different views of the platform, and a stop that only
 * works as the administrator is a stop that lies.
 *
 * The stops are declared here with their proof, and asserted to be *exactly*
 * the stops the document lists. Two files, one list: the script that renders
 * the document checks the routes against the router, this checks the pages
 * against the browser, and neither can drift from the other without failing.
 */

/**
 * The username the document names, mapped to the fixture that signs in as it.
 *
 * The document says what a reader types — the demo account is `user` — and the
 * fixtures key on the *role*, which is `viewer`. One of the two has to be
 * translated somewhere, and it is better here than in the sentence a person
 * follows.
 */
const PERSONA_KEYS: Record<string, Persona> = {
  admin: "admin",
  manager: "manager",
  operator: "operator",
  analyst: "analyst",
  user: "viewer",
};

/** Where the tour goes, and what proves the stop worked. */
const STOPS: { route: string; persona: string; proof: string }[] = [
  { route: "/dashboard", persona: "admin", proof: ".nu-chartcard" },
  { route: "/orders", persona: "manager", proof: "[data-testid='entity-total']" },
  { route: "/tickets", persona: "operator", proof: "[data-testid='ticket-queue']" },
  { route: "/find/global?q=migration", persona: "analyst", proof: "[data-testid='global-total']" },
  { route: "/explore", persona: "analyst", proof: "[data-testid='explorer-match-count']" },
  { route: "/reports", persona: "analyst", proof: "[data-testid='reports']" },
  { route: "/mail", persona: "manager", proof: "[data-testid='mail-list']" },
  { route: "/tasks", persona: "operator", proof: "[data-testid='task-board']" },
  { route: "/files", persona: "manager", proof: "[data-testid='file-list']" },
  { route: "/notifications", persona: "admin", proof: "[data-testid='notification-row']" },
  { route: "/import", persona: "manager", proof: "[data-testid='import-start']" },
  { route: "/settings/security", persona: "user", proof: "[data-testid='security-headline']" },
  { route: "/admin", persona: "admin", proof: "[data-testid='admin-map']" },
  { route: "/admin/audit", persona: "admin", proof: "[data-testid='audit-total']" },
  { route: "/admin/jobs", persona: "admin", proof: "[data-testid='jobs-table']" },
  { route: "/admin/quality", persona: "admin", proof: "[data-testid='quality-datasets']" },
  { route: "/showcase/components", persona: "admin", proof: "[data-testid='missing-table']" },
  { route: "/tickets", persona: "manager", proof: "[data-testid='ticket-queue']" },
];

/** The stops as the document lists them: `| 3 | Title | \`/route\` | \`operator\` |`. */
function documented(): { route: string; persona: string }[] {
  const source = readFileSync(join(process.cwd(), "..", "docs/WALKTHROUGH.md"), "utf8");
  return [...source.matchAll(/^\| \d+ \| .+ \| `([^`]+)` \| `([^`]+)` \|$/gm)].map((match) => ({
    route: match[1]!,
    persona: match[2]!,
  }));
}

test("the document and this test walk the same tour", () => {
  const listed = documented();
  // Found at all, rather than passing by matching nothing — the failure a
  // regex-over-markdown check has.
  expect(listed.length).toBeGreaterThan(10);
  expect(listed).toEqual(STOPS.map(({ route, persona }) => ({ route, persona })));
});

for (const [index, stop] of STOPS.entries()) {
  test(`stop ${index + 1}: ${stop.route} works as ${stop.persona}`, async ({ page }) => {
    await signIn(page, PERSONA_KEYS[stop.persona], stop.route);

    // The page's own content, not the shell around it: a header renders
    // whether or not the query behind it answered.
    await expect(page.locator(stop.proof).first()).toBeVisible();
    // And nothing on the way in was refused or broken — the two states a
    // reader following a document cannot act on.
    await expect(page.getByTestId("failure-alert")).toHaveCount(0);
  });
}

/**
 * The second half of §77: it reads as one application.
 *
 * "A working example of each capability" is satisfiable by eighteen
 * disconnected demos, which is exactly what this is not supposed to be. The
 * claim is the *links*: a ticket knows which account raised it, that account
 * is a record with its own page, and one search box finds it across every
 * dataset at once. So the thread is walked with the mouse, hop by hop, and
 * every hop has to land on real seeded data.
 */
test("one thread runs from a ticket to its account and out across the datasets", async ({
  page,
}) => {
  await signIn(page, "manager", "/tickets");

  // A ticket filed against somebody — the seed leaves a few filed against
  // nobody on purpose, and the console says so rather than drawing a blank
  // card, so the walk tries the next row instead of asserting on that.
  let account = page.locator("nothing");
  for (let row = 0; row < 5; row += 1) {
    await page.goto("/tickets");
    const queue = page.locator("[data-testid='ticket-queue'] tbody tr[data-row-key]");
    await expect(queue.first()).toBeVisible();
    await queue.nth(row).click();
    await page.waitForURL(/\/tickets\/[0-9a-f-]{36}/);
    // The clock first, which is the console's own claim.
    await expect(page.getByTestId("sla-standing")).toBeVisible();

    account = page.getByTestId("ticket-account").getByRole("link", { name: "Open" });
    if ((await account.count()) > 0) break;
  }
  await expect(account).toBeVisible();

  // Hop two: the account, as a record with its own page.
  await account.click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}/);
  // The name only: the page title carries the record's status tag beside it,
  // and searching for "Vanguard SystemsACTIVE" finds nothing at all.
  const heading = page.locator(".nu-page-title").first();
  await expect(heading).toBeVisible();
  const customer = await heading.evaluate(
    (node) =>
      [...node.childNodes]
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent ?? "")
        .join("")
        .trim(),
  );
  expect(customer.length).toBeGreaterThan(2);

  // Hop three: one box, every dataset. The account's name reaches the records
  // that mention it wherever they live — which is the claim that the eighteen
  // stops are views of one dataset rather than eighteen demos.
  await page.goto(`/find/global?q=${encodeURIComponent(customer)}`);
  await expect(page.getByTestId("global-total")).toBeVisible();
  const hits = page.getByTestId("global-hit");
  await expect(hits.first()).toBeVisible();
  expect(await hits.count()).toBeGreaterThan(0);

  // Hop four: a hit is a record, and opening one lands on its own page.
  await hits.first().click();
  await expect(page).toHaveURL(/\/(tickets|customers|orders|projects|tasks|devices|explore)/);
  await expect(page.getByTestId("failure-alert")).toHaveCount(0);
});
