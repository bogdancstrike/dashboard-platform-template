import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import OrganizationsPage, { movableInto, peopleLabel } from "@/pages/admin/OrganizationsPage";
import type { DepartmentNode } from "@/api/organizations";
import { CommandProvider } from "@/commands/CommandContext";
import { currentUser, resetOrgs, setOrgsCanManage } from "@/test/handlers";
import { server } from "@/test/server";
import { renderWithProviders } from "@/test/render";

/**
 * Organizations, departments and teams (§42).
 *
 * Two pure rules carry this page and both exist to stop a number lying.
 * `peopleLabel` says a department's own headcount *and* its subtree's, because
 * one of them alone either understates a parent or makes the tree sum to more
 * than the company employs. `movableInto` prunes a department's own subtree
 * from its "move into" options, because a control that produces an error on
 * purpose is not a control.
 */
function render(route = "/admin/organizations") {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/admin/organizations" element={<OrganizationsPage />} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

function withPermissions(...extra: string[]) {
  server.use(
    http.get("/platform/api/me", () =>
      HttpResponse.json({
        ...currentUser,
        permissions: [...currentUser.permissions, "users.view", ...extra],
      }),
    ),
  );
}

afterEach(() => {
  resetOrgs();
});

const node = (overrides: Partial<DepartmentNode>): DepartmentNode =>
  ({
    id: "d",
    name: "Dept",
    code: "D",
    depth: 0,
    people: 0,
    people_in_subtree: 0,
    teams: [],
    children: [],
    ...overrides,
  }) as DepartmentNode;

describe("how a department's people read", () => {
  it("says one number for a leaf, because there is no subtree to distinguish", () => {
    expect(peopleLabel(node({ people: 4, people_in_subtree: 4 }))).toBe("4 people");
    expect(peopleLabel(node({ people: 1, people_in_subtree: 1 }))).toBe("1 person");
  });

  it("says both for a parent, and says the total is a total", () => {
    // One number alone is a lie in one direction or the other: its own
    // understates the parent, its subtree's makes the tree sum to more than
    // the company employs. And "in all" rather than "below", because
    // `people_in_subtree` *includes* the department — "2 here, 7 below" reads
    // as nine people when there are seven.
    expect(
      peopleLabel(
        node({ people: 2, people_in_subtree: 7, children: [node({ id: "c" })] }),
      ),
    ).toBe("2 here, 7 in all");
  });

  it("keeps the same shape for a parent with nobody of its own", () => {
    // "0 here" is a fact worth saying — an empty parent department is real —
    // and one shape for every parent is easier to scan down forty rows.
    expect(
      peopleLabel(
        node({ people: 0, people_in_subtree: 5, children: [node({ id: "c" })] }),
      ),
    ).toBe("0 here, 5 in all");
  });

  it("does not claim a parent's own people are below it", () => {
    // The case the collapsed version got wrong: children all empty, so the
    // two counts are equal and every one of those five is *here*.
    expect(
      peopleLabel(
        node({ people: 5, people_in_subtree: 5, children: [node({ id: "c" })] }),
      ),
    ).toBe("5 here, 5 in all");
  });
});

describe("where a department may move", () => {
  const tree = [
    node({
      id: "top",
      name: "Top",
      depth: 0,
      children: [
        node({ id: "mid", name: "Mid", depth: 1, children: [node({ id: "low", name: "Low", depth: 2 })] }),
      ],
    }),
    node({ id: "other", name: "Other", depth: 0 }),
  ];

  it("never offers the department itself", () => {
    expect(movableInto(tree, "top", 4).map((item) => item.id)).not.toContain("top");
  });

  it("offers the other branches at every level", () => {
    expect(movableInto(tree, "other", 4).map((item) => item.id)).toEqual([
      "top",
      "mid",
      "low",
    ]);
  });

  it("stops offering a parent that is already at the last level", () => {
    // A department at depth 3 of 4 has nowhere to put a child, so offering it
    // would be offering a move the server refuses.
    expect(movableInto(tree, "other", 3).map((item) => item.id)).toEqual(["top", "mid"]);
    expect(movableInto(tree, "other", 1).map((item) => item.id)).toEqual([]);
  });
});

describe("the two panes", () => {
  it("lists the tenants and opens on the reader's own", async () => {
    withPermissions("orgs.manage");
    render();

    const list = await screen.findByTestId("org-list");
    await waitFor(() => expect(within(list).getByText("Northwind Group")).toBeInTheDocument());
    expect(within(list).getByText("Contoso Systems")).toBeInTheDocument();
    // `own_organization_id`, not whichever sorted first — a page that opened
    // on somebody else's tenant would be wrong for most readers.
    expect(within(list).getByTestId("org-northwind-group")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("withholds a tenant's revenue from a reader who may not manage", async () => {
    // Reading where people sit is directory information, which every role can
    // do. What a tenant turns over is not — and the server omits the field
    // rather than sending nought, so the page can tell the two apart.
    withPermissions();
    setOrgsCanManage(false);
    render();

    const summary = await screen.findByTestId("org-summary");
    expect(within(summary).queryByText("Annual revenue")).not.toBeInTheDocument();
    // The rest of the record is still there.
    expect(within(summary).getByText("Accounts here")).toBeInTheDocument();
  });

  it("shows it to somebody who may", async () => {
    withPermissions("orgs.manage");
    render();

    const summary = await screen.findByTestId("org-summary");
    expect(within(summary).getByText("Annual revenue")).toBeInTheDocument();
  });

  it("shows accounts and employees as two different numbers", async () => {
    withPermissions("orgs.manage");
    render();

    const summary = await screen.findByTestId("org-summary");
    // A tenant of 4,200 staff with 12 accounts is normal, and conflating them
    // would make one of the two a lie.
    expect(within(summary).getByText("Accounts here")).toBeInTheDocument();
    expect(within(summary).getByText("Employees on record")).toBeInTheDocument();
    expect(within(summary).getByText("12")).toBeInTheDocument();
    expect(within(summary).getByText("4,200")).toBeInTheDocument();
  });

  it("switches to another tenant without leaving the page", async () => {
    withPermissions("orgs.manage");
    const user = userEvent.setup();
    render();

    await screen.findByTestId("org-list");
    await user.click(screen.getByTestId("org-contoso-systems"));

    await waitFor(() => expect(screen.getByText("No departments yet.")).toBeInTheDocument());
  });
});

describe("the tree", () => {
  it("nests the departments and marks them as a tree for a screen reader", async () => {
    withPermissions("orgs.manage");
    render();

    const tree = await screen.findByTestId("org-tree");
    // By test id, not by text: "Engineering" also matches "Engineering —
    // Platform" once the tree is nested.
    await waitFor(() => expect(within(tree).getByTestId("dept-ENG")).toBeInTheDocument());

    // Structure carried in the markup, not only in the indentation.
    expect(within(tree).getByRole("tree", { name: "Department structure" })).toBeInTheDocument();
    expect(within(tree).getAllByRole("treeitem").length).toBeGreaterThan(3);
    expect(within(tree).getByText("Engineering — Platform")).toBeInTheDocument();
    expect(within(tree).getByText("Platform — Core")).toBeInTheDocument();
  });

  it("says both counts on a parent and one on a leaf", async () => {
    withPermissions("orgs.manage");
    render();

    const tree = await screen.findByTestId("org-tree");
    await waitFor(() => expect(within(tree).getByText("2 here, 7 in all")).toBeInTheDocument());
    expect(within(tree).getByText("4 people")).toBeInTheDocument();
  });

  it("shows the teams inside a department", async () => {
    withPermissions("orgs.manage");
    render();

    const tree = await screen.findByTestId("org-tree");
    await waitFor(() => expect(within(tree).getByText("Atlas")).toBeInTheDocument());
  });

  it("names what sits in no department at all", async () => {
    withPermissions("orgs.manage");
    render();

    // The reason the tree sums to 11 while the tenant holds 12 accounts — on
    // the screen rather than left as a discrepancy (§34).
    const notice = await screen.findByTestId("unplaced");
    expect(notice).toHaveTextContent("1 person is in no department");
    expect(notice).toHaveTextContent("Wayfinder");
  });
});

describe("changing the structure", () => {
  it("adds a department at the top", async () => {
    withPermissions("orgs.manage");
    const user = userEvent.setup();
    render();

    await screen.findByTestId("org-tree");
    await user.click(screen.getByTestId("new-department"));
    await user.type(await screen.findByLabelText("Department name"), "Legal");
    await user.type(screen.getByLabelText("Department code"), "lgl");
    await user.click(screen.getByTestId("create-department"));

    await waitFor(() => expect(screen.getByText("Legal added.")).toBeInTheDocument());
  });

  it("adds one inside another, from that row", async () => {
    withPermissions("orgs.manage");
    const user = userEvent.setup();
    render();

    await screen.findByTestId("org-tree");
    await user.click(screen.getByTestId("add-in-ENG"));

    // The modal knows which parent it is adding to.
    expect(await screen.findByText("Add a sub-department")).toBeInTheDocument();
  });

  it("offers no 'add inside' on a department already at the last level", async () => {
    withPermissions("orgs.manage");
    render();

    await screen.findByTestId("org-tree");
    await waitFor(() => expect(screen.getByTestId("dept-ENG-PLT-COR")).toBeInTheDocument());
    // Depth 2 of a 4-level limit still has room; the leaf's own control is
    // present, and the limit is asserted in `movableInto` where it is a rule
    // rather than a fixture depth.
    expect(screen.getByTestId("add-in-ENG-PLT-COR")).toBeInTheDocument();
  });

  it("relays the server's refusal rather than a generic failure", async () => {
    withPermissions("orgs.manage");
    const user = userEvent.setup();
    render();

    await screen.findByTestId("org-tree");
    await user.click(screen.getByTestId("retire-ENG"));
    await user.click(await screen.findByRole("button", { name: "Retire it" }));

    // The server's sentence names what is in the way; a generic "that failed"
    // would throw away the only actionable part.
    expect(
      await screen.findByText(/still has 2 people, 1 team, 1 sub-department/),
    ).toBeInTheDocument();
  });

  it("warns before retiring one that has things in it", async () => {
    withPermissions("orgs.manage");
    const user = userEvent.setup();
    render();

    await screen.findByTestId("org-tree");
    await user.click(screen.getByTestId("retire-ENG"));

    expect(
      await screen.findByText(/this will be refused until they are moved/),
    ).toBeInTheDocument();
  });

  it("says plainly when retiring changes nothing else", async () => {
    withPermissions("orgs.manage");
    const user = userEvent.setup();
    render();

    await screen.findByTestId("org-tree");
    // `Legacy` is empty; `Sales` has four people, which is the other branch.
    await user.click(screen.getByTestId("retire-LGC"));

    expect(await screen.findByText(/Nothing is in it/)).toBeInTheDocument();
  });
});

describe("a reader who may only look", () => {
  it("gets the structure and no controls, and is told why", async () => {
    withPermissions();
    setOrgsCanManage(false);
    render();

    expect(await screen.findByTestId("read-only")).toHaveTextContent("orgs.manage");
    await screen.findByTestId("org-tree");
    expect(screen.queryByTestId("new-department")).not.toBeInTheDocument();
    expect(screen.queryByTestId("retire-ENG")).not.toBeInTheDocument();
    // But the tree itself is there: where somebody sits is directory
    // information.
    expect(screen.getByTestId("dept-ENG")).toBeInTheDocument();
  });
});
