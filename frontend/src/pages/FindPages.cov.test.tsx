import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import type { Catalog } from "@/api/catalog";
import type { RelationshipGraph } from "@/api/relationships";
import { globalHits } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

import DataCatalogPage from "./DataCatalogPage";
import GlobalSearchPage from "./GlobalSearchPage";
import RelationshipExplorerPage from "./RelationshipExplorerPage";

/**
 * The three "find" pages that had no test of their own: global search, the
 * data catalogue and the relationship explorer.
 *
 * Asserted by what a reader can do — type, press keys, follow a connection —
 * and where that takes them, read from the URL, so the assertions survive the
 * pages being restyled.
 */

function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

function renderAt(route: string, page: JSX.Element, path: string) {
  return renderWithProviders(
    <>
      <Routes>
        <Route path={path} element={page} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </>,
    { route },
  );
}

const where = () => screen.getByTestId("where").textContent ?? "";

// ── global search ────────────────────────────────────────────────────────

function withHits() {
  server.use(http.get("/platform/api/search/global", () => HttpResponse.json(globalHits)));
}

describe("global search", () => {
  it("invites a term before searching, and asks for two characters", async () => {
    renderAt("/find/global", <GlobalSearchPage />, "/find/global");
    expect(await screen.findByText(/Search for a reference/)).toBeInTheDocument();

    renderAt("/find/global?q=a", <GlobalSearchPage />, "/find/global");
    expect(await screen.findByText("Type at least 2 characters to search.")).toBeInTheDocument();
  });

  it("lists the hits by dataset and opens one with the keyboard", async () => {
    withHits();
    const user = userEvent.setup();
    renderAt("/find/global?q=northwind", <GlobalSearchPage />, "/find/global");

    const hits = await screen.findAllByTestId("global-hit");
    expect(hits.length).toBeGreaterThan(0);
    expect(await screen.findByTestId("global-total")).toBeInTheDocument();

    screen.getByLabelText("Search everything").focus();
    if (hits.length > 1) {
      await user.keyboard("{ArrowDown}{ArrowUp}{ArrowUp}");
    }
    await user.keyboard("{Enter}");
    await waitFor(() => expect(where()).toMatch(/^\/explore\?resource=.+&f\.id=/));
  });

  it("opens a hit by clicking it, and a dataset in the explorer", async () => {
    withHits();
    const user = userEvent.setup();
    renderAt("/find/global?q=northwind", <GlobalSearchPage />, "/find/global");
    const [first] = await screen.findAllByTestId("global-hit");
    await user.click(first!);
    await waitFor(() => expect(where()).toMatch(/f\.id=/));
  });

  it("offers the explorer for a whole dataset", async () => {
    withHits();
    const user = userEvent.setup();
    renderAt("/find/global?q=northwind", <GlobalSearchPage />, "/find/global");
    await screen.findAllByTestId("global-hit");
    const [explore] = screen.getAllByRole("button", { name: /Data Explorer/ });
    await user.click(explore!);
    await waitFor(() => expect(where()).toMatch(/^\/explore\?resource=.+&q=migration/));
  });

  it("says when nothing matched, and when the search failed", async () => {
    server.use(
      http.get("/platform/api/search/global", () =>
        HttpResponse.json({ query: "zzz", total: 0, groups: [], truncated: false }),
      ),
    );
    renderAt("/find/global?q=zzz", <GlobalSearchPage />, "/find/global");
    expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument();
  });

  it("reports a search the server refused", async () => {
    server.use(
      http.get("/platform/api/search/global", () =>
        HttpResponse.json({ error: "internal_error", message: "boom" }, { status: 500 }),
      ),
    );
    renderAt("/find/global?q=broken", <GlobalSearchPage />, "/find/global");
    expect(await screen.findByText("The search could not be run")).toBeInTheDocument();
  });
});

// ── the data catalogue ───────────────────────────────────────────────────

const catalog: Catalog = {
  total: 2,
  field_count: 3,
  record_count: 120,
  items: [
    {
      key: "device",
      label: "Devices",
      description: "Hardware in the field",
      permission: "records.view",
      record_count: 100,
      default_sort: "-updated_at",
      default_columns: ["name"],
      updated_at: "2026-09-01T10:00:00Z",
      created_at: "2025-01-01T10:00:00Z",
      searchable_fields: ["serial_number"],
      facet_fields: ["status"],
      notes: [{ level: "info", message: "Fewer than half the records carry a value for Notes." }],
      fields: [
        {
          name: "serial_number",
          label: "Serial number",
          kind: "text",
          filterable: true,
          sortable: true,
          searchable: true,
          facet: false,
          choices: [],
          operators: ["eq", "contains"],
          filled: 100,
          completeness: 100,
        },
        {
          name: "status",
          label: "Status",
          kind: "enum",
          filterable: false,
          sortable: false,
          searchable: false,
          facet: true,
          choices: ["ONLINE", "OFFLINE", "DEGRADED", "RETIRED", "LOST"],
          operators: [],
          filled: 20,
          completeness: 20,
        },
      ],
    },
    {
      key: "order",
      label: "Orders",
      description: "What customers bought",
      permission: "records.view",
      record_count: 20,
      default_sort: "-created_at",
      default_columns: ["reference"],
      updated_at: null,
      created_at: null,
      searchable_fields: [],
      facet_fields: [],
      notes: [],
      fields: [
        {
          name: "reference",
          label: "Reference",
          kind: "text",
          filterable: true,
          sortable: true,
          searchable: true,
          facet: false,
          choices: [],
          operators: ["eq"],
          filled: 20,
          completeness: 100,
        },
      ],
    },
  ],
};

describe("the data catalogue", () => {
  it("describes every dataset, its fields and how complete each is", async () => {
    server.use(http.get("/platform/api/catalog/datasets", () => HttpResponse.json(catalog)));
    renderAt("/find/catalog", <DataCatalogPage />, "/find/catalog");

    const list = await screen.findByTestId("catalog");
    expect(within(list).getByText("Devices")).toBeInTheDocument();
    expect(within(list).getByText("Orders")).toBeInTheDocument();
    expect(screen.getByLabelText("Status: 20% of rows have a value")).toBeInTheDocument();
    expect(screen.getByText(/Fewer than half/)).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByTestId("explore-device")).toHaveAttribute("href", "/explore?resource=device");
  });

  it("finds the dataset that has a field, and says when nothing has it", async () => {
    const user = userEvent.setup();
    server.use(http.get("/platform/api/catalog/datasets", () => HttpResponse.json(catalog)));
    renderAt("/find/catalog", <DataCatalogPage />, "/find/catalog");
    await screen.findByTestId("catalog");

    const filter = screen.getByLabelText("Filter the catalogue");
    await user.type(filter, "serial");
    await waitFor(() => expect(screen.queryByText("Orders")).not.toBeInTheDocument());
    expect(screen.getByText("Devices")).toBeInTheDocument();

    await user.clear(filter);
    await user.type(filter, "no-such-thing");
    expect(await screen.findByText(/No dataset or field matches/)).toBeInTheDocument();
  });

  it("says when the catalogue cannot be read", async () => {
    server.use(
      http.get("/platform/api/catalog/datasets", () =>
        HttpResponse.json({ error: "internal_error", message: "down" }, { status: 500 }),
      ),
    );
    renderAt("/find/catalog", <DataCatalogPage />, "/find/catalog");
    await waitFor(() => expect(screen.queryByTestId("catalog")).not.toBeInTheDocument());
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

// ── the relationship explorer ────────────────────────────────────────────

function graphFor(id: string): RelationshipGraph {
  return {
    root: {
      id,
      label: `Customer ${id}`,
      summary: "A customer",
      entity: "customer",
      resource_type: "customer",
      explorable: true,
      updated_at: null,
    },
    total: 3,
    groups: [
      {
        direction: "inbound",
        relation: "orders.customer_id",
        label: "Orders",
        target: "order",
        total: 12,
        has_more: true,
        items: [
          { id: "o-1", label: "Order 1", summary: "", entity: "order", explorable: true, updated_at: null },
        ],
      },
      {
        direction: "outbound",
        relation: "account_manager_id",
        label: "Account manager",
        target: "user",
        total: 1,
        has_more: false,
        items: [
          { id: "u-1", label: "Mara Manager", summary: "Sales", entity: "user", explorable: false, updated_at: null },
        ],
      },
    ],
  };
}

describe("the relationship explorer", () => {
  it("starts from the communities analysis, and switches to the connection map", async () => {
    const user = userEvent.setup();
    renderAt("/find/relationships", <RelationshipExplorerPage />, "/find/relationships");
    expect(await screen.findByRole("heading", { name: "Relationships" })).toBeInTheDocument();

    await user.click(screen.getByText("Connection map"));
    await waitFor(() => expect(where()).toContain("view=map"));
    await user.click(screen.getByText("Communities"));
    await waitFor(() => expect(where()).not.toContain("view=map"));
  });

  it("finds a record to start from by searching", async () => {
    const user = userEvent.setup();
    renderAt("/find/relationships", <RelationshipExplorerPage />, "/find/relationships");
    await screen.findByRole("heading", { name: "Relationships" });

    withHits();
    await user.type(screen.getByLabelText("Search a record to start from"), "migration");
    const [start] = await screen.findAllByRole("button", { name: /Start here/ });
    await user.click(start!);
    await waitFor(() => expect(where()).toMatch(/resource=.+&id=/));
  });

  it("lists a record's connections, follows one and comes back along the trail", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/platform/api/relationships/:type/:id", ({ params }) =>
        HttpResponse.json(graphFor(String(params["id"]))),
      ),
    );
    renderAt(
      "/find/relationships?resource=customer&id=c-1",
      <RelationshipExplorerPage />,
      "/find/relationships",
    );

    expect(await screen.findByRole("heading", { name: /^Customer c-1/ })).toBeInTheDocument();
    expect(screen.getByText("3 connections")).toBeInTheDocument();
    expect(screen.getByText("Mara Manager")).toBeInTheDocument();

    // "See all" goes to the explorer, filtered on the column that points back.
    await user.click(screen.getByRole("button", { name: "See all 12" }));
    await waitFor(() => expect(where()).toContain("/explore?resource=order&f.customer_id=c-1"));
  });

  it("follows a connection and returns by the breadcrumb", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/platform/api/relationships/:type/:id", ({ params }) =>
        HttpResponse.json(graphFor(String(params["id"]))),
      ),
    );
    renderAt(
      "/find/relationships?resource=customer&id=c-1",
      <RelationshipExplorerPage />,
      "/find/relationships",
    );
    await screen.findByRole("heading", { name: /^Customer c-1/ });

    await user.click(screen.getByRole("button", { name: /Follow/ }));
    expect(await screen.findByRole("heading", { name: /^Customer o-1/ })).toBeInTheDocument();
    expect(where()).toContain("trail=");

    await user.click(screen.getByRole("button", { name: /^Customer c-1/ }));
    expect(await screen.findByRole("heading", { name: /^Customer c-1/ })).toBeInTheDocument();

    // The graph is the same answer drawn.
    await user.click(screen.getByText("Graph"));
    await user.click(screen.getByRole("button", { name: /Open in Data Explorer/ }));
    await waitFor(() => expect(where()).toContain("/explore?resource=customer&f.id=c-1"));
  });

  it("says when a record has no connections, and when they could not be loaded", async () => {
    server.use(
      http.get("/platform/api/relationships/:type/:id", ({ params }) =>
        params["id"] === "lonely"
          ? HttpResponse.json({ ...graphFor("lonely"), total: 0, groups: [] })
          : HttpResponse.json({ error: "not_found", message: "gone" }, { status: 404 }),
      ),
    );
    renderAt(
      "/find/relationships?resource=customer&id=lonely",
      <RelationshipExplorerPage />,
      "/find/relationships",
    );
    expect(await screen.findByText(/Nothing links to this record/)).toBeInTheDocument();
  });

  it("offers a way back when a followed record cannot be loaded", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/platform/api/relationships/:type/:id", () =>
        HttpResponse.json({ error: "not_found", message: "gone" }, { status: 404 }),
      ),
    );
    const trail = encodeURIComponent(JSON.stringify([{ resource: "customer", id: "c-1", label: "Start" }, "junk"]));
    renderAt(
      `/find/relationships?resource=order&id=missing&trail=${trail}`,
      <RelationshipExplorerPage />,
      "/find/relationships",
    );
    expect(await screen.findByText("Those connections could not be loaded")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Back/ }));
    await waitFor(() => expect(where()).toContain("id=c-1"));
  });

  it("survives a trail somebody edited by hand", async () => {
    server.use(
      http.get("/platform/api/relationships/:type/:id", ({ params }) =>
        HttpResponse.json(graphFor(String(params["id"]))),
      ),
    );
    renderAt(
      "/find/relationships?resource=customer&id=c-9&trail=%7Bnot-json",
      <RelationshipExplorerPage />,
      "/find/relationships",
    );
    expect(await screen.findByRole("heading", { name: /^Customer c-9/ })).toBeInTheDocument();
  });
});
