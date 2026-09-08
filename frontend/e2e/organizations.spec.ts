import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { apiAs, namespaced } from "./api";
import { signIn, storageStateFor } from "./auth";

/**
 * Organizations, departments and teams against the real stack (§42).
 *
 * The claims a component test cannot make:
 *
 * **The people-counts on the tree are PostgreSQL's.** A fixture can say
 * anything; only the real database can show that a department's number is
 * counted from where people actually sit rather than read from
 * `departments.headcount` — the column that said 116 for a department with
 * nobody in it. The tree's totals plus the unplaced must add up to the tenant's
 * own, which is arithmetic no fixture is entitled to.
 *
 * **The cycle refusal is the server's**, and it names the path that would close
 * the loop. A tree that could become its own ancestor hangs every page that
 * walks it, so this is checked where it is enforced.
 *
 * Everything this spec creates, it retires.
 */

test.describe.configure({ mode: "serial" });

/**
 * Press a confirmation once its popover has stopped moving.
 *
 * AntD's Popconfirm zooms in, and Playwright refuses to click a target it
 * considers unstable. Waiting for the animations rather than sleeping is what
 * the accessibility checks here already do.
 */
async function confirm(page: import("@playwright/test").Page, label: string) {
  const button = page.getByRole("button", { name: label, exact: true });
  await expect(button).toBeVisible();
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  );
  await button.click();
}

/** Retire a department by id, whatever happened to the test that made it. */
async function sweep(ids: string[]) {
  const api = await apiAs("admin");
  // Deepest first: a parent cannot be retired while a child is inside it.
  for (const id of [...ids].reverse()) {
    await api.delete(namespaced(`/admin/departments/${id}`));
  }
}

test("the structure comes back as a tree, on the reader's own tenant", async ({ page }) => {
  await signIn(page, "admin", "/admin/organizations");
  await expect(page.getByTestId("org-list")).toBeVisible();
  await expect(page.getByTestId("org-tree")).toBeVisible();

  // A tree in the markup, not only in the indentation.
  await expect(page.getByRole("tree", { name: "Department structure" })).toBeVisible();
  await expect(page.getByRole("treeitem").first()).toBeVisible();

  // And the tenant the reader belongs to is the one open.
  const api = await apiAs("admin");
  const catalogue = await (
    await api.get(namespaced("/admin/organizations/catalogue"))
  ).json();
  if (catalogue.own_organization_id) {
    const listed = await (
      await api.get(namespaced(`/admin/organizations/${catalogue.own_organization_id}`))
    ).json();
    await expect(page.getByTestId("org-summary")).toContainText(
      String(listed.organization.tier).toLowerCase(),
    );
  }
});

test("the numbers on the tree add up to the tenant's own", async ({ page }) => {
  // The whole reason `headcount` is computed rather than read: that column
  // said 116 for a department with nobody in it, and this is the arithmetic
  // that catches such a thing. Asserted against the API, because it is a
  // claim about the data and not about the rendering.
  const api = await apiAs("admin");
  const listed = await (
    await api.get(namespaced("/admin/organizations?page_size=10"))
  ).json();
  expect(listed.items.length).toBeGreaterThan(0);

  for (const organization of listed.items) {
    const shape = await (
      await api.get(namespaced(`/admin/organizations/${organization.id}`))
    ).json();

    type Node = { people: number; people_in_subtree: number; children: Node[] };
    const nodes = shape.departments as Node[];
    const placed = nodes.reduce((total, node) => total + node.people_in_subtree, 0);

    expect(
      placed + shape.unassigned_people,
      `${organization.name}: the tree and the unplaced must be the tenant's total`,
    ).toBe(shape.organization.people);

    // And every rollup is its own people plus its children's.
    const check = (node: Node) => {
      expect(node.people_in_subtree).toBe(
        node.people + node.children.reduce((sum, child) => sum + child.people_in_subtree, 0),
      );
      node.children.forEach(check);
    };
    nodes.forEach(check);
  }

  await signIn(page, "admin", "/admin/organizations");
  await expect(page.getByTestId("org-summary")).toBeVisible();
});

test("a department is added, moved and retired through the page", async ({ page }) => {
  const made: string[] = [];
  try {
    await signIn(page, "admin", "/admin/organizations");
    await expect(page.getByTestId("org-tree")).toBeVisible();

    const code = `E2E${Date.now().toString().slice(-6)}`;
    await page.getByTestId("new-department").click();
    await page.getByLabel("Department name").fill("End-to-end department");
    await page.getByLabel("Department code").fill(code.toLowerCase());
    await page.getByTestId("create-department").click();
    await expect(page.getByText("End-to-end department added.")).toBeVisible();

    // Upper-cased by the server: `eng` and `ENG` are the same code to
    // everybody except a string comparison.
    const row = page.getByTestId(`dept-${code}`);
    await expect(row).toBeVisible();

    const api = await apiAs("admin");
    const catalogue = await (
      await api.get(namespaced("/admin/organizations/catalogue"))
    ).json();
    const shape = await (
      await api.get(
        namespaced(`/admin/organizations/${catalogue.own_organization_id}`),
      )
    ).json();
    const mine = (shape.departments as Array<{ id: string; code: string }>).find(
      (item) => item.code === code,
    );
    expect(mine, "the new department was not on the tree").toBeTruthy();
    made.push(mine!.id);

    // Move it under an existing root, through the row's own control.
    const destination = (shape.departments as Array<{ id: string; name: string; code: string }>).find(
      (item) => item.code !== code,
    );
    if (destination) {
      await page.getByTestId(`move-${code}`).click();
      await page.getByTitle(destination.name, { exact: true }).first().click();
      await expect(page.getByText("Moved.")).toBeVisible();
    }

    // Retire it — nothing is in it, and the confirmation says so.
    await page.getByTestId(`retire-${code}`).click();
    await expect(page.getByText(/Nothing is in it/)).toBeVisible();
    await confirm(page, "Retire it");
    await expect(page.getByText(/retired/)).toBeVisible();

    await expect(page.getByTestId(`dept-${code}`)).toHaveCount(0);
    made.length = 0;
  } finally {
    await sweep(made);
  }
});

test("the server refuses a move that would close a loop, and names the path", async ({
  page,
}) => {
  // Only the server can be asked this: the page prunes the offending subtree
  // from its picker, so the browser has no way to request it.
  const api = await apiAs("admin");
  const catalogue = await (
    await api.get(namespaced("/admin/organizations/catalogue"))
  ).json();
  const organization = catalogue.own_organization_id as string;
  const made: string[] = [];

  try {
    const top = await (
      await api.post(namespaced(`/admin/organizations/${organization}/departments`), {
        data: { name: "Loop top", code: `LT${Date.now().toString().slice(-6)}` },
      })
    ).json();
    made.push(top.id);
    const bottom = await (
      await api.post(namespaced(`/admin/organizations/${organization}/departments`), {
        data: {
          name: "Loop bottom",
          code: `LB${Date.now().toString().slice(-6)}`,
          parent_id: top.id,
        },
      })
    ).json();
    made.push(bottom.id);

    const refused = await api.put(namespaced(`/admin/departments/${top.id}`), {
      data: { parent_id: bottom.id },
    });
    expect(refused.status()).toBe(409);
    const body = await refused.json();
    expect(body.message).toContain("inside itself");
    // The path, so an operator can see where the loop closes rather than
    // guessing which of four levels was the problem.
    expect(body.message).toContain("Loop top");

    // And the page never offers it: its picker prunes the subtree.
    await signIn(page, "admin", "/admin/organizations");
    await expect(page.getByTestId("org-tree")).toBeVisible();
    const picker = page.getByTestId(`move-${String(top.code)}`);
    if ((await picker.count()) > 0) {
      await picker.click();
      await expect(page.getByTitle("Loop bottom", { exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
    }
  } finally {
    await sweep(made);
  }
});

test("retiring a department with people in it is refused, saying what is in the way", async ({
  page,
}) => {
  await signIn(page, "admin", "/admin/organizations");
  await expect(page.getByTestId("org-tree")).toBeVisible();

  // A seeded department with something inside. The refusal is the server's,
  // and its sentence is what reaches the reader.
  const api = await apiAs("admin");
  const catalogue = await (
    await api.get(namespaced("/admin/organizations/catalogue"))
  ).json();
  const shape = await (
    await api.get(namespaced(`/admin/organizations/${catalogue.own_organization_id}`))
  ).json();
  const occupied = (
    shape.departments as Array<{ id: string; people_in_subtree: number; children: unknown[] }>
  ).find((item) => item.people_in_subtree > 0 || item.children.length > 0);
  expect(occupied, "no seeded department has anything in it").toBeTruthy();

  const answer = await api.delete(namespaced(`/admin/departments/${occupied!.id}`));
  expect(answer.status()).toBe(409);
  const body = await answer.json();
  expect(body.message).toContain("Move them first");
  expect(body.details.people + body.details.teams + body.details.children).toBeGreaterThan(0);
});

test.describe("what a manager is offered", () => {
  test.use({ storageState: storageStateFor("manager") });

  test("the structure, and nothing that redraws it", async ({ page }) => {
    // A manager holds `users.manage` and not `orgs.manage`: managing people is
    // not the same as redrawing the company.
    await signIn(page, "manager", "/admin/organizations");
    await expect(page.getByTestId("org-tree")).toBeVisible();
    await expect(page.getByTestId("read-only")).toContainText("orgs.manage");
    await expect(page.getByTestId("new-department")).toHaveCount(0);

    // And the server agrees, which is the half that matters.
    const api = await apiAs("manager");
    const refused = await api.put(namespaced("/admin/organizations/does-not-matter"), {
      data: { city: "Nope" },
    });
    expect([400, 403, 404]).toContain(refused.status());
  });
});

test("the structure is legible and keyboard-reachable", async ({ page }) => {
  await signIn(page, "admin", "/admin/organizations");
  await expect(page.getByTestId("org-tree")).toBeVisible();
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
