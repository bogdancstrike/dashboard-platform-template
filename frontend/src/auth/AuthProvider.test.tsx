import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppearanceProvider } from "@/theme/AppearanceProvider";
import { makeQueryClient } from "@/test/render";
import { AuthProvider, useAuth, usePermission } from "./AuthProvider";

function Probe() {
  const auth = useAuth();
  const mayAdminister = usePermission("admin.access");
  const mayDelete = usePermission("records.delete");
  return (
    <div>
      <span>{auth.profile?.user.full_name ?? "loading"}</span>
      <span>{auth.profile?.organization?.name}</span>
      <span>{mayAdminister ? "admin-yes" : "admin-no"}</span>
      <span>{mayDelete ? "delete-yes" : "delete-no"}</span>
    </div>
  );
}

describe("authenticated profile state", () => {
  it("loads /api/me and answers permission checks from its live response", async () => {
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <AppearanceProvider>
          <AuthProvider>
            <Probe />
          </AuthProvider>
        </AppearanceProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Ada Administrator")).toBeInTheDocument();
    expect(screen.getByText("Northwind Partners")).toBeInTheDocument();
    expect(screen.getByText("admin-yes")).toBeInTheDocument();
    expect(screen.getByText("delete-no")).toBeInTheDocument();
  });
});
