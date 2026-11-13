import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import DevelopersPage, { renderTicks } from "@/pages/DevelopersPage";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";
import { currentUser } from "@/test/handlers";
import { devState, resetDevelopers } from "@/test/handlers/developers";
import { fillPath, matches, pythonLiteral, sampleBody, snippet } from "@/components/developers/snippets";
import { latencyOption, trafficOption } from "@/components/developers/ApiUsageView";
import type { ApiEndpoint } from "@/api/developers";

function renderAt(route = "/developers") {
  return renderWithProviders(
    <Routes>
      <Route path="/developers" element={<DevelopersPage />} />
      <Route path="/developers/:tab" element={<DevelopersPage />} />
    </Routes>,
    { route },
  );
}

afterEach(() => resetDevelopers());

describe("DevelopersPage", () => {
  it("lists the reference by group, searches it and opens an endpoint with snippets and a captured schema", async () => {
    renderAt();
    const index = await screen.findByTestId("api-index");
    expect(within(index).getByText("Automations")).toBeInTheDocument();
    expect(screen.getByTestId("endpoint-detail")).toHaveTextContent("Every automation.");
    expect(screen.getByTestId("response-schema")).toHaveTextContent('"integer"');
    expect(screen.getByTestId("request-snippet")).toHaveTextContent("curl -X GET");
    fireEvent.change(screen.getByLabelText("Search endpoints"), { target: { value: "graph" } });
    expect(within(index).queryByText("/automations/rules")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("endpoint-PUT /api/automations/rules/<uuid:rule_id>/graph"));
    expect(screen.getByTestId("endpoint-detail")).toHaveTextContent("rule_id");
    expect(screen.getByTestId("no-example")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search endpoints"), { target: { value: "zzzz" } });
    expect(within(index).getByText("No endpoint matches")).toBeInTheDocument();
  });

  it("switches snippet language and copies it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderAt();
    const block = await screen.findByTestId("request-snippet");
    fireEvent.click(within(block).getByText("Python"));
    expect(block).toHaveTextContent("import requests");
    fireEvent.click(within(block).getByRole("button", { name: /Copy/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("requests.request")));
    writeText.mockRejectedValueOnce(new Error("no"));
    fireEvent.click(within(block).getByRole("button", { name: /Copy/ }));
    expect(await screen.findByText(/clipboard refused/)).toBeInTheDocument();
  });

  it("tries an endpoint in the console: fills a parameter, sends, keeps the answer as the example", async () => {
    renderAt("/developers/console?endpoint=GET%20%2Fpublic%2Fforms%2F%3Cstring%3Aslug%3E");
    const consoleCard = await screen.findByTestId("api-console");
    expect(screen.getByTestId("console-send")).toHaveTextContent("Fill in slug");
    fireEvent.change(within(consoleCard).getByLabelText("slug"), { target: { value: "bug-report" } });
    fireEvent.change(within(consoleCard).getByLabelText("Query string"), { target: { value: "?x=1" } });
    expect(consoleCard).toHaveTextContent("/platform/public/forms/bug-report?x=1");
    fireEvent.click(screen.getByTestId("console-send"));
    expect(await screen.findByTestId("console-status")).toBeInTheDocument();
    expect(screen.getByTestId("console-time")).toHaveTextContent("ms");
  });

  it("sends with the session and keeps a success, or with an API key", async () => {
    renderAt("/developers/console");
    await screen.findByTestId("api-console");
    fireEvent.click(screen.getByTestId("console-send"));
    expect(await screen.findByTestId("console-status")).toHaveTextContent("200");
    fireEvent.click(screen.getByTestId("console-keep"));
    await waitFor(() => expect(devState.captured).toHaveLength(1));
    expect(await screen.findByText("Kept as the example")).toBeInTheDocument();

    fireEvent.click(screen.getByText("An API key"));
    expect(screen.getByTestId("console-send")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "nuc_test" } });
    expect(screen.getByTestId("console-send")).toBeEnabled();
  });

  it("refuses a body that is not JSON before sending", async () => {
    renderAt("/developers/console?endpoint=PUT%20%2Fapi%2Fautomations%2Frules%2F%3Cuuid%3Arule_id%3E%2Fgraph");
    const card = await screen.findByTestId("api-console");
    expect(card).toHaveTextContent("changes data for real");
    fireEvent.change(within(card).getByLabelText("rule_id"), { target: { value: "r1" } });
    fireEvent.change(within(card).getByLabelText("Body"), { target: { value: "{nope" } });
    fireEvent.click(screen.getByTestId("console-send"));
    expect(await screen.findByText(/not valid JSON/)).toBeInTheDocument();
  });

  it("charts usage, picks a client from the table, changes the window", async () => {
    server.use(http.get("/platform/api/me", () =>
      HttpResponse.json({ ...currentUser, permissions: [...currentUser.permissions, "api.manage"] })));
    renderAt("/developers/usage");
    expect(await screen.findByTestId("kpi-requests")).toHaveTextContent("1,200");
    expect(screen.getByText("7.0%")).toBeInTheDocument();
    expect(screen.getByTestId("top-endpoints")).toHaveTextContent("/api/explorer/catalog");
    expect(screen.getByText("500 · 14")).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("usage-clients")).getByText("Billing sync"));
    await waitFor(() => expect(screen.queryByTestId("usage-clients")).not.toBeInTheDocument());
    fireEvent.click(screen.getByText("30 days"));
    expect(await screen.findByTestId("kpi-requests")).toBeInTheDocument();
  });

  it("documents webhooks, SDKs and the changelog, and links to the component docs", async () => {
    renderAt("/developers/webhooks");
    expect(await screen.findByTestId("webhooks-doc")).toHaveTextContent("/public/automations/hooks/<token>");
    expect(screen.getByTestId("components-link")).toBeInTheDocument();
    fireEvent.click(screen.getByText("SDKs"));
    expect(await screen.findByTestId("sdk-snippet")).toHaveTextContent("export function nucleus");
    fireEvent.click(screen.getByText("Changelog"));
    expect(await screen.findByTestId("changelog")).toHaveTextContent("Workflows as graphs");
    fireEvent.click(screen.getByText("API reference"));
    expect(await screen.findByTestId("api-index")).toBeInTheDocument();
  });

  it("says when the reference cannot be loaded, and retries", async () => {
    devState.referenceFails = true;
    renderAt("/developers/nonsense");
    expect(await screen.findByText("The reference broke.")).toBeInTheDocument();
    devState.referenceFails = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("api-index")).toBeInTheDocument();
  });
});

describe("snippets", () => {
  const endpoint = { body: true, example: null } as unknown as ApiEndpoint;

  it("fills paths, finds sample bodies and matches searches", () => {
    expect(fillPath("/a/<uuid:id>/b/<name>", { id: "x y" })).toBe("/a/x%20y/b/{name}");
    expect(sampleBody(endpoint)).toEqual({});
    expect(sampleBody({ body: false, example: null })).toBeUndefined();
    expect(sampleBody({ body: true, example: { request_body: { a: 1 } } as never })).toEqual({ a: 1 });
    expect(matches({ method: "GET", path: "/p/x", summary: "Hello", operation: "op", permissions: ["a.b"] } as ApiEndpoint, "get a.b")).toBe(true);
    expect(pythonLiteral({ a: true, b: false, c: null })).toBe('{"a":True,"b":False,"c":None}');
  });

  it("writes curl, JavaScript and Python with either credential", () => {
    const input = { method: "POST", path: "/platform/x", origin: "http://h", body: { it: "'s" }, auth: "key" as const };
    expect(snippet("curl", input)).toContain(`-H "X-Api-Key: $NUCLEUS_API_KEY"`);
    expect(snippet("curl", input)).toContain(`'\\''`);
    expect(snippet("javascript", input)).toContain("process.env.NUCLEUS_API_KEY");
    expect(snippet("javascript", { ...input, auth: "bearer", body: undefined })).toContain("Bearer ${process.env.NUCLEUS_TOKEN}");
    expect(snippet("python", input)).toContain("json=");
    expect(snippet("python", { ...input, auth: "bearer" })).toContain("f\"Bearer");
  });

  it("builds chart options and renders backticks as code", () => {
    const usage = { series: [{ day: "2026-11-12", requests: 1, errors: 0, p50_ms: 1, p95_ms: 2 }] } as never;
    const theme = { accent: "#000", textStyle: {}, categoryAxis: {}, valueAxis: {} } as never;
    expect(trafficOption(usage, theme).series).toHaveLength(2);
    const latency = latencyOption(usage, theme);
    expect(latency.tooltip.valueFormatter(3)).toBe("3 ms");
    expect(latency.tooltip.valueFormatter("x")).toBe("—");
    expect(renderTicks("a `b` c")).toHaveLength(3);
  });
});
