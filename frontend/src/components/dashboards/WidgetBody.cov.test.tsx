import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import type { AnalysisCatalogue } from "@/api/analysis";
import type { DashboardWidget } from "@/api/dashboards";
import { analysisCatalogue, explorerCatalogue } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

import { WidgetBody } from "./WidgetBody";

/**
 * What a dashboard card draws, per widget kind (§45, §67).
 *
 * The page tests render a dashboard of a few widgets; this renders every kind
 * on its own — finished, unfinished and refused — so a kind whose body throws
 * cannot hide behind the ones that happen to be on the fixture dashboard.
 */

const resources = explorerCatalogue.items;
const catalogue = analysisCatalogue as unknown as AnalysisCatalogue;

function widget(kind: string, config: Record<string, unknown> = {}): DashboardWidget {
  return {
    id: `w-${kind}`,
    kind: kind as DashboardWidget["kind"],
    title: kind,
    subtitle: null,
    x: 0,
    y: 0,
    width: 4,
    height: 3,
    position: 0,
    config: config,
  };
}

function draw(kind: string, config: Record<string, unknown> = {}) {
  return renderWithProviders(
    <div data-testid="card">
      <WidgetBody widget={widget(kind, config)} period="last_30_days" catalogue={catalogue} resources={resources} />
    </div>,
  );
}

async function settled() {
  await waitFor(() => expect(document.querySelector(".ant-skeleton")).toBeNull(), { timeout: 10_000 });
  return screen.getByTestId("card");
}

const refused = () => HttpResponse.json({ error: "forbidden", message: "no" }, { status: 403 });
const broken = () => HttpResponse.json({ error: "internal_error", message: "it broke" }, { status: 500 });

describe("a widget that has a shape and no subject yet", () => {
  it.each(["KPI", "BAR_CHART", "LIST", "REPORT", "SEARCH", "MAP", "ANALYTICS"])(
    "says %s still needs choosing rather than looking broken",
    async (kind) => {
      draw(kind);
      expect(await screen.findByText(/Nothing chosen yet/)).toBeInTheDocument();
    },
  );
});

describe("every finished kind draws", () => {
  it.each([
    ["KPI", { entity: "task" }],
    ["GAUGE", { entity: "task" }],
    ["ANALYTICS", { entity: "task" }],
    ["LIST", { entity: "task" }],
    ["TABLE", { entity: "task", columns: ["reference", "title"] }],
    ["LINE_CHART", { entity: "task" }],
    ["AREA_CHART", { entity: "order", metric: "sum:total", dimension: "channel" }],
    ["BAR_CHART", { entity: "order", dimension: "channel" }],
    ["PIE_CHART", { entity: "order", dimension: "channel" }],
    ["HEATMAP", { entity: "order" }],
    ["CHART", { entity: "order", chart: "treemap" }],
    ["MAP", { entity: "customer" }],
    ["REPORT", { report_id: "report-1" }],
    ["SEARCH", { search_id: "search-1" }],
    ["ACTIVITY", {}],
  ])("%s", async (kind, config) => {
    draw(kind, config);
    const card = await settled();
    expect(card.textContent).not.toMatch(/Nothing chosen yet/);
    expect(card).not.toBeEmptyDOMElement();
  });
});

describe("the alert strip", () => {
  it("lists what needs attention, by severity, linking to it", async () => {
    server.use(
      http.get("/platform/dashboard/alerts", () =>
        HttpResponse.json({
          items: [
            { key: "a", severity: "CRITICAL", count: 3, message: "Devices offline", link: "/devices", icon: "x" },
            { key: "b", severity: "WARNING", count: 5, message: "Tickets breaching", link: "/tickets", icon: "x" },
            { key: "c", severity: "INFO", count: 1, message: "One import waiting", link: "/import", icon: "x" },
          ],
          total: 3,
        }),
      ),
    );
    draw("ALERTS");
    expect(await screen.findByRole("link", { name: /Devices offline/ })).toHaveAttribute("href", "/devices");
    expect(screen.getByRole("link", { name: /Tickets breaching/ })).toBeInTheDocument();
  });

  it("is quiet when nothing needs attention, and says when it failed", async () => {
    server.use(http.get("/platform/dashboard/alerts", () => HttpResponse.json({ items: [], total: 0 })));
    draw("ALERTS");
    await settled();
    server.use(http.get("/platform/dashboard/alerts", broken));
    draw("ALERTS");
    await waitFor(() => expect(document.querySelector(".ant-alert")).not.toBeNull());
  });
});

describe("a refusal says whose data it was", () => {
  it("names the dataset the role lacks", async () => {
    server.use(
      http.post("/platform/api/explorer/insights", refused),
      http.get("/platform/api/explorer/insights", refused),
    );
    draw("KPI", { entity: "task" });
    expect(await screen.findByText("Your role does not include task")).toBeInTheDocument();
  });

  it.each([
    ["LIST", { entity: "task" }, "/platform/api/explorer/query", "post"],
    ["BAR_CHART", { entity: "order", dimension: "channel" }, "/platform/api/analysis/run", "post"],
    ["MAP", { entity: "customer" }, "/platform/api/maps/places", "get"],
    ["REPORT", { report_id: "report-1" }, "/platform/api/reports/:id/run", "post"],
  ] as const)("%s shows the server's message when it fails", async (kind, config, path, method) => {
    server.use(http[method](path, broken), http.get(path, broken));
    draw(kind, config);
    const card = await settled();
    await waitFor(() => expect(card.querySelector(".ant-alert")).not.toBeNull());
  });
});
