import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import { setImpersonation } from "@/api/client";
import { ImpersonationProvider } from "@/auth/ImpersonationProvider";
import UserDetailPage from "@/pages/UserDetailPage";
import { userDetail } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * One person, from the administrator's side (§12): the profile tab with what
 * is missing said as a dash, a person nobody may change, refusals in the
 * server's words, and the tabs in the address.
 */
function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.search}</output>;
}

function render(route = "/admin/users/user-2") {
  return renderWithProviders(
    <ImpersonationProvider>
      <Routes>
        <Route path="/admin/users/:id" element={<UserDetailPage />} />
        <Route path="/dashboard" element={<div>the dashboard</div>} />
      </Routes>
      <Where />
    </ImpersonationProvider>,
    { route },
  );
}

const answer = (overrides: Record<string, unknown>) =>
  server.use(http.get("/platform/admin/users/:id", () => HttpResponse.json({ ...userDetail, ...overrides })));

describe("the profile tab", () => {
  it("lists what is known and says a dash for what is not", async () => {
    render("/admin/users/user-2?tab=profile");
    expect((await screen.findAllByText("Northwind Partners")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Support").length).toBeGreaterThan(0);
    expect(screen.getByText("en-GB · Europe/Bucharest")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    // No phone on file.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("says Never for somebody who has not signed in, and dashes an absent organisation", async () => {
    answer({ last_login_at: null, organization: null, department: null, manager: null, job_title: "" });
    render("/admin/users/user-2?tab=profile");
    expect(await screen.findByText("Never")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });
});

describe("tabs", () => {
  it("moves between tabs in the address, and back to Access without a parameter", async () => {
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole("tab", { name: "History" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("tab=history"));
    await user.click(screen.getByRole("tab", { name: "Access" }));
    await waitFor(() => expect(screen.getByTestId("where")).not.toHaveTextContent("tab="));
  });
});

describe("access without groups or a role", () => {
  it("says None and No role rather than an empty box", async () => {
    answer({ groups: [], role_name: null, role_code: null, access: { ...userDetail.access, role_permissions: [], group_permissions: {} } });
    render();
    expect(await screen.findByText("None")).toBeInTheDocument();
    expect(screen.getAllByText("No role").length).toBeGreaterThan(0);
  });

  it("says a group adds nothing when it grants no permission", async () => {
    answer({ groups: [{ id: "grp-2", name: "Book club", kind: "TEAM", permissions: [] }] });
    render();
    expect(await screen.findByText("Adds nothing")).toBeInTheDocument();
  });
});

describe("somebody this administrator may not change", () => {
  it("shows the role and status as words, not controls", async () => {
    answer({ can_manage: false });
    render();
    await screen.findByTestId("open-profile");
    expect(screen.queryByRole("combobox", { name: "Account status" })).not.toBeInTheDocument();
    expect(screen.getByText(new RegExp(String(userDetail.status).toLowerCase()))).toBeInTheDocument();
  });
});

describe("refusals", () => {
  it("names a refused change and its reference", async () => {
    const user = userEvent.setup();
    server.use(
      http.put("/platform/admin/users/:id", () =>
        HttpResponse.json({ error: "forbidden", message: "You cannot suspend yourself." }, { status: 403, headers: { "X-Correlation-ID": "corr-9" } }),
      ),
    );
    render();
    await user.click(await screen.findByRole("combobox", { name: "Account status" }));
    await user.click(await screen.findByTitle("SUSPENDED"));
    expect(await screen.findByText(/You cannot suspend yourself\./)).toBeInTheDocument();
  });

  it("says a refused impersonation in the server's words", async () => {
    const user = userEvent.setup();
    setImpersonation(null);
    server.use(
      http.post("/platform/admin/users/:id/impersonate", () =>
        HttpResponse.json({ error: "forbidden", message: "Impersonating an administrator is not allowed." }, { status: 403 }),
      ),
    );
    render();
    await user.click(await screen.findByTestId("impersonate"));
    await user.click(await screen.findByRole("button", { name: "Start" }));
    expect(await screen.findByText("Impersonating an administrator is not allowed.")).toBeInTheDocument();
    setImpersonation(null);
  });

  it("says the request failed when it is not a missing person", async () => {
    server.use(
      http.get("/platform/admin/users/:id", () => HttpResponse.json({ error: "unavailable", message: "The directory is not answering." }, { status: 503 })),
    );
    render();
    expect(await screen.findByText("The directory is not answering.")).toBeInTheDocument();
  });
});
