import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import LogsPage from "@/pages/admin/LogsPage";
import { currentUser, resetLogs } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * The log viewer's remaining paths (§13): applying the retention policy, a
 * tail that stops when it cannot read, a line that cannot be opened, an empty
 * search, and the viewer failing to load.
 */
function render(route = "/admin/logs") {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/logs" element={<LogsPage />} />
    </Routes>,
    { route },
  );
}

function withPermissions(...extra: string[]) {
  server.use(
    http.get("/platform/api/me", () =>
      HttpResponse.json({ ...currentUser, permissions: [...currentUser.permissions, "logs.view", ...extra] }),
    ),
  );
}

afterEach(() => resetLogs());

describe("the retention policy", () => {
  it("applies it after asking, and says how much went", async () => {
    const user = userEvent.setup();
    withPermissions("settings.manage");
    render();
    const prune = await screen.findByTestId("prune-logs");
    await user.click(prune);
    await user.click(await screen.findByRole("button", { name: "Apply the policy" }));
    expect(await screen.findByText("4 lines older than 30 days removed.")).toBeInTheDocument();
  });

  it("says when nothing was old enough, and a refusal in the server's words", async () => {
    const user = userEvent.setup();
    withPermissions("settings.manage");
    server.use(http.post("/platform/admin/logs/prune", () => HttpResponse.json({ removed: 0, retention_days: 30, kept: 9 })));
    render();
    const prune = await screen.findByTestId("prune-logs");
    await user.click(prune);
    await user.click(await screen.findByRole("button", { name: "Apply the policy" }));
    expect(await screen.findByText("Nothing was older than 30 days.")).toBeInTheDocument();

    server.use(http.post("/platform/admin/logs/prune", () => HttpResponse.json({ error: "forbidden", message: "Only the owner of retention may apply it." }, { status: 403 })));
    await user.click(screen.getByTestId("prune-logs"));
    const confirms = await screen.findAllByRole("button", { name: "Apply the policy" });
    await user.click(confirms[confirms.length - 1]!);
    expect(await screen.findByText("Only the owner of retention may apply it.")).toBeInTheDocument();
  });
});

describe("the live tail", () => {
  it("stops and says so when a poll cannot be read", async () => {
    const user = userEvent.setup();
    withPermissions();
    server.use(http.get("/platform/admin/logs/tail", () => HttpResponse.json({ error: "unavailable", message: "The log store is not answering." }, { status: 503 })));
    render();
    await screen.findByTestId("log-table");
    await user.click(screen.getByTestId("toggle-live"));
    expect(await screen.findByText("The log store is not answering.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("toggle-live")).toHaveTextContent("Live"));
  });
});

describe("one line", () => {
  it("says a line could not be read", async () => {
    const user = userEvent.setup();
    withPermissions();
    server.use(
      http.get("/platform/admin/logs/:id", ({ params }) =>
        // The catalogue and the tail share the pattern; only a line is refused.
        ["catalogue", "tail"].includes(String(params["id"]))
          ? undefined
          : HttpResponse.json({ error: "not_found", message: "That line has been pruned." }, { status: 404 }),
      ),
    );
    render();
    const table = await screen.findByTestId("log-table");
    const rows = within(table).getAllByRole("row").slice(1);
    await user.click(rows[0]!);
    expect(await screen.findByText("That line has been pruned.")).toBeInTheDocument();
  });
});

describe("searching and failing", () => {
  it("says no line matches a search", async () => {
    const user = userEvent.setup();
    withPermissions();
    render();
    await screen.findByTestId("log-table");
    await user.type(screen.getByLabelText("Search the log"), "ζζζ-nothing{Enter}");
    expect(await screen.findByText("No line matches that.")).toBeInTheDocument();
  });

  it("says the log could not be read", async () => {
    withPermissions();
    server.use(http.get("/platform/admin/logs/catalogue", () => HttpResponse.json({ error: "forbidden", message: "Logs are for operators." }, { status: 403 })));
    render();
    expect(await screen.findByText("Logs are for operators.")).toBeInTheDocument();
  });
});
