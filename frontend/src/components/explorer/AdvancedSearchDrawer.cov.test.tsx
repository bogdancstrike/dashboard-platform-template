import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import type { ExplorerRequest } from "@/api/explorer";
import { explorerCatalogue } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

import { AdvancedSearchDrawer } from "./AdvancedSearchDrawer";
import type { QueryNode } from "./queryTree";

/**
 * The advanced-conditions drawer (§5): a draft previewed against the real
 * data, which changes the page behind only when the reader presses Search.
 */

const fields = explorerCatalogue.items[0]!.fields;
const statusField = fields.find((field) => field.kind === "enum") ?? fields[0]!;

const tree: QueryNode = {
  id: "root",
  type: "group",
  properties: { conjunction: "AND", not: false },
  children1: {
    r1: {
      id: "r1",
      type: "rule",
      properties: { field: statusField.name, operator: "select_equals", value: ["OPEN"], valueType: ["select"] },
    },
    r2: { id: "r2", type: "rule", properties: { field: null, operator: null, value: [] } },
  },
};

function open(overrides: Partial<Parameters<typeof AdvancedSearchDrawer>[0]> = {}) {
  const props = {
    open: true,
    fields,
    request: { resource_type: "task", condition_tree: tree } as ExplorerRequest,
    onClose: vi.fn(),
    onSearch: vi.fn(),
    onSave: vi.fn(),
    onOpenSaved: vi.fn(),
    datasetLabel: "Tasks",
    recordCount: 500,
    ...overrides,
  };
  renderWithProviders(<AdvancedSearchDrawer {...props} />);
  return props;
}

describe("the advanced conditions drawer", () => {
  it("previews the draft as one line, and mutes the rule that is unfinished", async () => {
    open();
    expect(await screen.findByText("Tasks · 500 records")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /incomplete/ })).toHaveClass("is-incomplete");
    expect(screen.getByTestId("query-inspector")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("preview-count")).toHaveTextContent(/of 500 tasks match/));
  });

  it("runs the draft and closes, or saves it without running", async () => {
    const user = userEvent.setup();
    const props = open();
    await user.click(await screen.findByRole("button", { name: /Save as/ }));
    expect(props.onSave).toHaveBeenCalledWith(tree);

    await user.click(screen.getByTestId("run-advanced-search"));
    expect(props.onSearch).toHaveBeenCalledWith(tree);
    expect(props.onClose).toHaveBeenCalled();
  });

  it("clears the draft, and an empty draft searches for everything", async () => {
    const user = userEvent.setup();
    const props = open();
    await user.click(await screen.findByRole("button", { name: "Clear all" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Clear all" })).toBeDisabled());
    expect(screen.getByTestId("run-advanced-search")).toHaveTextContent(/matches/);
    await user.click(screen.getByTestId("run-advanced-search"));
    expect(props.onSearch).toHaveBeenCalledWith(null);
  });

  it("loads a saved search, and folds its tutorial away", async () => {
    const user = userEvent.setup();
    const props = open({ request: { resource_type: "task" }, datasetLabel: undefined });
    await user.click(await screen.findByRole("button", { name: "Load a saved search" }));
    expect(props.onOpenSaved).toHaveBeenCalled();

    // The lesson starts folded (the drawer is compact); it opens and folds again.
    // The lesson is a "?" in the header: closed until asked for.
    expect(screen.queryByTestId("advanced-help")).not.toBeInTheDocument();
    await user.click(screen.getByText("How this works"));
    expect(await screen.findByTestId("advanced-help")).toBeInTheDocument();
  });

  it("says when the preview cannot be run", async () => {
    server.use(
      http.post("/platform/api/explorer/query", () =>
        HttpResponse.json({ error: "validation_error", message: "That rule cannot be compiled." }, { status: 400 }),
      ),
    );
    open();
    expect(await screen.findByText("This condition could not be previewed")).toBeInTheDocument();
  });

  it("renders nothing inside while closed", () => {
    open({ open: false });
    expect(screen.queryByTestId("query-inspector")).not.toBeInTheDocument();
  });
});
