import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import RolesPage from "@/pages/RolesPage";
import { CommandProvider } from "@/commands/CommandContext";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

function renderPage() {
  return renderWithProviders(
    <CommandProvider>
      <RolesPage />
    </CommandProvider>,
    { route: "/admin/roles" },
  );
}

describe("the permission matrix", () => {
  it("shows every permission the code checks for, grouped", async () => {
    renderPage();

    expect(await screen.findByText("View records")).toBeInTheDocument();
    expect(screen.getByText("Manage roles")).toBeInTheDocument();
    // Groups are headings inside the table, so the columns stay aligned.
    expect(screen.getByText("Records")).toBeInTheDocument();
    expect(screen.getByText("Administration")).toBeInTheDocument();
  });

  it("names each role, who holds it, and which one is yours", async () => {
    renderPage();

    // `getAllBy…`: a table with fixed columns renders its header twice, and
    // that is AntD's business rather than something to assert about.
    expect((await screen.findAllByText("Administrator")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("42 people").length).toBeGreaterThan(0);
    expect(screen.getAllByText("3 people").length).toBeGreaterThan(0);
    // Editing your own permissions is the edit most likely to be an accident.
    expect(screen.getAllByText("yours").length).toBeGreaterThan(0);
  });

  it("says which roles have drifted from the shipped defaults", async () => {
    renderPage();

    expect(
      await screen.findByText("Some roles differ from the permissions this platform ships with"),
    ).toBeInTheDocument();
  });

  it("stages a change instead of firing a write per click (§73)", async () => {
    const user = userEvent.setup();
    let writes = 0;
    server.use(
      http.put("/platform/admin/roles/:code", () => {
        writes += 1;
        return HttpResponse.json({});
      }),
    );

    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: "Viewer: View audit logs" }));

    // Nothing has been written to the authorization model yet.
    expect(writes).toBe(0);
    expect(await screen.findByTestId("save-roles")).toHaveTextContent("Save 1 change");
  });

  it("applies staged changes once, per role, on confirmation", async () => {
    const user = userEvent.setup();
    const writes: { code: string; permissions: string[] }[] = [];
    server.use(
      http.put("/platform/admin/roles/:code", async ({ request, params }) => {
        const body = (await request.json()) as { permissions: string[] };
        writes.push({ code: String(params["code"]), permissions: body.permissions });
        return HttpResponse.json({});
      }),
    );

    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: "Viewer: View audit logs" }));
    await user.click(screen.getByTestId("save-roles"));
    await user.click(await screen.findByRole("button", { name: "Apply" }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.code).toBe("VIEWER");
    // The whole intended set, not a delta: the server stores what a role grants.
    expect(writes[0]!.permissions).toEqual(["audit.view", "records.view"]);
  });

  it("discards staged changes without touching the server", async () => {
    const user = userEvent.setup();
    renderPage();

    const cell = await screen.findByRole("checkbox", { name: "Viewer: View audit logs" });
    await user.click(cell);
    await user.click(screen.getByRole("button", { name: /Discard/ }));

    expect(screen.getByRole("checkbox", { name: "Viewer: View audit logs" })).not.toBeChecked();
    expect(screen.getByTestId("save-roles")).toBeDisabled();
  });

  it("will not let you remove your own ability to administer roles", async () => {
    renderPage();

    // The change that cannot be undone from inside the application. The server
    // refuses it too; this is so nobody has to find that out by trying.
    const own = await screen.findByRole("checkbox", { name: "Administrator: Manage roles" });
    expect(own).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: "Administrator: View records" }),
    ).toBeEnabled();
  });

  it("filters the permissions without losing the columns", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText("Filter permissions"), "audit");

    await waitFor(() => expect(screen.queryByText("Manage roles")).toBeNull());
    expect(screen.getByText("View audit logs")).toBeInTheDocument();
    // A group whose permissions all filtered away is not left as an empty heading.
    expect(screen.queryByText("Administration")).toBeNull();
  });

  it("says which permission is missing rather than showing an empty grid", async () => {
    server.use(
      http.get("/platform/admin/roles", () =>
        HttpResponse.json(
          {
            error: "forbidden",
            message: "refused",
            details: { missing: ["roles.manage"], missing_labels: ["Manage roles"] },
          },
          { status: 403 },
        ),
      ),
    );

    renderPage();

    expect(
      await screen.findByText("You do not have permission to administer roles"),
    ).toBeInTheDocument();
  });

  it("counts how much of a group each role holds", async () => {
    renderPage();

    const heading = await screen.findByText("Records");
    const row = heading.closest("tr")!;
    // The Administrator has both Records permissions; the Viewer has one.
    expect(within(row).getByText("2/2")).toBeInTheDocument();
    expect(within(row).getByText("1/2")).toBeInTheDocument();
  });
});
