import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { apiAs, namespaced } from "./api";
import { signIn, storageStateFor } from "./auth";
import { chooseOption } from "./query";

/**
 * Groups against the real stack (§11).
 *
 * The claim only a real stack can make, and the reason this page exists in two
 * halves: **a group's permissions reach its members on their next request.** A
 * component test can prove the editor saves; only PostgreSQL, Keycloak and the
 * real `_permissions_for` together can prove that adding somebody to a group
 * changes what they may do — with no re-login and no cache to bust. That is
 * also what makes the privilege split load-bearing rather than tidy, so the
 * second test is the escalation attempt: a manager may put people in groups
 * and may not say what a group grants, or `users.manage` would quietly be
 * worth every permission in the catalogue.
 *
 * Everything this spec creates, it removes.
 */

test.describe.configure({ mode: "serial" });

function rows(page: import("@playwright/test").Page) {
  return page.getByTestId("groups-table").locator("tbody tr[data-row-key]");
}

/** Retire a group by id, whatever happened to the test that made it. */
async function sweep(id: string | null) {
  if (!id) return;
  const api = await apiAs("admin");
  await api.delete(namespaced(`/admin/groups/${id}`));
}

test("the list says what being in each group adds", async ({ page }) => {
  await signIn(page, "admin", "/admin/groups");
  await expect(page.getByTestId("groups-table")).toBeVisible();
  await expect(rows(page).first()).toBeVisible();

  // Named rather than counted: the seeded groups all grant something, and
  // "3 permissions" would not tell anybody what.
  const table = page.getByTestId("groups-table");
  await expect(table).toContainText("On-call");
  await expect(table.locator(".nu-group-grants").first()).not.toHaveText("");
});

test("a group's permissions reach its members on their next request", async ({
  page,
  browser,
}) => {
  // The whole reason this screen is not an org chart.
  const api = await apiAs("admin");
  let groupId: string | null = null;

  try {
    const made = await api.post(namespaced("/admin/groups"), {
      data: { name: `E2E grants ${Date.now()}`, kind: "OPERATIONAL" },
    });
    expect(made.status()).toBe(201);
    groupId = (await made.json()).id as string;

    // The viewer cannot reach the audit ledger.
    const viewerContext = await browser.newContext({
      storageState: storageStateFor("viewer"),
    });
    const viewerPage = await viewerContext.newPage();
    await signIn(viewerPage, "viewer", "/admin/audit");
    await expect(viewerPage.getByText("Permission required")).toBeVisible();

    // Grant `audit.view` through the group, and put them in it — through the
    // page, because that is the path a person takes.
    await signIn(page, "admin", `/admin/groups?group=${groupId}`);
    await expect(page.getByTestId("group-grants")).toBeVisible();
    // Typed first, then chosen: the real catalogue is forty-odd permissions
    // and rc-virtual-list renders only the visible window, so clicking an
    // option by name waits forever for one that was never in the DOM.
    const editor = page.getByRole("combobox", { name: "Permissions" });
    await editor.click();
    await editor.fill("audit.view");
    await chooseOption(page, /audit\.view/);
    await page.keyboard.press("Escape");
    await page.getByTestId("save-grants").click();
    await expect(page.getByText(/now grants audit\.view/)).toBeVisible();

    const viewerId = await api
      .get(namespaced("/admin/users?q=user&page_size=5"))
      .then(async (answer) => {
        const listed = await answer.json();
        const found = (listed.items as Array<{ id: string; username: string }>).find(
          (person) => person.username === "user",
        );
        return found?.id ?? null;
      });
    expect(viewerId, "the seeded viewer was not found").toBeTruthy();

    const joined = await api.put(namespaced(`/admin/groups/${groupId}/members`), {
      data: { user_ids: [viewerId] },
    });
    expect(joined.status()).toBe(200);

    // And now they can read it, without signing in again.
    await viewerPage.reload();
    await expect(viewerPage.getByRole("heading", { name: "Audit log" })).toBeVisible();
    await expect(viewerPage.getByText("Permission required")).toBeHidden();

    // Taking them out takes it away again — the direction a security review
    // asks about.
    await api.put(namespaced(`/admin/groups/${groupId}/members`), { data: { user_ids: [] } });
    await viewerPage.reload();
    await expect(viewerPage.getByText("Permission required")).toBeVisible();

    await viewerContext.close();
  } finally {
    await sweep(groupId);
  }
});

test.describe("what a manager may do", () => {
  test.use({ storageState: storageStateFor("manager") });

  test("membership, and not what a group grants", async ({ page }) => {
    // The escalation boundary. A manager holds `users.manage` and not
    // `roles.manage`; if one covered both, they could add `roles.manage` to a
    // group containing themselves and hold it on their next request.
    const api = await apiAs("manager");
    let groupId: string | null = null;

    try {
      const made = await api.post(namespaced("/admin/groups"), {
        data: { name: `E2E manager ${Date.now()}` },
      });
      expect(made.status(), "a manager may make a group").toBe(201);
      groupId = (await made.json()).id as string;

      await signIn(page, "manager", `/admin/groups?group=${groupId}`);
      await expect(page.getByTestId("group-members")).toBeVisible();

      // The page offers one panel and not the other, with the reason.
      await expect(page.getByTestId("save-members")).toBeVisible();
      await expect(page.getByTestId("save-grants")).toHaveCount(0);
      await expect(page.getByTestId("grants-locked")).toContainText("roles.manage");

      // And the server refuses both routes to it, which is the half that
      // matters: a gate enforced only in the browser is not a gate.
      const direct = await api.put(namespaced(`/admin/groups/${groupId}/grants`), {
        data: { permissions: ["roles.manage"] },
      });
      expect(direct.status()).toBe(403);

      const sneaked = await api.put(namespaced(`/admin/groups/${groupId}`), {
        data: { name: "Still trying", permissions: ["roles.manage"] },
      });
      expect(sneaked.status()).toBe(400);
      expect((await sneaked.json()).message).toContain("roles.manage");

      // The group still grants nothing.
      const read = await (await api.get(namespaced(`/admin/groups/${groupId}`))).json();
      expect(read.permissions).toEqual([]);
    } finally {
      // Swept as the manager, who may remove a group they made.
      if (groupId) {
        const api2 = await apiAs("manager");
        await api2.delete(namespaced(`/admin/groups/${groupId}`));
      }
    }
  });
});

test("a group is made, filled and retired through the page", async ({ page }) => {
  const name = `E2E lifecycle ${Date.now()}`;
  await signIn(page, "admin", "/admin/groups");
  await expect(page.getByTestId("groups-table")).toBeVisible();

  await page.getByTestId("new-group").click();
  // Said before it exists, because a group that arrived granting something
  // would grant it at the moment it was made.
  await expect(page.getByText("It starts granting nothing")).toBeVisible();
  await page.getByLabel("Group name").fill(name);
  await page.getByTestId("create-group").click();

  // Straight into it, because an empty group is not the finished job.
  await expect(page.getByTestId("group-members")).toBeVisible();
  await expect(page.getByText("Nobody yet.")).toBeVisible();

  // Retire it, and the confirmation names the cost even when there is none.
  await page.getByTestId("remove-group").click();
  await expect(page.getByText(/grants nothing — no access changes/)).toBeVisible();
  await page.getByRole("button", { name: "Remove it" }).click();

  await expect(page.getByText(new RegExp(`${name} removed`))).toBeVisible();
  await page.goto(`/admin/groups?q=${encodeURIComponent(name)}`);
  await expect(rows(page)).toHaveCount(0);
});

test.describe("what a viewer is offered", () => {
  test.use({ storageState: storageStateFor("viewer") });

  test("the directory, and nothing to change", async ({ page }) => {
    // A group's membership is directory information, so `users.view` reads it.
    await signIn(page, "viewer", "/admin/groups");
    await expect(page.getByTestId("groups-table")).toBeVisible();
    await expect(page.getByTestId("read-only")).toBeVisible();
    await expect(page.getByTestId("new-group")).toHaveCount(0);
  });
});

test("the groups page is legible and keyboard-reachable", async ({ page }) => {
  for (const path of ["/admin/groups", "/admin/groups?kind=GOVERNANCE"]) {
    await signIn(page, "admin", path);
    await expect(page.getByTestId("groups-table")).toBeVisible();
    await page.waitForFunction(() =>
      document.getAnimations().every((animation) => animation.playState !== "running"),
    );

    const audit = await new AxeBuilder({ page }).include("#nu-main").analyze();
    const serious = audit.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    );
    expect(
      serious.map((violation) => ({
        path,
        id: violation.id,
        nodes: violation.nodes.map(
          (node) => `${node.target.join(" ")} :: ${node.failureSummary}`,
        ),
      })),
    ).toEqual([]);
  }
});
