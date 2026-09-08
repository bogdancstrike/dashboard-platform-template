import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import GroupsPage, { grantSummary, removalCost } from "@/pages/admin/GroupsPage";
import type { Group } from "@/api/groups";
import { CommandProvider } from "@/commands/CommandContext";
import { currentUser, groupRows, resetGroups, setGroupPrivileges } from "@/test/handlers";
import { server } from "@/test/server";
import { renderWithProviders } from "@/test/render";

/**
 * Groups (§11).
 *
 * The claim this file is built around: **the page has two privilege levels**,
 * because editing what a group grants is granting permissions and editing who
 * is in it is not. A manager gets one panel and not the other, and the reason
 * is written where they will read it.
 *
 * The two pure rules — what a group's grants come to in words, and what
 * removing one costs — are asserted directly, since both exist to replace a
 * number nobody can act on with a sentence somebody can.
 */
function render(route = "/admin/groups") {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/admin/groups" element={<GroupsPage />} />
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
  resetGroups();
});

const asGroup = (overrides: Partial<Group>): Group =>
  ({ member_count: 0, permissions: [], ...overrides }) as Group;

describe("what a group's grants come to", () => {
  it("says so plainly when it adds nothing", () => {
    // Plenty of groups exist only to address a set of people, so this is a
    // fact rather than an empty state asking to be filled (§34).
    expect(grantSummary([])).toBe("Adds nothing");
  });

  it("names the permissions rather than counting them", () => {
    // "3 permissions" does not answer whether being in this group lets
    // somebody export the customer list. Only the names do.
    expect(grantSummary(["audit.view", "logs.view"])).toBe("audit.view, logs.view");
  });

  it("counts only the overflow", () => {
    expect(grantSummary(["a.one", "b.two", "c.three", "d.four", "e.five"])).toBe(
      "a.one, b.two, c.three +2 more",
    );
  });
});

describe("what removing a group costs", () => {
  it("names the people and the permissions they lose", () => {
    expect(
      removalCost(asGroup({ member_count: 3, permissions: ["audit.view", "logs.view"] })),
    ).toBe("3 people are in it, and they lose audit.view, logs.view.");
  });

  it("says plainly when nothing changes, rather than leaving a blank", () => {
    expect(removalCost(asGroup({ member_count: 0, permissions: [] }))).toBe(
      "Nobody is in it, and it grants nothing — no access changes.",
    );
  });

  it("gets the grammar right for one person", () => {
    expect(removalCost(asGroup({ member_count: 1, permissions: ["audit.view"] }))).toBe(
      "1 person is in it, and they lose audit.view.",
    );
  });
});

describe("the list", () => {
  it("names what each group adds", async () => {
    withPermissions("users.manage", "roles.manage");
    render();

    const table = await screen.findByTestId("groups-table");
    await waitFor(() => expect(within(table).getByText("On-call")).toBeInTheDocument());
    expect(within(table).getByText("health.view, jobs.manage, logs.view")).toBeInTheDocument();
    // The four-grant group counts its overflow.
    expect(
      within(table).getByText("audit.view, records.export, records.import +1 more"),
    ).toBeInTheDocument();
    // And the one that adds nothing says so.
    expect(within(table).getByText("Adds nothing")).toBeInTheDocument();
  });

  it("says 'nobody' rather than 0", async () => {
    withPermissions("users.manage");
    render();

    const table = await screen.findByTestId("groups-table");
    await waitFor(() => expect(within(table).getByText("nobody")).toBeInTheDocument());
  });

  it("narrows by kind, and refuses the kinds nothing is in", async () => {
    withPermissions("users.manage");
    const user = userEvent.setup();
    render();

    await screen.findByTestId("groups-table");
    await user.click(screen.getByRole("combobox", { name: "Kind" }));
    // BUSINESS has no groups in the fixture: offered and disabled, so the
    // reader learns the kind exists and that nothing is in it (§76).
    // The label carries its count, so the title is "business (0)".
    const business = await screen.findByTitle(/^business/);
    expect(business).toHaveClass("ant-select-item-option-disabled");

    await user.click(await screen.findByTitle(/^governance/));
    await waitFor(() => expect(screen.queryByText("On-call")).not.toBeInTheDocument());
    expect(screen.getByText("Data stewards")).toBeInTheDocument();
  });

  it("finds a group by what it is for", async () => {
    withPermissions("users.manage");
    const user = userEvent.setup();
    render();

    await screen.findByTestId("groups-table");
    await user.type(screen.getByLabelText("Search groups"), "release goes wrong");

    await waitFor(() => expect(screen.queryByText("Data stewards")).not.toBeInTheDocument());
    expect(screen.getByText("On-call")).toBeInTheDocument();
  });
});

describe("the two privileges", () => {
  it("gives an administrator both panels", async () => {
    withPermissions("users.manage", "roles.manage");
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("groups-table");
    await waitFor(() => expect(within(table).getByText("On-call")).toBeInTheDocument());
    await user.click(within(table).getByText("On-call"));

    expect(await screen.findByTestId("save-members")).toBeInTheDocument();
    expect(screen.getByTestId("save-grants")).toBeInTheDocument();
  });

  it("gives a manager membership and not grants, and says why", async () => {
    // The claim the whole service is split for: `users.manage` without
    // `roles.manage`. If one permission covered both, a manager could add
    // `roles.manage` to a group they are in and hold it on their next request.
    withPermissions("users.manage");
    setGroupPrivileges(true, false);
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("groups-table");
    await waitFor(() => expect(within(table).getByText("On-call")).toBeInTheDocument());
    await user.click(within(table).getByText("On-call"));

    expect(await screen.findByTestId("save-members")).toBeInTheDocument();
    expect(screen.queryByTestId("save-grants")).not.toBeInTheDocument();
    // The reason, where they will read it — not a greyed control (§76).
    expect(screen.getByTestId("grants-locked")).toHaveTextContent("roles.manage");
  });

  it("still shows a manager what the group grants, read-only", async () => {
    withPermissions("users.manage");
    setGroupPrivileges(true, false);
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("groups-table");
    await waitFor(() => expect(within(table).getByText("On-call")).toBeInTheDocument());
    await user.click(within(table).getByText("On-call"));

    const panel = await screen.findByTestId("group-grants");
    // Knowing what a group grants is not the same privilege as changing it.
    expect(within(panel).getByText("jobs.manage")).toBeInTheDocument();
  });

  it("tells a reader with neither privilege once, at the top", async () => {
    withPermissions();
    setGroupPrivileges(false, false);
    render();

    // Said once rather than as a column of dead controls: the reason is a
    // permission and it will not change while they look at it.
    expect(await screen.findByTestId("read-only")).toHaveTextContent("users.manage");
    expect(screen.getByTestId("read-only")).toHaveTextContent("roles.manage");
    expect(screen.queryByTestId("new-group")).not.toBeInTheDocument();
  });
});

describe("membership", () => {
  it("lists the people in a group with what they are", async () => {
    withPermissions("users.manage", "roles.manage");
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("groups-table");
    await waitFor(() => expect(within(table).getByText("On-call")).toBeInTheDocument());
    await user.click(within(table).getByText("On-call"));

    const panel = await screen.findByTestId("group-members");
    expect(within(panel).getByText("Ada Administrator")).toBeInTheDocument();
    // Their role matters here: a group grants *on top of* it.
    expect(within(panel).getByText(/administrator/)).toBeInTheDocument();
  });

  it("says nobody yet rather than showing an empty box", async () => {
    withPermissions("users.manage");
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("groups-table");
    await waitFor(() =>
      expect(within(table).getByText("Onboarding buddies")).toBeInTheDocument(),
    );
    await user.click(within(table).getByText("Onboarding buddies"));

    expect(await screen.findByText("Nobody yet.")).toBeInTheDocument();
  });

  it("does not offer Save until something has moved", async () => {
    withPermissions("users.manage", "roles.manage");
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("groups-table");
    await waitFor(() => expect(within(table).getByText("On-call")).toBeInTheDocument());
    await user.click(within(table).getByText("On-call"));

    // A Save that is always available cannot tell somebody whether their
    // change is stored.
    expect(await screen.findByTestId("save-members")).toBeDisabled();
    expect(screen.getByTestId("save-grants")).toBeDisabled();
  });
});

describe("grants", () => {
  it("offers only the permissions the code checks for", async () => {
    withPermissions("users.manage", "roles.manage");
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("groups-table");
    await waitFor(() => expect(within(table).getByText("On-call")).toBeInTheDocument());
    await user.click(within(table).getByText("On-call"));

    await user.click(await screen.findByRole("combobox", { name: "Permissions" }));
    // Rendered from the catalogue the endpoints read, with the label beside
    // the code — a group granting `records.expport` grants nothing and looks
    // exactly like one that works.
    expect(await screen.findByTitle(/audit\.view — View the audit log/)).toBeInTheDocument();
  });

  it("saves a change and says what the group grants now", async () => {
    withPermissions("users.manage", "roles.manage");
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("groups-table");
    await waitFor(() =>
      expect(within(table).getByText("Onboarding buddies")).toBeInTheDocument(),
    );
    await user.click(within(table).getByText("Onboarding buddies"));

    await user.click(await screen.findByRole("combobox", { name: "Permissions" }));
    await user.click(await screen.findByTitle(/audit\.view/));
    await user.click(screen.getByTestId("save-grants"));

    await waitFor(() =>
      expect(groupRows.find((row) => row["id"] === "grp-buddies")?.["permissions"]).toEqual([
        "audit.view",
      ]),
    );
    expect(await screen.findByText(/now grants audit\.view/)).toBeInTheDocument();
  });
});

describe("making and removing a group", () => {
  it("says on the way in that it grants nothing", async () => {
    withPermissions("users.manage");
    const user = userEvent.setup();
    render();

    await screen.findByTestId("groups-table");
    await user.click(screen.getByTestId("new-group"));

    // Said before it exists, because a group that arrived granting something
    // would grant it at the moment it was made.
    expect(await screen.findByText("It starts granting nothing")).toBeInTheDocument();
    expect(screen.getByText(/needs `roles.manage`/)).toBeInTheDocument();
  });

  it("creates one and opens it, because the next thing is putting people in", async () => {
    withPermissions("users.manage");
    const user = userEvent.setup();
    render();

    await screen.findByTestId("groups-table");
    await user.click(screen.getByTestId("new-group"));
    await user.type(await screen.findByLabelText("Group name"), "Release captains");
    await user.click(screen.getByTestId("create-group"));

    await waitFor(() =>
      expect(groupRows.find((row) => row["name"] === "Release captains")).toBeDefined(),
    );
    // Straight into the group: an empty group is not the finished job.
    expect(await screen.findByTestId("group-members")).toBeInTheDocument();
  });

  it("names the cost before removing one", async () => {
    withPermissions("users.manage", "roles.manage");
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("groups-table");
    await waitFor(() => expect(within(table).getByText("On-call")).toBeInTheDocument());
    await user.click(within(table).getByText("On-call"));
    await user.click(await screen.findByTestId("remove-group"));

    // Both halves of the cost, because the hazard of this screen is quietly
    // reducing somebody's access.
    expect(
      await screen.findByText(/3 people are in it, and they lose/),
    ).toBeInTheDocument();
  });

  it("removes it and says who lost what", async () => {
    withPermissions("users.manage", "roles.manage");
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("groups-table");
    await waitFor(() => expect(within(table).getByText("On-call")).toBeInTheDocument());
    await user.click(within(table).getByText("On-call"));
    await user.click(await screen.findByTestId("remove-group"));
    await user.click(await screen.findByRole("button", { name: "Remove it" }));

    await waitFor(() =>
      expect(groupRows.find((row) => row["id"] === "grp-oncall")).toBeUndefined(),
    );
    expect(await screen.findByText(/3 people lost/)).toBeInTheDocument();
  });

  it("is not offered to a reader who may not manage membership", async () => {
    withPermissions();
    setGroupPrivileges(false, false);
    const user = userEvent.setup();
    render("/admin/groups?group=grp-oncall");

    await screen.findByTestId("group-members");
    expect(screen.queryByTestId("remove-group")).not.toBeInTheDocument();
    expect(await screen.findByText(/needs.*users\.manage/)).toBeInTheDocument();
    expect(user).toBeDefined();
  });
});
