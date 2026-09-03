import { QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AuthProvider } from "@/auth/AuthProvider";
import { CommandProvider } from "@/commands/CommandContext";
import { server } from "@/test/server";
import { currentUser } from "@/test/handlers";
import { makeQueryClient } from "@/test/render";
import { AppearanceProvider } from "@/theme/AppearanceProvider";
import { AppShell } from "./AppShell";

function renderShell(route = "/dashboard") {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <AppearanceProvider>
        <AntApp>
          <AuthProvider>
            <MemoryRouter initialEntries={[route]}>
              <CommandProvider>
                <Routes>
                  <Route element={<AppShell />}>
                    <Route path="dashboard" element={<div>Dashboard content</div>} />
                    <Route path="admin" element={<div>Admin content</div>} />
                  </Route>
                </Routes>
              </CommandProvider>
            </MemoryRouter>
          </AuthProvider>
        </AntApp>
      </AppearanceProvider>
    </QueryClientProvider>,
  );
}

describe("authenticated application shell", () => {
  it("shows the signed-in profile instead of Guest", async () => {
    const user = userEvent.setup();
    renderShell();

    const profileTrigger = document.querySelector(".nu-user") as HTMLElement;
    await user.click(profileTrigger);
    expect(await screen.findByText("Administrator · Northwind Partners")).toBeInTheDocument();
    expect(screen.queryByText("Guest")).not.toBeInTheDocument();
  });

  it("hides forbidden navigation and blocks its deep link", async () => {
    server.use(
      http.get("/platform/api/me", () =>
        HttpResponse.json({
          ...currentUser,
          user: { ...currentUser.user, full_name: "Uma User", username: "user" },
          role: { ...currentUser.role, code: "VIEWER", name: "Viewer" },
          permissions: ["records.view"],
        }),
      ),
    );

    renderShell("/admin");

    expect(await screen.findByText("Permission required")).toBeInTheDocument();
    expect(screen.getByText("Your role does not include admin.access.")).toBeInTheDocument();
    expect(screen.queryByText("Administration")).not.toBeInTheDocument();
    expect(screen.queryByText("Admin content")).not.toBeInTheDocument();
  });
});
