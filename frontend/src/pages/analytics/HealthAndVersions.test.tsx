import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { CustomerHealthPanel } from "@/components/analytics/CustomerHealthPanel";
import { displayValue, VersionHistory, VersionHistoryButton } from "@/components/analytics/VersionHistory";
import { BandPill, Delta, Sparkline } from "@/components/analytics/parts";
import { ra, resetRecordsAnalytics } from "@/test/handlers/recordsAnalytics";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

import CustomerHealthPage from "./CustomerHealthPage";

beforeEach(() => resetRecordsAnalytics());

describe("CustomerHealthPage", () => {
  it("shows the distribution, movers, drops and the list", async () => {
    renderWithProviders(<Routes><Route path="/customers/health" element={<CustomerHealthPage />} /></Routes>, { route: "/customers/health" });
    expect(await screen.findByTestId("health-average")).toHaveTextContent("54");
    const list = screen.getByTestId("health-list");
    expect(within(list).getAllByRole("link")).toHaveLength(3);
    expect(screen.getByLabelText("Recent band drops")).toHaveTextContent("At risk → Critical");
    fireEvent.click(within(screen.getByRole("tablist", { name: "Health band" })).getByRole("tab", { name: "Critical" }));
    await waitFor(() => expect(within(screen.getByTestId("health-list")).getAllByRole("link")).toHaveLength(1));
    fireEvent.click(screen.getByText("7 days"));
    fireEvent.click(screen.getByText("Value"));
  });

  it("recomputes and tunes the model in its drawer", async () => {
    renderWithProviders(<Routes><Route path="/customers/health" element={<CustomerHealthPage />} /></Routes>, { route: "/customers/health" });
    fireEvent.click(await screen.findByRole("button", { name: "Recompute now" }));
    expect(await screen.findByText(/Scored 3 customers — 1 dropped a band/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("health-model-open"));
    expect(await screen.findByLabelText("Support tickets weight")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("health-model-save"));
    expect(await screen.findByText(/Model saved — 3 customers rescored/)).toBeInTheDocument();
  });

  it("says when the portfolio cannot be read", async () => {
    server.use(http.get("/platform/api/customer-health", () => HttpResponse.json({ error: "boom", message: "No" }, { status: 500 })));
    renderWithProviders(<CustomerHealthPage />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("CustomerHealthPanel", () => {
  it("explains the score signal by signal", async () => {
    renderWithProviders(<CustomerHealthPanel customerId="cus-2" />);
    expect(await screen.findByRole("img", { name: /Health score 31 out of 100, Critical/ })).toBeInTheDocument();
    expect(screen.getByText("Slipped into critical — act now")).toBeInTheDocument();
    expect(within(screen.getByTestId("signal-tickets")).getByText("3 open tickets")).toBeInTheDocument();
    expect(within(screen.getByTestId("signal-renewal")).getByText("−100")).toBeInTheDocument();
    expect(within(screen.getByTestId("signal-usage")).getByText("+12")).toBeInTheDocument();
    fireEvent.click(screen.getByText("30 d"));
  });
});

describe("parts", () => {
  it("draws bands, movement and sparklines", () => {
    renderWithProviders(
      <>
        <BandPill band={null} />
        <BandPill band="AT_RISK" score={50} />
        <Delta value={0} />
        <Delta value={-4} />
        <Sparkline values={[1]} />
        <Sparkline values={[1, 3, 2]} flagged={[1, 9]} label="trend" />
      </>,
    );
    expect(screen.getByText("No score")).toBeInTheDocument();
    expect(screen.getByTestId("health-band")).toHaveTextContent("At risk50");
    expect(screen.getByLabelText("down 4")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "trend" }).querySelectorAll("circle")).toHaveLength(1);
  });
});

describe("VersionHistory", () => {
  it("compares the last two versions and restores one field after a confirmation", async () => {
    renderWithProviders(<VersionHistory resourceType="task" recordId="tsk-1" narrow />);
    expect(await screen.findByText(/Comparing/)).toHaveTextContent("Comparing v2 with v3 · 2 differences");
    fireEvent.click(screen.getByTestId("version-1"));
    expect(screen.getByText(/Comparing/)).toHaveTextContent("Comparing v1 with v3 · 3 differences");
    fireEvent.click(screen.getByLabelText("Restore Priority"));
    fireEvent.click(screen.getByTestId("restore-fields"));
    fireEvent.click(await screen.findByTestId("restore-confirm"));
    await waitFor(() => expect(ra.restored).toEqual([{ version: 1, fields: ["priority"], expected_updated_at: "2026-09-03T10:00:00Z" }]));
    expect(await screen.findByText("Restored 1 field from version 1.")).toBeInTheDocument();
  });

  it("restores a whole version", async () => {
    renderWithProviders(<VersionHistory resourceType="task" recordId="tsk-1" />);
    await screen.findByText(/Comparing/);
    fireEvent.click(screen.getByTestId("restore-version"));
    fireEvent.click(await screen.findByTestId("restore-confirm"));
    await waitFor(() => expect(ra.restored[0]).toMatchObject({ version: 2 }));
  });

  it("views the record as of a date, and says when nothing is that old", async () => {
    server.use(http.get("/platform/api/records/:type/:id/versions", ({ request }) =>
      new URL(request.url).searchParams.get("at")
        ? HttpResponse.json({ error: "not_found", message: "There is no version of this record that early." }, { status: 404 })
        : HttpResponse.json(ra.versions)));
    renderWithProviders(<VersionHistory resourceType="task" recordId="tsk-1" />);
    const picker = await screen.findByLabelText("View as of a date");
    fireEvent.mouseDown(picker);
    fireEvent.change(picker, { target: { value: "2001-01-01" } });
    fireEvent.keyDown(picker, { key: "Enter" });
    expect(await screen.findByText("No version that early")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to now" }));
    expect(await screen.findByText(/Comparing/)).toBeInTheDocument();
  });

  it("hides restore without the permission", async () => {
    server.use(http.get("/platform/api/records/:type/:id/versions", () => HttpResponse.json({ ...ra.versions, can_restore: false })));
    renderWithProviders(<VersionHistory resourceType="task" recordId="tsk-1" />);
    expect(await screen.findByText(/Restoring needs the edit permission/)).toBeInTheDocument();
    expect(screen.queryByTestId("restore-version")).toBeNull();
  });

  it("opens as a drawer from a record page", async () => {
    renderWithProviders(<VersionHistoryButton resourceType="task" recordId="tsk-1" />);
    fireEvent.click(screen.getByTestId("open-versions"));
    expect(await screen.findByTestId("version-history")).toBeInTheDocument();
  });

  it("names references and draws every kind", () => {
    const refs = { user: { "u-1": "Ada" } };
    const f = (kind: string, references = "") => ({ name: "x", label: "X", kind, references });
    expect(displayValue(f("uuid", "user"), "u-1", refs)).toBe("Ada");
    expect(displayValue(f("uuid", "user"), "12345678-aaaa", refs)).toBe("12345678…");
    expect(displayValue(f("bool"), true, refs)).toBe("Yes");
    expect(displayValue(f("enum"), "AT_RISK", refs)).toBe("At risk");
    expect(displayValue(f("number"), 1234.5, refs)).toBe((1234.5).toLocaleString(undefined, { maximumFractionDigits: 2 }));
    expect(displayValue(f("json"), [1, 2], refs)).toBe("2 items");
    expect(displayValue(f("text"), "", refs)).toBe("—");
    expect(displayValue(f("datetime"), "2026-09-03T10:00:00Z", refs)).toBeTruthy();
  });
});
