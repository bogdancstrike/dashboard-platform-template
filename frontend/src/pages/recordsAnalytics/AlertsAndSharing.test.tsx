import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { embedSnippet, PublicLinksDrawer, PublishButton, shareUrl } from "@/components/recordsAnalytics/PublicLinksDrawer";
import { embeddingOrigin, PublicDashboardPage } from "@/public/PublicDashboardPage";
import { sharedDashboardToken } from "@/public/publicDashboardEntry";
import { currentUser } from "@/test/handlers";
import { ra, resetRecordsAnalytics } from "@/test/handlers/recordsAnalytics";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

import { describeWatch } from "@/components/recordsAnalytics/watchParts";

import AlertsPage from "./AlertsPage";
import RecordGridPage, { gridColumns } from "./RecordGridPage";
import WatchDetailPage from "./WatchDetailPage";

beforeEach(() => {
  resetRecordsAnalytics();
  server.use(http.get("/platform/api/me", () => HttpResponse.json({ ...currentUser, permissions: [...currentUser.permissions, "alerts.manage", "dashboards.publish"] })));
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

function alerts(route = "/alerts") {
  return renderWithProviders(
    <Routes>
      <Route path="/alerts" element={<AlertsPage />} />
      <Route path="/alerts/:id" element={<WatchDetailPage />} />
    </Routes>,
    { route },
  );
}

describe("AlertsPage", () => {
  it("lists watches with their status and silencing", async () => {
    alerts();
    const grid = await screen.findByTestId("watch-grid");
    expect(within(grid).getByTestId("watch-New tickets per day")).toHaveTextContent("Anomaly");
    expect(within(grid).getByTestId("watch-Order revenue per week")).toHaveTextContent("Muted");
    expect(describeWatch(ra.watches[1]!)).toBe("Sum of total · orders per week · rolling · medium");
  });

  it("shows the history and filters it", async () => {
    alerts("/alerts?tab=history");
    const history = await screen.findByTestId("alert-history");
    expect(await within(history).findAllByTestId("anomaly-row")).toHaveLength(2);
    fireEvent.click(within(history).getByRole("button", { name: "Open", pressed: false }));
    await waitFor(() => expect(within(screen.getByTestId("alert-history")).getAllByTestId("anomaly-row")).toHaveLength(1));
  });

  it("evaluates every watch", async () => {
    alerts();
    await screen.findByTestId("watch-grid");
    fireEvent.click(screen.getByRole("button", { name: "Evaluate all" }));
    expect(await screen.findByText("2 new anomalies.")).toBeInTheDocument();
  });

  it("creates a watch with a live preview", async () => {
    alerts();
    fireEvent.click(await screen.findByTestId("watch-new"));
    expect(await screen.findByText("1 point would be flagged")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("watch-name"), { target: { value: "Probe watch" } });
    fireEvent.click(screen.getByTestId("watch-save"));
    await waitFor(() => expect(ra.watches.map((w) => w.name)).toContain("Probe watch"));
  });
});

describe("WatchDetailPage", () => {
  it("draws the chart, fires on demand, shows an alert's window and acknowledges it", async () => {
    alerts("/alerts/w-1?anomaly=an-1");
    expect(await screen.findByTestId("watch-detail")).toBeInTheDocument();
    expect(await screen.findByText(/People were notified/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark as seen" }));
    await waitFor(() => expect(ra.anomalies.find((a) => a.id === "an-1")!.status).toBe("ACKNOWLEDGED"));
    fireEvent.click(screen.getByTestId("watch-evaluate"));
    expect(await screen.findByText(/Anomaly detected — 1 new alert/)).toBeInTheDocument();
    fireEvent.click((await screen.findAllByTestId("anomaly-row"))[1]!);
  });

  it("snoozes, mutes and clears", async () => {
    alerts("/alerts/w-1");
    fireEvent.mouseEnter(await screen.findByTestId("watch-silence"));
    fireEvent.click(await screen.findByText("Snooze 1 day"));
    await waitFor(() => expect(ra.watches[0]!.snoozed_until).toBeTruthy());
    fireEvent.mouseEnter(screen.getByTestId("watch-silence"));
    fireEvent.click(await screen.findByText("Mute until unmuted"));
    await waitFor(() => expect(ra.watches[0]!.muted).toBe(true));
  });

  it("deletes after a confirmation, and says when a watch is gone", async () => {
    alerts("/alerts/w-2");
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(ra.watches.map((w) => w.id)).not.toContain("w-2"));
  });

  it("explains a missing watch", async () => {
    alerts("/alerts/nope");
    expect(await screen.findByText("No watch at this address")).toBeInTheDocument();
  });
});

describe("public dashboard", () => {
  it("parses the address", () => {
    expect(sharedDashboardToken("/share/dashboards/abcdefgh123")).toBe("abcdefgh123");
    expect(sharedDashboardToken("/share/dashboards/x")).toBeNull();
    expect(embeddingOrigin()).toBeNull();
  });

  it("renders every widget kind read-only", async () => {
    renderWithProviders(<PublicDashboardPage token="tok-open-123456" />);
    expect(await screen.findByTestId("public-dashboard")).toHaveTextContent("Board pack");
    expect(screen.getByText("600")).toBeInTheDocument();
    expect(screen.getByText("Revenue")).toBeInTheDocument();
    expect(screen.getByText("Fix the importer")).toBeInTheDocument();
    expect(screen.getByText("CUS-1")).toBeInTheDocument();
    expect(screen.getByText(/personal workspace/)).toBeInTheDocument();
    expect(screen.getByText(/could not be drawn: Unknown dataset/)).toBeInTheDocument();
  });

  it("asks for the password, refuses a wrong one, and remembers the grant", async () => {
    renderWithProviders(<PublicDashboardPage token="tok-locked" />);
    const lock = await screen.findByTestId("public-lock");
    expect(lock).toHaveTextContent("Investors");
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByTestId("public-unlock"));
    expect(await screen.findByRole("alert")).toHaveTextContent("That password is not right.");
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "opensesame" } });
    fireEvent.click(screen.getByTestId("public-unlock"));
    expect(await screen.findByTestId("public-dashboard")).toBeInTheDocument();
    expect(sessionStorage.getItem("nucleus.share.tok-locked")).toBe("grant-ok");
  });

  it.each([
    ["tok-gone", "This link has expired"],
    ["tok-missing", "This link does not exist"],
  ])("explains %s", async (token, title) => {
    renderWithProviders(<PublicDashboardPage token={token} />);
    expect(await screen.findByText(title)).toBeInTheDocument();
  });

  it.each([
    [403, { reason: "origin_not_allowed" }, "This dashboard cannot be shown here"],
    [429, {}, "Too many requests"],
    [410, { reason: "revoked" }, "This link is no longer available"],
    [500, {}, "Could not load this dashboard"],
  ])("explains a %s", async (status, details, title) => {
    server.use(http.get("/platform/public/dashboards/:token/view", () => HttpResponse.json({ error: "x", message: "No", details }, { status })));
    renderWithProviders(<PublicDashboardPage token="tok-any-12345" />);
    expect(await screen.findByText(title)).toBeInTheDocument();
  });
});

describe("PublicLinksDrawer", () => {
  it("lists links, publishes one and revokes one", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(() => Promise.resolve()) } });
    renderWithProviders(<PublicLinksDrawer dashboardId="d-1" open onClose={() => undefined} />);
    expect(await screen.findByTestId("public-link")).toHaveTextContent("3 views");
    fireEvent.change(screen.getByTestId("link-label"), { target: { value: "Investors" } });
    fireEvent.click(screen.getByTestId("link-create"));
    expect(await screen.findByText(/Link published/)).toBeInTheDocument();
    expect(ra.links[0]!.label).toBe("Investors");
    fireEvent.click(screen.getAllByRole("button", { name: "Embed code" })[0]!);
    expect(await screen.findByTestId("embed-snippet")).toHaveTextContent("<iframe");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByTestId("embed-snippet")).toBeNull());
    fireEvent.click(screen.getAllByRole("button", { name: "Revoke" })[0]!);
    const confirm = (await screen.findAllByText("Revoke this link?")).at(-1)!;
    fireEvent.click(within(confirm.closest(".ant-modal-content") as HTMLElement).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(ra.links.some((l) => l.status === "REVOKED")).toBe(true));
  });

  it("builds addresses and snippets", () => {
    expect(shareUrl({ path: "/share/dashboards/t" })).toBe(`${window.location.origin}/share/dashboards/t`);
    expect(embedSnippet({ path: "/share/dashboards/t", label: 'A "quoted" label' })).toContain("&quot;quoted&quot;");
  });

  it("opens from the dashboard header", async () => {
    renderWithProviders(<PublishButton dashboardId="d-1" />);
    fireEvent.click(screen.getByTestId("dashboard-publish"));
    expect(await screen.findByText("Public links")).toBeInTheDocument();
  });
});

describe("RecordGridPage", () => {
  it("loads the list's rows into a grid with the editable columns", async () => {
    renderWithProviders(<RecordGridPage resourceKey="project" />, { route: "/projects/grid?status=ACTIVE" });
    expect(await screen.findByTestId("record-grid")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(2);
  });

  it("asks before leaving with edits that are not saved, and leaves quietly with none", async () => {
    renderWithProviders(
      <Routes>
        <Route path="/tasks/grid" element={<RecordGridPage resourceKey="task" />} />
        <Route path="/tasks" element={<p>the list</p>} />
      </Routes>,
      { route: "/tasks/grid" },
    );
    const grid = await screen.findByTestId("record-grid");
    const first = () => document.querySelector('[data-cell="0:0"]') as HTMLElement;
    await waitFor(() => expect(first()).toBeTruthy());
    fireEvent.mouseDown(first());
    fireEvent.keyDown(grid, { key: "Z" });
    const input = within(first()).getByRole("textbox");
    fireEvent.change(input, { target: { value: "Zeta" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("grid-pending")).toHaveTextContent("1 pending");

    fireEvent.click(screen.getByRole("button", { name: "Back to the list" }));
    expect((await screen.findAllByText("Leave without saving 1 change?")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryAllByText("Leave without saving 1 change?")).toHaveLength(0));
    expect(screen.getByTestId("record-grid")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back to the list" }));
    fireEvent.click(await screen.findByRole("button", { name: "Leave and discard" }));
    expect(await screen.findByText("the list")).toBeInTheDocument();
  });

  it("refuses an unknown dataset", async () => {
    renderWithProviders(<RecordGridPage resourceKey="planet" />);
    expect(await screen.findByText("This dataset cannot be edited as a grid")).toBeInTheDocument();
  });

  it("keeps editable cell kinds and locks the rest", () => {
    const columns = gridColumns({
      key: "x", label: "X", title_field: "name", default_columns: ["name", "code", "owner_id"],
      fields: [
        { name: "name", label: "Name", kind: "text", editable: true, required: true, choices: [] },
        { name: "status", label: "Status", kind: "enum", editable: true, choices: ["A"] },
        { name: "owner_id", label: "Owner", kind: "uuid", editable: true, choices: [] },
        { name: "checklist", label: "Checklist", kind: "json", editable: true, choices: [] },
        { name: "code", label: "Code", kind: "text", editable: false, choices: [] },
      ],
    } as never);
    expect(columns.map((c) => [c.name, c.editable])).toEqual([["name", true], ["status", true], ["code", false]]);
  });
});
