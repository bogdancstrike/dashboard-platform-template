import { expect, test, type Page } from "@playwright/test";

import { signIn, storageStateFor, type Persona } from "./auth";

/**
 * The five personas, and what each one is offered (§58, §76).
 *
 * Every other spec checks one persona's refusal in passing. What none of them
 * checked is the *matrix*: that each of the five signs in, sees the navigation
 * their role allows, and does not see the rest. A role's permission list is
 * only as good as the interface that reads it, and the interface is only
 * checkable by signing in as all five.
 *
 * The claims are deliberately about **what is absent**. A page a role cannot
 * open is a page the navigation must not offer — a menu item that leads to a
 * refusal teaches a reader to distrust the menu, which is worse than not
 * listing it (§76). And the one page each persona is genuinely refused is
 * asked for by address, because the navigation is a courtesy and the server is
 * the enforcement.
 */

/** The sidebar, as a set of the group headings and item labels it shows. */
async function navigation(page: Page): Promise<string[]> {
  const items = page.locator("aside [role='menuitem'], aside .nu-nav-group-label");
  await expect(items.first()).toBeVisible();
  return (await items.allInnerTexts()).map((text) => text.split("\n")[0]!.trim());
}

interface Expectation {
  persona: Persona;
  /** Items this role must be offered. */
  offered: string[];
  /** Items this role must not be offered, because it cannot open them. */
  withheld: string[];
  /** A page it is refused, asked for by address, and the permission named. */
  refused: { path: string; permission: string } | null;
}

const EXPECTATIONS: Expectation[] = [
  {
    persona: "admin",
    offered: ["Home", "Tasks", "Tickets", "Users", "Roles & permissions", "Feature flags"],
    withheld: [],
    refused: null,
  },
  {
    persona: "manager",
    offered: ["Tasks", "Workflows", "Audit log", "Users", "Report builder"],
    // A manager runs the operation and does not hold the keys to the platform
    // itself: roles, flags, integrations and settings are the administrator's.
    withheld: ["Roles & permissions", "Feature flags", "Integrations", "API clients"],
    refused: { path: "/admin/roles", permission: "roles.manage" },
  },
  {
    persona: "operator",
    offered: ["Tasks", "Tickets", "Calendar", "Files", "Mail"],
    withheld: ["Workflows", "Audit log", "Roles & permissions", "Report builder"],
    refused: { path: "/admin/audit", permission: "audit.view" },
  },
  {
    persona: "analyst",
    // Reads, never writes: dashboards, reports and the audit trail.
    offered: ["Analytics", "Reports", "Report builder", "Audit log", "Data Explorer"],
    withheld: ["Workflows", "Roles & permissions", "Integrations"],
    refused: { path: "/admin/integrations", permission: "integrations.manage" },
  },
  {
    persona: "viewer",
    // `Users` is deliberately here: a read-only reader may look a colleague
    // up — `VIEWER` holds `users.view`, and the directory offers them no way
    // to change anything (asserted in `users.spec`).
    offered: ["Home", "Tasks", "Tickets", "Files", "Calendar", "Users"],
    withheld: ["Audit log", "Roles & permissions", "Workflows", "Report builder", "Feature flags"],
    refused: { path: "/admin/audit", permission: "audit.view" },
  },
];

for (const expectation of EXPECTATIONS) {
  test.describe(`the ${expectation.persona}`, () => {
    test.use({ storageState: storageStateFor(expectation.persona) });

    test("is offered the navigation their role allows, and no more", async ({ page }) => {
      await signIn(page, expectation.persona, "/home");
      const shown = await navigation(page);

      for (const label of expectation.offered) {
        expect(shown, `${expectation.persona} should be offered ${label}`).toContain(label);
      }
      for (const label of expectation.withheld) {
        expect(shown, `${expectation.persona} should not be offered ${label}`).not.toContain(
          label,
        );
      }
    });

    if (expectation.refused) {
      const { path, permission } = expectation.refused;
      test(`is refused ${path} by address, and told which permission is missing`, async ({
        page,
      }) => {
        await signIn(page, expectation.persona, path);

        // The navigation is a courtesy; this is the enforcement. And the
        // refusal names the permission in words rather than showing an empty
        // page (§34, §76).
        await expect(page.locator("#nu-main")).toContainText(/not have|permission/i);
        await expect(page.locator("#nu-main")).toContainText(permission);
      });
    }
  });
}

test.describe("a filtered address means the same thing to everyone (§69)", () => {
  test.use({ storageState: storageStateFor("manager") });

  test("a list URL pasted to a colleague shows them the same view", async ({ page, browser }) => {
    await signIn(page, "manager", "/tickets?f.severity=CRITICAL&sort=created_at&order=asc");
    const mine = await page.getByTestId("entity-total").innerText();
    const address = page.url();

    const other = await browser.newContext({ storageState: storageStateFor("viewer") });
    const colleague = await other.newPage();
    await signIn(colleague, "viewer", address.replace(/^https?:\/\/[^/]+/, ""));

    // The same question, the same rows: the state is in the URL rather than in
    // one browser's memory, which is what makes "look at this" work at all.
    await expect(colleague.getByTestId("entity-total")).toHaveText(mine);
    await expect(colleague).toHaveURL(/f\.severity=CRITICAL/);
    await other.close();
  });
});
