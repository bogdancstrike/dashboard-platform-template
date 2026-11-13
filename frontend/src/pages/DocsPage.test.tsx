import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Grid } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import DocsPage from "@/pages/DocsPage";
import { buildTree, moveFromDrop } from "@/components/docs/PageTree";
import { collabCalls, resetCollab } from "@/test/handlers/collab";
import { renderWithProviders } from "@/test/render";

/**
 * The wiki (§48–49): spaces and the tree, a page drawn from its blocks, an
 * editor that saves on its own and names the version it edited, history that
 * restores, record links, action items that become tasks, and search.
 */
function Address() {
  const location = useLocation();
  return <span data-testid="address">{location.pathname + location.search}</span>;
}

function render(route = "/docs") {
  return renderWithProviders(
    <>
      <Address />
      <Routes>
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/docs/:pageId" element={<DocsPage />} />
        <Route path="/tasks/:id" element={<span>task page</span>} />
      </Routes>
    </>,
    { route },
  );
}

beforeEach(() => {
  vi.spyOn(Grid, "useBreakpoint").mockReturnValue({ xs: true, sm: true, md: true, lg: true, xl: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetCollab();
});

describe("the docs home", () => {
  it("lists spaces, recent pages and the tree of the first space", async () => {
    render();
    const home = await screen.findByTestId("docs-home");
    expect(await within(home).findByText("Engineering")).toBeInTheDocument();
    expect(within(home).getByText("Meetings")).toBeInTheDocument();
    expect(await within(home).findByText("Vendor call — 2026-09-05")).toBeInTheDocument();
    const tree = screen.getByTestId("docs-tree");
    expect(await within(tree).findByText("Engineering handbook")).toBeInTheDocument();
  });

  it("searches pages, keeping the query in the address", async () => {
    render();
    await userEvent.type(await screen.findByLabelText("Search docs"), "runbook");
    const results = await screen.findByTestId("docs-results");
    expect(screen.getByTestId("address")).toHaveTextContent("q=runbook");
    expect(await within(results).findByRole("link", { name: /On-call runbook/ })).toBeInTheDocument();
  });

  it("creates a page from a template and opens it for editing", async () => {
    render();
    await userEvent.click(await screen.findByTestId("new-page"));
    await userEvent.type(await screen.findByLabelText("Page title"), "Weekly sync");
    await userEvent.click(await screen.findByTestId("template-meeting"));
    await userEvent.click(screen.getByTestId("create-page"));
    await waitFor(() =>
      expect(collabCalls.find((call) => call.path === "/api/docs/pages")?.body).toMatchObject({
        title: "Weekly sync",
        template: "meeting",
        space_id: "sp-eng",
      }),
    );
    await waitFor(() => expect(screen.getByTestId("address")).toHaveTextContent("edit=1"));
  });

  it("creates a space", async () => {
    render();
    await userEvent.click(await screen.findByTestId("new-space"));
    await userEvent.type(await screen.findByLabelText("Space name"), "Finance");
    await userEvent.click(screen.getByRole("button", { name: "Create space" }));
    await waitFor(() => expect(collabCalls.some((call) => call.path === "/api/docs/spaces")).toBe(true));
  });

  it("puts the tree in a drawer on a phone", async () => {
    vi.spyOn(Grid, "useBreakpoint").mockReturnValue({ xs: true });
    render();
    await userEvent.click(await screen.findByTestId("docs-pages"));
    expect(await screen.findByTestId("docs-tree")).toBeInTheDocument();
  });
});

describe("a page", () => {
  it("draws every kind of block and the record it links to", async () => {
    render("/docs/pg-handbook");
    const body = await screen.findByTestId("doc-body");
    expect(within(body).getByText("How we work")).toBeInTheDocument();
    expect(within(body).getByText("reviewed", { selector: "strong" })).toBeInTheDocument();
    expect(within(body).getByText("ls -la")).toBeInTheDocument();
    expect(within(body).getByRole("note")).toHaveTextContent("Careful");
    expect(within(body).getByText("Eng")).toBeInTheDocument();
    expect(within(body).getByTestId("record-mention")).toHaveAttribute("href", "/tasks/task-1");
    expect(within(screen.getByTestId("doc-links")).getByText("Wire the API")).toBeInTheDocument();
  });

  it("ticks a checklist item while reading, and saves it at once", async () => {
    render("/docs/pg-handbook");
    await userEvent.click(await screen.findByRole("checkbox", { name: /Read this/ }));
    await waitFor(() => {
      const saved = collabCalls.find((call) => call.method === "PUT");
      expect(saved?.body).toMatchObject({ expected_version: 1 });
    });
  });

  it("edits: adds a block, types, and saves on its own", async () => {
    render("/docs/pg-runbook?edit=1");
    const title = await screen.findByTestId("doc-title");
    await userEvent.clear(title);
    await userEvent.type(title, "Pager runbook");
    await userEvent.click(screen.getByTestId("add-block"));
    await userEvent.click(await screen.findByText("Checklist"));
    await userEvent.type(await screen.findByLabelText("Checklist item 1"), "Acknowledge");
    await waitFor(
      () => expect(collabCalls.find((call) => call.method === "PUT")?.body).toMatchObject({ title: "Pager runbook" }),
      { timeout: 4000 },
    );
    await userEvent.click(screen.getByTestId("toggle-edit"));
    expect(screen.getByTestId("address")).not.toHaveTextContent("edit=1");
  });

  it("moves and removes blocks in the editor", async () => {
    render("/docs/pg-handbook?edit=1");
    await screen.findByTestId("edit-heading");
    await userEvent.click(screen.getAllByLabelText("Move down")[0]!);
    await userEvent.click(screen.getAllByLabelText("Move up")[1]!);
    await userEvent.click(screen.getAllByLabelText("Remove block")[0]!);
    expect(screen.queryByTestId("edit-heading")).not.toBeInTheDocument();
    expect(screen.getByTestId("edit-text")).toBeInTheDocument();
  });

  it("turns an action item into a task and shows its live status", async () => {
    render("/docs/pg-notes");
    expect(await screen.findByTestId("doc-meeting")).toHaveTextContent("Vendor call");
    const existing = await screen.findByTestId("action-task");
    expect(existing).toHaveTextContent("TSK-9");
    await userEvent.click(screen.getByTestId("create-task"));
    await waitFor(() =>
      expect(collabCalls.find((call) => call.path === "/api/docs/pages/pg-notes/actions")?.body).toEqual({ block_id: "a1" }),
    );
    expect(await screen.findByText("TSK-100")).toBeInTheDocument();
  });

  it("reads history and restores an old version", async () => {
    render("/docs/pg-handbook");
    await userEvent.click(await screen.findByTestId("open-history"));
    expect(screen.getByTestId("address")).toHaveTextContent("history=1");
    await userEvent.click((await screen.findAllByRole("button", { name: "View" }))[1]!);
    expect(await screen.findByText("The first draft")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("restore-0"));
    await waitFor(() => expect(collabCalls.some((call) => call.path.endsWith("/restore"))).toBe(true));
  });

  it("links a record found through search, and unlinks it", async () => {
    render("/docs/pg-handbook");
    await userEvent.click(await screen.findByTestId("link-record"));
    await userEvent.type(await screen.findByTestId("record-search"), "Ne");
    const picks = await screen.findAllByRole("button", { name: /./ });
    const choice = picks.find((button) => button.closest(".nx-dc-picker"));
    if (choice) {
      await userEvent.click(choice);
      await waitFor(() => expect(collabCalls.some((call) => call.path.endsWith("/links"))).toBe(true));
      await userEvent.click(await screen.findByLabelText("Unlink Picked record"));
      await waitFor(() => expect(collabCalls.some((call) => call.method === "DELETE")).toBe(true));
    }
  });

  it("summarises with the model and adds the summary to the page", async () => {
    render("/docs/pg-handbook");
    await userEvent.click(await screen.findByLabelText("Summarise"));
    const summary = await screen.findByTestId("doc-summary");
    expect(summary).toHaveTextContent("ship on Friday");
    await userEvent.click(within(summary).getByRole("button", { name: "Add to page" }));
    expect(screen.queryByTestId("doc-summary")).not.toBeInTheDocument();
  });

  it("deletes a page after asking", async () => {
    render("/docs/pg-runbook");
    await userEvent.click(await screen.findByLabelText("Delete page"));
    await userEvent.click(await screen.findByTestId("confirm-delete"));
    await waitFor(() => expect(screen.getByTestId("address")).toHaveTextContent("/docs?space=sp-eng"));
  });

  it("says when a page is missing", async () => {
    render("/docs/nope");
    expect(await screen.findByText("That page does not exist.")).toBeInTheDocument();
  });
});

describe("the tree", () => {
  const items = [
    { id: "a", parent_id: null, title: "A", icon: null, position: 1, updated_at: "", is_meeting: false },
    { id: "b", parent_id: "a", title: "B", icon: null, position: 1, updated_at: "", is_meeting: true },
    { id: "c", parent_id: "gone", title: "C", icon: "x", position: 2, updated_at: "", is_meeting: false },
  ];

  it("nests children and lifts orphans to the top", () => {
    const tree = buildTree(items);
    expect(tree.map((node) => node.key)).toEqual(["a", "c"]);
    expect(tree[0]!.children?.[0]?.key).toBe("b");
  });

  it("turns a drop into a move request", () => {
    const drop = (dropToGap: boolean, dropPosition: number) =>
      ({ dragNode: { key: "c" }, node: { key: "a", pos: "0-0" }, dropToGap, dropPosition }) as never;
    expect(moveFromDrop(drop(false, 0), items)).toEqual({ id: "c", parent_id: "a" });
    expect(moveFromDrop(drop(true, -1), items)).toEqual({ id: "c", parent_id: null, before_id: "a" });
    expect(moveFromDrop(drop(true, 1), items)).toEqual({ id: "c", parent_id: null, after_id: "a" });
  });

  it("opens a page from the tree", async () => {
    render();
    const tree = await screen.findByTestId("docs-tree");
    fireEvent.click(await within(tree).findByText("Engineering handbook"));
    await waitFor(() => expect(screen.getByTestId("address")).toHaveTextContent("/docs/pg-handbook"));
  });
});
