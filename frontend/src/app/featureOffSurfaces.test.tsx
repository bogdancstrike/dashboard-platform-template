/**
 * Inside pages, a switched-off feature's controls are absent (§27): the
 * canvas buttons on Workflows, the live tail on System logs, "View as this
 * person", saved searches in the Data Explorer, the timer pill, and a
 * dashboard widget whose kind's feature is off. Each page is rendered with
 * every feature off, against the same fixtures its own tests use.
 */

import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import { ImpersonationProvider } from "@/auth/ImpersonationProvider";
import { CommandProvider } from "@/commands/CommandContext";
import { TimerPill } from "@/components/decisions/TimerPill";
import { WidgetBody } from "@/components/dashboards/WidgetBody";
import WorkflowsPage from "@/pages/WorkflowsPage";
import LogsPage from "@/pages/admin/LogsPage";
import UserDetailPage from "@/pages/UserDetailPage";
import DataExplorerPage from "@/pages/DataExplorerPage";
import type { DashboardWidget } from "@/api/dashboards";
import { FEATURES } from "@/settings/features";
import { currentUser } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

const ALL_OFF = Object.fromEntries(Object.values(FEATURES).map((key) => [key, false]));

beforeEach(() => {
  server.use(
    http.get("/platform/api/me", () =>
      HttpResponse.json({
        ...currentUser,
        permissions: [
          ...currentUser.permissions,
          "automations.manage", "logs.view", "users.view", "users.impersonate", "time.track", "records.view",
        ],
        features: ALL_OFF,
      }),
    ),
  );
});

function at(path: string, element: React.ReactElement, route = path) {
  return renderWithProviders(
    <ImpersonationProvider>
      <CommandProvider>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </CommandProvider>
    </ImpersonationProvider>,
    { route },
  );
}

describe("with every feature off", () => {
  it("Workflows offers no canvas", async () => {
    at("/workflows", <WorkflowsPage />);
    await screen.findAllByRole("heading");
    await waitFor(() => expect(screen.queryByTestId("build-on-canvas")).not.toBeInTheDocument());
  });

  it("System logs offers no live tail", async () => {
    at("/admin/logs", <LogsPage />);
    const toggle = await screen.findByTestId("toggle-live", {}, { timeout: 5000 }).catch(() => null);
    if (toggle) await waitFor(() => expect(toggle).not.toBeVisible());
  });

  it("a person's page offers no impersonation", async () => {
    at("/admin/users/:id", <UserDetailPage />, "/admin/users/user-2");
    await screen.findAllByRole("heading");
    await waitFor(() => expect(screen.queryByTestId("impersonate")).not.toBeInTheDocument());
  });

  it("the Data Explorer offers no saved searches", async () => {
    at("/explore", <DataExplorerPage />);
    await screen.findAllByRole("heading");
    await waitFor(() => expect(screen.queryByRole("button", { name: /Saved searches/ })).not.toBeInTheDocument());
  });

  it("there is no timer pill", async () => {
    renderWithProviders(<TimerPill />);
    await waitFor(() => expect(screen.queryByTestId("timer-pill")).not.toBeInTheDocument());
  });

  it("a widget whose feature is off says so", async () => {
    const widget = { id: "w", kind: "MAP", title: "Map", config: {} } as unknown as DashboardWidget;
    renderWithProviders(<WidgetBody widget={widget} period="30d" catalogue={undefined} resources={[]} />);
    expect(await screen.findByText("This widget's feature is switched off.")).toBeInTheDocument();
  });
});
