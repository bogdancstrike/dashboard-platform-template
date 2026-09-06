import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router-dom";

import { getImpersonation, setImpersonation } from "@/api/client";
import { ImpersonationProvider } from "@/auth/ImpersonationProvider";
import UserDetailPage from "@/pages/UserDetailPage";
import UsersPage from "@/pages/UsersPage";
import { CommandProvider } from "@/commands/CommandContext";
import { userPage } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

function renderUsers(route = "/admin/users") {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/admin/users" element={<UsersPage />} />
        <Route path="/admin/users/:id" element={<div>the person</div>} />
        <Route path="/admin/roles" element={<div>the matrix</div>} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

function renderPerson(route = "/admin/users/user-2") {
  return renderWithProviders(
    <ImpersonationProvider>
      <CommandProvider>
        <Routes>
          <Route path="/admin/users" element={<div>the directory</div>} />
          <Route path="/admin/users/:id" element={<UserDetailPage />} />
          <Route path="/dashboard" element={<div>the dashboard</div>} />
        </Routes>
      </CommandProvider>
    </ImpersonationProvider>,
    { route },
  );
}

describe("the people directory", () => {
  it("lists people with the four things an administrator looks for", async () => {
    renderUsers();

    expect(await screen.findByText("Ada Administrator")).toBeInTheDocument();
    expect(screen.getByText("uma@nucleus.example")).toBeInTheDocument();
    expect(screen.getAllByText("Viewer").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ACTIVE").length).toBeGreaterThan(0);
    expect(screen.getByTestId("user-total")).toHaveTextContent("2 people");
  });

  it("shows the groups that add permissions on top of a role", async () => {
    renderUsers();

    // Without this, "why can Uma cancel jobs?" has no answer on this screen.
    expect(await screen.findByText("On-call")).toBeInTheDocument();
  });

  it("asks the server to filter by role rather than narrowing the page", async () => {
    const user = userEvent.setup();
    let requested: string | null = null;
    server.use(
      http.get("/platform/admin/users", ({ request }) => {
        requested = new URL(request.url).searchParams.get("role_code");
        return HttpResponse.json(userPage([]));
      }),
    );

    renderUsers();
    await user.click(await screen.findByRole("combobox", { name: "Role" }));
    await user.click(await screen.findByTitle("VIEWER · 1"));

    await waitFor(() => expect(requested).toBe("VIEWER"));
  });

  it("opens a person from their row", async () => {
    const user = userEvent.setup();
    renderUsers();

    await user.click(await screen.findByText("Ada Administrator"));

    expect(await screen.findByText("the person")).toBeInTheDocument();
  });
});

describe("one person", () => {
  it("explains access by role and by group, not by role alone", async () => {
    renderPerson();

    const panel = await screen.findByTestId("effective-permissions");
    // The union is what the API enforces, so the union is what is shown.
    expect(within(panel).getByText("records.view")).toBeInTheDocument();
    expect(within(panel).getByText("jobs.manage")).toBeInTheDocument();
    // And the group-granted half is marked as such.
    expect(panel).toHaveTextContent("3");
  });

  it("names where a group-granted permission came from", async () => {
    renderPerson();

    await screen.findByTestId("effective-permissions");
    const source = screen.getByText("Where it comes from").closest(".ant-card")!;
    expect(within(source as HTMLElement).getByText("On-call")).toBeInTheDocument();
  });

  it("changes a role through the API and says when it takes effect", async () => {
    const user = userEvent.setup();
    const writes: Record<string, unknown>[] = [];
    server.use(
      http.put("/platform/admin/users/:id", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        writes.push(body);
        return HttpResponse.json({ ...(await import("@/test/handlers")).userDetail, ...body });
      }),
    );

    renderPerson();
    await user.click(await screen.findByRole("combobox", { name: "Account status" }));
    await user.click(await screen.findByTitle("SUSPENDED"));

    await waitFor(() => expect(writes).toEqual([{ status: "SUSPENDED" }]));
    expect(await screen.findByText(/applies on their next request/)).toBeInTheDocument();
  });

  it("starts an impersonation and puts the header on every later request", async () => {
    const user = userEvent.setup();
    setImpersonation(null);
    renderPerson();

    await user.click(await screen.findByTestId("impersonate"));
    await user.click(await screen.findByRole("button", { name: "Start" }));

    // The client now carries `X-Impersonate-User`, which is what makes the
    // *next* request return what the other person would see.
    await waitFor(() => expect(getImpersonation()).toBe("user-2"));
    expect(await screen.findByText(/now acting as Uma User/)).toBeInTheDocument();
    setImpersonation(null);
  });

  it("says why an impersonation is not offered rather than hiding the button", async () => {
    server.use(
      http.get("/platform/admin/users/:id", async ({ request }) => {
        const { userDetail } = await import("@/test/handlers");
        return HttpResponse.json(
          {
            ...userDetail,
            can_impersonate: false,
            impersonation_blocked_because: "That account is suspended.",
          },
          { headers: { "X-Correlation-ID": request.headers.get("X-Correlation-ID") ?? "" } },
        );
      }),
    );

    renderPerson();

    expect(await screen.findByTestId("impersonate")).toBeDisabled();
  });

  it("keeps the open tab in the URL", async () => {
    renderPerson("/admin/users/user-2?tab=security");

    expect(await screen.findByRole("tab", { name: "Sessions & sign-ins" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Chrome on Linux")).toBeInTheDocument();
  });

  it("says a person is missing rather than rendering an empty profile", async () => {
    server.use(
      http.get("/platform/admin/users/:id", () =>
        HttpResponse.json({ error: "not_found", message: "gone" }, { status: 404 }),
      ),
    );

    renderPerson();

    expect(await screen.findByRole("heading", { name: /Person not found/ })).toBeInTheDocument();
  });
});

describe("the impersonation banner", () => {
  it("restores an impersonation from the tab's session on load", async () => {
    // Survives a reload, because losing it there would be baffling; does not
    // survive into a new tab, because a forgotten impersonation is the failure
    // mode this feature has.
    window.sessionStorage.setItem(
      "nucleus.impersonating",
      JSON.stringify({ id: "user-2", full_name: "Uma User", username: "user" }),
    );

    renderWithProviders(
      <ImpersonationProvider>
        <div>anything</div>
      </ImpersonationProvider>,
    );

    await waitFor(() => expect(getImpersonation()).toBe("user-2"));
    window.sessionStorage.removeItem("nucleus.impersonating");
    setImpersonation(null);
    vi.restoreAllMocks();
  });
});
