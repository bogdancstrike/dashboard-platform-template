import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import AuditExplorerPage from "@/pages/AuditExplorerPage";
import { CommandProvider } from "@/commands/CommandContext";
import { auditPage } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

function renderPage(route = "/admin/audit") {
  return renderWithProviders(
    <CommandProvider>
      <AuditExplorerPage />
    </CommandProvider>,
    { route },
  );
}

describe("the audit explorer", () => {
  it("shows who did what, when and to which record", async () => {
    renderPage();

    expect(await screen.findByText("Mara Manager")).toBeInTheDocument();
    expect(screen.getByText("TIC-00042")).toBeInTheDocument();
    expect(screen.getByText("Update")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
    expect(screen.getByTestId("audit-total")).toHaveTextContent("2 entries");
  });

  it("names both identities when somebody acted while impersonating", async () => {
    renderPage();

    // §21: "Uma did this" and "Ada did this while acting as Uma" are different
    // facts, and only one of them is true.
    const badge = await screen.findByTestId("impersonated");
    expect(badge).toHaveTextContent("via Ada Administrator");
    expect(screen.getByText("Uma User")).toBeInTheDocument();
  });

  it("asks the server to filter rather than narrowing the page it holds", async () => {
    const user = userEvent.setup();
    let requestedAction: string | null = null;
    server.use(
      http.get("/platform/admin/audit", ({ request }) => {
        requestedAction = new URL(request.url).searchParams.get("action");
        return HttpResponse.json(auditPage([]));
      }),
    );

    renderPage();
    // By role, because the table also has a column headed "Action".
    await user.click(await screen.findByRole("combobox", { name: "Action" }));
    await user.click(await screen.findByTitle("Delete"));

    await waitFor(() => expect(requestedAction).toBe("DELETE"));
  });

  it("opens an entry and shows the before → after diff field by field", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText("TIC-00042"));

    const diff = await screen.findByRole("table", { name: "Field changes" });
    const rows = within(diff).getAllByRole("row");
    expect(rows.length).toBeGreaterThan(3);
    expect(within(diff).getByText("OPEN")).toBeInTheDocument();
    expect(within(diff).getByText("CLOSED")).toBeInTheDocument();
  });

  it("distinguishes a field that was added from one that was cleared", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText("TIC-00042"));
    const diff = await screen.findByRole("table", { name: "Field changes" });

    // Both sides render as "nothing" without this: one is a value removed, the
    // other a value that was never there.
    expect(within(diff).getByText("cleared")).toBeInTheDocument();
    expect(within(diff).getByText("added")).toBeInTheDocument();
    expect(within(diff).getByText("changed")).toBeInTheDocument();
    expect(within(diff).getAllByLabelText("no value").length).toBe(2);
  });

  it("puts the open entry in the URL so an investigation can be pasted", async () => {
    renderPage("/admin/audit?entry=audit-1");

    // Straight to the drawer, no clicking: the deep link is the point (§69).
    expect(await screen.findByText("Audit entry")).toBeInTheDocument();
    expect(await screen.findByRole("table", { name: "Field changes" })).toBeInTheDocument();
  });

  it("says which permission is missing rather than showing an empty table", async () => {
    server.use(
      http.get("/platform/admin/audit", () =>
        HttpResponse.json(
          {
            error: "forbidden",
            message: "You do not have permission to perform this action.",
            details: { missing: ["audit.view"], missing_labels: ["View audit logs"] },
          },
          { status: 403 },
        ),
      ),
    );

    renderPage();

    expect(
      await screen.findByText("You do not have permission to read the audit log"),
    ).toBeInTheDocument();
    expect(screen.getByText(/View audit logs/)).toBeInTheDocument();
  });

  it("offers the empty state when a filter matches nothing", async () => {
    server.use(http.get("/platform/admin/audit", () => HttpResponse.json(auditPage([]))));

    renderPage("/admin/audit?action=DELETE");

    expect(await screen.findByText("No records match these filters")).toBeInTheDocument();
  });
});
