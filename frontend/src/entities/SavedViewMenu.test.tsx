import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import type { SavedSearch } from "@/api/explorer";
import { CommandProvider } from "@/commands/CommandContext";
import { EntityHeader } from "@/entities/EntityChrome";
import {
  describeSnapshot,
  nearestPageSize,
  snapshotOf,
} from "@/entities/SavedViewMenu";
import {
  defaultView,
  fitsAList,
  paramsForView,
  statesItsOwnView,
  useEntityView,
} from "@/entities/useEntityView";
import TasksBoardPage from "@/pages/entities/TasksBoardPage";
import { savedViews } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * Saved views on an entity list (§46).
 *
 * The claims:
 *
 * **A view is applied by rewriting the address.** That is what makes it
 * shareable, bookmarkable and indistinguishable from the same question typed
 * by hand — so the test reads the address rather than a component's state.
 *
 * **The reader's own default decides what an empty address shows, and nothing
 * else does.** Not a colleague's default, not one built in the rule builder,
 * and not any address that already says what to show.
 *
 * **A view carrying a rule tree is a link, not an application.** Six facet
 * selects cannot express "overdue OR unassigned", so applying it as filters
 * would show a different set of rows under its name.
 */

const VIEWS = savedViews as unknown as SavedSearch[];

/** The fixture served to the list under test. */
function withViews(items: SavedSearch[] = VIEWS) {
  server.use(
    http.get("/platform/api/saved-searches", () =>
      HttpResponse.json({ items, total: items.length }),
    ),
  );
}

function Address() {
  const location = useLocation();
  return <span data-testid="address">{location.pathname + location.search}</span>;
}

/**
 * A list reduced to the two things this feature touches: the header that
 * carries the menu, and the address the menu writes. Deliberately not one of
 * the six pages — those assert the menu is *there* (it is in `EntityHeader`,
 * so all six have it); this asserts what it does.
 */
function Probe() {
  const view = useEntityView("task", { withInsights: false });
  return <EntityHeader view={view} subtitle="the tasks" />;
}

function render(route = "/tasks", page: React.ReactNode = <Probe />) {
  return renderWithProviders(
    <CommandProvider>
      <Address />
      <Routes>
        <Route path="/tasks" element={page} />
        <Route path="/explore" element={<div>the explorer</div>} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

async function openMenu() {
  const user = userEvent.setup();
  await user.click(await screen.findByTestId("saved-views"));
  return user;
}

describe("the pure parts", () => {
  it("snaps a page size to one the server accepts", () => {
    // A card grid pages in twelves and twenty-fours because that fills its
    // rows; a saved search may only carry the server's set, and a 400 is not
    // something the reader can act on.
    expect(nearestPageSize(24)).toBe(25);
    expect(nearestPageSize(12)).toBe(10);
    expect(nearestPageSize(96)).toBe(100);
    expect(nearestPageSize(50)).toBe(50);
  });

  it("records the question and the layout, and no rule tree", () => {
    const snapshot = snapshotOf({
      request: { resource_type: "task", columns: ["reference", "title"] },
      filters: { status: "TODO" },
      term: "audit",
      sort: "due_date",
      order: "asc",
      pageSize: 24,
    } as unknown as ReturnType<typeof useEntityView>);

    expect(snapshot).toEqual({
      resource_type: "task",
      condition_tree: null,
      filters: { status: "TODO" },
      query_text: "audit",
      sort: "due_date",
      order: "asc",
      columns: ["reference", "title"],
      page_size: 25,
      view_mode: "table",
    });
  });

  it("says there is nothing to save when the dataset has not answered", () => {
    expect(snapshotOf({ request: null } as unknown as ReturnType<typeof useEntityView>)).toBeNull();
  });

  it("describes what is about to be saved", () => {
    const said = describeSnapshot({
      filters: { status: "TODO", priority: "HIGH" },
      term: "audit",
      sort: "due_date",
    } as unknown as ReturnType<typeof useEntityView>);
    expect(said).toBe("2 filters · “audit” · sorted by due date");
  });

  it("turns a view into the address that shows it", () => {
    const params = paramsForView(VIEWS[1]!);
    expect(params.get("f.priority")).toBe("CRITICAL");
    expect(params.get("q")).toBe("audit");
    expect(params.get("sort")).toBe("priority");
    expect(params.get("page_size")).toBe("50");
    expect(params.get("view")).toBe(VIEWS[1]!.id);
  });

  it("drops a filter value an address cannot carry", () => {
    // A search saved from the Data Explorer may hold anything in `filters`,
    // and `f.owner=[object Object]` is a filter that matches nothing under a
    // name that promises rows.
    const params = paramsForView({
      ...VIEWS[0]!,
      filters: { status: "TODO", owner: { id: "x" }, blank: "", tags: ["a"], page: 2 },
    });
    expect(params.get("f.status")).toBe("TODO");
    expect(params.get("f.page")).toBe("2");
    expect(params.has("f.owner")).toBe(false);
    expect(params.has("f.blank")).toBe(false);
    expect(params.has("f.tags")).toBe(false);
  });

  it("knows an address that already says what to show", () => {
    expect(statesItsOwnView(new URLSearchParams(""))).toBe(false);
    expect(statesItsOwnView(new URLSearchParams("tab=activity"))).toBe(false);
    expect(statesItsOwnView(new URLSearchParams("f.status=TODO"))).toBe(true);
    expect(statesItsOwnView(new URLSearchParams("q=audit"))).toBe(true);
    expect(statesItsOwnView(new URLSearchParams("view=abc"))).toBe(true);
  });

  it("applies only the reader's own default, and only if a list can show it", () => {
    expect(defaultView(VIEWS)?.name).toBe("Critical only");
    // A colleague's default decides what their list opens with, not everyone's.
    expect(defaultView(VIEWS.filter((view) => !view.can_edit))).toBeUndefined();
    // And a default built in the rule builder cannot be shown as facets.
    const treeDefault = { ...VIEWS[2]!, is_default: true };
    expect(defaultView([treeDefault])).toBeUndefined();
    expect(fitsAList(treeDefault)).toBe(false);
    expect(fitsAList(VIEWS[0]!)).toBe(true);
  });
});

describe("the menu", () => {
  it("opens the list with the reader's default when the address says nothing", async () => {
    withViews();
    render();

    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent("f.priority=CRITICAL"),
    );
    expect(screen.getByTestId("address")).toHaveTextContent(`view=${VIEWS[1]!.id}`);
    // And names it, so the reader knows they are not looking at everything.
    expect(await screen.findByTestId("saved-views")).toHaveTextContent("Critical only");
  });

  it("leaves an address that already asks something alone", async () => {
    withViews();
    render("/tasks?f.status=TODO");

    await screen.findByTestId("saved-views");
    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent("f.status=TODO"),
    );
    // A link somebody pasted beats a default set weeks ago.
    expect(screen.getByTestId("address")).not.toHaveTextContent("CRITICAL");
  });

  it("applies a chosen view as the whole address, not as a patch", async () => {
    withViews();
    render("/tasks?f.status=TODO&page=3");
    const user = await openMenu();

    await user.click(await screen.findByText("In progress, mine first"));

    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent("f.status=IN_PROGRESS"),
    );
    // The page the reader was on belonged to the previous question.
    expect(screen.getByTestId("address")).not.toHaveTextContent("page=3");
  });

  it("offers a rule-builder view where it was built rather than applying it", async () => {
    withViews();
    render();
    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent("f.priority=CRITICAL"),
    );
    const user = await openMenu();

    await user.click(await screen.findByText("Overdue or unassigned"));

    expect(await screen.findByText("the explorer")).toBeInTheDocument();
  });

  it("saves the question on screen under a name", async () => {
    const sent: Array<Record<string, unknown>> = [];
    withViews([]);
    server.use(
      http.post("/platform/api/saved-searches", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        sent.push(body);
        return HttpResponse.json({ ...VIEWS[0], ...body, id: "saved-1" }, { status: 201 });
      }),
    );
    render("/tasks?f.status=BLOCKED&sort=title&order=asc");
    const user = await openMenu();

    await user.click(await screen.findByText("Save this view…"));
    await user.type(await screen.findByPlaceholderText(/Critical work/), "Blocked work");
    await user.click(screen.getByRole("button", { name: "Save search" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      name: "Blocked work",
      resource_type: "task",
      filters: { status: "BLOCKED" },
      sort: "title",
      order: "asc",
      condition_tree: null,
    });
  });

  it("updates the applied view with what is on screen now", async () => {
    const sent: Array<Record<string, unknown>> = [];
    withViews();
    server.use(
      http.put("/platform/api/saved-searches/:searchId", async ({ request, params }) => {
        const body = (await request.json()) as Record<string, unknown>;
        sent.push({ id: params.searchId, ...body });
        return HttpResponse.json({ ...VIEWS[0], ...body });
      }),
    );
    render(`/tasks?view=${VIEWS[0]!.id}&f.status=DONE&sort=title&order=asc`);
    const user = await openMenu();

    await user.click(await screen.findByText("Update “In progress, mine first”"));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      id: VIEWS[0]!.id,
      filters: { status: "DONE" },
      sort: "title",
    });
  });

  it("makes the applied view the one this list opens with", async () => {
    const sent: Array<Record<string, unknown>> = [];
    withViews();
    server.use(
      http.put("/platform/api/saved-searches/:searchId", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        sent.push(body);
        return HttpResponse.json({ ...VIEWS[0], ...body });
      }),
    );
    render(`/tasks?view=${VIEWS[0]!.id}`);
    const user = await openMenu();

    await user.click(await screen.findByText("Open this list with this view"));

    await waitFor(() => expect(sent).toEqual([{ is_default: true }]));
  });

  it("offers no editing of somebody else's view", async () => {
    withViews();
    render(`/tasks?view=${VIEWS[3]!.id}`);
    const user = await openMenu();

    // Readable and applicable, and the owner is named — but "Update" belongs
    // to the person who owns it, and the API would refuse it anyway.
    expect(await screen.findByText("Marcus Manager")).toBeInTheDocument();
    expect(screen.queryByText(/^Update /)).not.toBeInTheDocument();
    expect(screen.queryByText("Open this list with this view")).not.toBeInTheDocument();
    await user.click(screen.getByText("Show everything"));
    await waitFor(() => expect(screen.getByTestId("address")).toHaveTextContent("/tasks"));
    expect(screen.getByTestId("address")).not.toHaveTextContent("view=");
  });
});

describe("on a real list", () => {
  it("gives the six entity pages their views by being in the header", async () => {
    withViews();
    render("/tasks", <TasksBoardPage />);

    // The board reads its lanes from the same address the menu writes, so the
    // default arriving means the board is showing the saved question.
    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent("f.priority=CRITICAL"),
    );
    expect(await screen.findByTestId("saved-views")).toHaveTextContent("Critical only");
  });
});
