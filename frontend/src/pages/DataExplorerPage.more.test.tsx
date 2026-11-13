import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import DataExplorerPage from "@/pages/DataExplorerPage";
import { explorerResult, savedViews } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * The explorer's controls around the answer (§4–§6): the sort direction, the
 * scanning views with their grouping and "load more", the column picker,
 * opening and editing a saved search, and a question that cannot be run.
 */
function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.search}</output>;
}

function render(route = "/explore?resource=task") {
  return renderWithProviders(
    <>
      <DataExplorerPage />
      <Where />
    </>,
    { route },
  );
}

const where = () => decodeURIComponent(screen.getByTestId("where").textContent ?? "");

describe("shaping the answer", () => {
  it("flips the sort direction in the address", async () => {
    const user = userEvent.setup();
    render("/explore?resource=task&order=desc");
    await screen.findByText("Review customer migration");
    await user.click(screen.getByRole("button", { name: "Sorted descending" }));
    await waitFor(() => expect(where()).toContain("order=asc"));
  });

  it("switches to a scanning view, groups it, and loads more", async () => {
    const user = userEvent.setup();
    const pages: number[] = [];
    server.use(
      http.post("/platform/api/explorer/query", async ({ request }) => {
        const body = (await request.json()) as { page?: number };
        pages.push(body.page ?? 1);
        const page = body.page ?? 1;
        return HttpResponse.json({
          ...explorerResult,
          items: [{ ...explorerResult.items[0], id: `task-p${page}`, title: `Row on page ${page}` }],
          total: 3,
          page,
          pages: 3,
          page_size: 1,
        });
      }),
    );
    render("/explore?resource=task&view=list");
    expect(await screen.findByText("Row on page 1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Row on page 2")).toBeInTheDocument();
    // What was loaded stays: a scanning view accumulates.
    expect(screen.getByText("Row on page 1")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Group results" }));
    const option = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option");
      if (!found) throw new Error("no grouping offered");
      return found;
    });
    await user.click(option);
    await waitFor(() => expect(where()).toContain("group="));
  });

  it("chooses the visible columns", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText("Review customer migration");
    await user.click(screen.getByRole("button", { name: /Columns/ }));
    const picker = await screen.findByText("Visible columns");
    const popover = picker.closest(".ant-popover")!;
    const boxes = within(popover).getAllByRole("checkbox");
    const unticked = boxes.find((box) => !(box as HTMLInputElement).checked) ?? boxes[0]!;
    await user.click(unticked);
    await waitFor(() => expect(where()).toContain("columns="));
  });

  it("changes the view mode in the address", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText("Review customer migration");
    await user.click(within(screen.getByTestId("view-mode")).getByText(/Cards/i));
    await waitFor(() => expect(where()).toContain("view=cards"));
  });
});

describe("saved searches from inside the explorer", () => {
  const SEARCH = { ...savedViews[0]!, condition_tree: { id: "root", type: "group", children1: {} }, query_text: "migration", filters: { status: "IN_PROGRESS", tags: ["a", "b"], empty: "" }, view_mode: "list" };

  it("opens one, restoring its whole question", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/platform/api/saved-searches", () => HttpResponse.json({ items: [SEARCH], total: 1 })),
      http.get("/platform/api/saved-searches/:id", () => HttpResponse.json(SEARCH)),
    );
    render();
    await user.click(await screen.findByRole("button", { name: /Saved searches/ }));
    await user.click(await screen.findByRole("button", { name: /Open$/ }));
    await waitFor(() => expect(where()).toContain(`saved=${SEARCH.id}`));
    expect(where()).toContain("q=migration");
    expect(where()).toContain("f.status=IN_PROGRESS");
    expect(where()).toContain("f.tags=a,b");
    expect(where()).not.toContain("f.empty");
    expect(where()).toContain("view=list");
  });

  it("edits one's name without rewriting its question", async () => {
    const user = userEvent.setup();
    const puts: Record<string, unknown>[] = [];
    server.use(
      http.get("/platform/api/saved-searches", () => HttpResponse.json({ items: [SEARCH], total: 1 })),
      http.put("/platform/api/saved-searches/:id", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        puts.push(body);
        return HttpResponse.json({ ...SEARCH, ...body });
      }),
    );
    render("/explore?resource=customer");
    await user.click(await screen.findByRole("button", { name: /Saved searches/ }));
    await user.click(await screen.findByRole("button", { name: `Edit ${SEARCH.name}` }));
    const name = await screen.findByDisplayValue(SEARCH.name);
    await user.clear(name);
    await user.type(name, "Renamed");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    // The stored question, not the customer list on screen.
    expect(puts[0]).toMatchObject({ name: "Renamed", resource_type: "task", query_text: "migration" });
  });
});

describe("when the question cannot be answered", () => {
  it("says so above the results", async () => {
    server.use(
      http.post("/platform/api/explorer/query", () =>
        HttpResponse.json({ error: "validation_failed", message: "That rule names a field this dataset does not have." }, { status: 400 }),
      ),
    );
    render("/explore?resource=task&tree=not-json");
    expect(await screen.findByText("This question could not be run")).toBeInTheDocument();
  });

  it("says when the role has no datasets to explore", async () => {
    server.use(http.get("/platform/api/explorer/catalog", () => HttpResponse.json({ items: [], view_modes: ["table"] })));
    render("/explore");
    expect(await screen.findByText("Your role has no explorable datasets")).toBeInTheDocument();
  });
});
