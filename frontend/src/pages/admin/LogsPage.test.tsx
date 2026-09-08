import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import LogsPage, { paceOf, toneFor } from "@/pages/admin/LogsPage";
import { CommandProvider } from "@/commands/CommandContext";
import { currentUser, logRows, resetLogs } from "@/test/handlers";
import { server } from "@/test/server";
import { renderWithProviders } from "@/test/render";

/**
 * The system log viewer (§22).
 *
 * Two pure rules are stated exactly — the tone a level earns and the name a
 * duration earns — and the rest is asserted through the page, because the
 * behaviours that matter are behaviours: that the level strip is a severity
 * *floor* rather than a set of toggles, that a line opens onto its whole
 * request, and that the live tail can be paused and resumed without repeating
 * a line or missing one.
 */
function render(route = "/admin/logs") {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/admin/logs" element={<LogsPage />} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

function withPermissions(...extra: string[]) {
  server.use(
    http.get("/platform/api/me", () =>
      HttpResponse.json({
        ...currentUser,
        permissions: [...currentUser.permissions, "logs.view", ...extra],
      }),
    ),
  );
}

afterEach(() => {
  resetLogs();
});

describe("what a level and a duration are called", () => {
  it("gives the two levels that mean trouble the same tone", () => {
    // A reader scanning for failures should not have to learn that CRITICAL is
    // a different colour from ERROR.
    expect(toneFor("ERROR")).toBe("error");
    expect(toneFor("CRITICAL")).toBe("error");
    expect(toneFor("WARNING")).toBe("warning");
    expect(toneFor("INFO")).toBe("success");
    // Debug gets none: it is the level that is *not* worth marking.
    expect(toneFor("DEBUG")).toBeUndefined();
  });

  it("names a duration so an outlier announces itself", () => {
    expect(paceOf(null)).toBe("unknown");
    expect(paceOf(12)).toBe("quick");
    expect(paceOf(400)).toBe("fine");
    expect(paceOf(2410)).toBe("slow");
    // The boundary, stated: a second is the line, and 999ms is not over it.
    expect(paceOf(1000)).toBe("slow");
    expect(paceOf(999)).toBe("fine");
  });
});

describe("the log table", () => {
  it("lists the lines, newest first", async () => {
    withPermissions();
    render();

    const table = await screen.findByTestId("log-table");
    await waitFor(() =>
      expect(within(table).getByText(/cache miss for dashboard/)).toBeInTheDocument(),
    );

    // The fixture's newest line is the DEBUG one at :11.
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("cache miss for dashboard:kpi");
  });

  it("spells the level out as well as colouring it (§64)", async () => {
    withPermissions();
    render();

    const table = await screen.findByTestId("log-table");
    await waitFor(() => expect(within(table).getByText("error")).toBeInTheDocument());
    // The word is in the cell — a reader with no colour vision reads the same
    // table.
    expect(within(table).getByText("warning")).toBeInTheDocument();
    expect(within(table).getAllByText("info").length).toBeGreaterThan(0);
  });

  it("says how long a request took, and marks the slow one", async () => {
    withPermissions();
    render();

    const table = await screen.findByTestId("log-table");
    await waitFor(() => expect(within(table).getByText("2,410 ms")).toBeInTheDocument());
    expect(within(table).getByText("19 ms")).toBeInTheDocument();
  });

  it("says what the retention policy is, from the setting", async () => {
    withPermissions();
    render();

    // Not a number typed into the page: a viewer claiming "kept for 30 days"
    // while the setting said 90 would be lying about its own data.
    expect(await screen.findByText("kept 30 days")).toBeInTheDocument();
  });
});

describe("the level strip is a severity floor", () => {
  it("offers every level, including the ones at nought", async () => {
    withPermissions();
    render();

    const strip = await screen.findByTestId("log-levels");
    for (const level of ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]) {
      expect(within(strip).getByTestId(`log-level-${level}`)).toBeInTheDocument();
    }
    // CRITICAL has no lines in the fixture and is still offered — a chip that
    // appeared only once something broke is one people stop looking for.
    expect(within(strip).getByTestId("log-level-CRITICAL")).toHaveTextContent("0");
  });

  it("says 'and worse' on the chip, because that is what it does", async () => {
    withPermissions();
    render();

    const strip = await screen.findByTestId("log-levels");
    expect(within(strip).getByTestId("log-level-WARNING")).toHaveTextContent("and worse");
    // Except the top one, where there is nothing worse.
    expect(within(strip).getByTestId("log-level-CRITICAL")).not.toHaveTextContent("and worse");
  });

  it("asks the server for a floor, and gets errors *and* criticals", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    await screen.findByTestId("log-levels");
    await user.click(screen.getByTestId("log-level-WARNING"));

    const table = await screen.findByTestId("log-table");
    await waitFor(() =>
      expect(within(table).queryByText(/cache miss/)).not.toBeInTheDocument(),
    );
    // The WARNING line and the ERROR line both survive the "warning" filter,
    // which is the whole point of a floor.
    expect(within(table).getByText(/nonesuch/)).toBeInTheDocument();
    expect(within(table).getByText(/records\/order → 500/)).toBeInTheDocument();
  });

  it("puts the floor in the address, so the question survives a reload (§69)", async () => {
    withPermissions();
    render("/admin/logs?min_level=ERROR");

    const strip = await screen.findByTestId("log-levels");
    expect(within(strip).getByTestId("log-level-ERROR")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const table = await screen.findByTestId("log-table");
    await waitFor(() =>
      expect(within(table).queryByText(/nonesuch/)).not.toBeInTheDocument(),
    );
  });
});

describe("finding one request", () => {
  it("finds a request by the correlation id from its own response", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    await screen.findByTestId("log-table");
    // The whole reason the column exists: paste the id off an error screen.
    await user.type(screen.getByLabelText("Search the log"), "shared-request");

    await waitFor(() =>
      expect(screen.queryByText(/cache miss/)).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/records\/order → 500/)).toBeInTheDocument();
  });
});

describe("one line's detail", () => {
  it("opens onto the request, its context and its stack trace", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("log-table");
    await waitFor(() => expect(within(table).getByText(/order → 500/)).toBeInTheDocument());
    await user.click(within(table).getByText(/order → 500/));

    expect(await screen.findByTestId("line-context")).toHaveTextContent("/api/me");
    expect(screen.getByTestId("line-trace")).toHaveTextContent("Traceback");
  });

  it("carries the other lines from the same request", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("log-table");
    await waitFor(() => expect(within(table).getByText(/order → 500/)).toBeInTheDocument());
    await user.click(within(table).getByText(/order → 500/));

    // One failure is rarely one line, and the sibling is the half that says
    // what was being attempted.
    const related = await screen.findByTestId("line-related");
    expect(within(related).getByText(/order → in/)).toBeInTheDocument();
  });

  it("says so plainly when a line belongs to no request", async () => {
    withPermissions();
    const user = userEvent.setup();
    // A line with no correlation id, which must not be "related" to every
    // other line that also has none.
    logRows.push({
      ...logRows[0]!,
      id: "log-orphan",
      correlation_id: null,
      message: "a line from nowhere",
      logged_at: "2026-09-08T11:00:00Z",
      has_stack_trace: false,
    });
    render();

    const table = await screen.findByTestId("log-table");
    await waitFor(() =>
      expect(within(table).getByText("a line from nowhere")).toBeInTheDocument(),
    );
    await user.click(within(table).getByText("a line from nowhere"));

    expect(
      await screen.findByText(/carries no correlation id/),
    ).toBeInTheDocument();
  });

  it("walks from one line to a sibling without closing the pane", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("log-table");
    await waitFor(() => expect(within(table).getByText(/order → 500/)).toBeInTheDocument());
    await user.click(within(table).getByText(/order → 500/));

    const related = await screen.findByTestId("line-related");
    await user.click(within(related).getByText(/order → in/));

    // The pane is now showing the sibling, whose own siblings include the one
    // we came from.
    await waitFor(() =>
      expect(screen.getByTestId("line-related")).toHaveTextContent("order → 500"),
    );
  });
});

describe("the live tail", () => {
  it("starts paused, because a page that moves while you read it is unreadable", async () => {
    withPermissions();
    render();

    await screen.findByTestId("log-table");
    expect(screen.getByTestId("toggle-live")).toHaveTextContent("Live");
    expect(screen.queryByTestId("live-banner")).not.toBeInTheDocument();
  });

  it("says it is following, and how much has arrived", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    await screen.findByTestId("log-table");
    await user.click(screen.getByTestId("toggle-live"));

    const banner = await screen.findByTestId("live-banner");
    await waitFor(() => expect(banner).toHaveTextContent(/lines since you started/));
    expect(screen.getByTestId("toggle-live")).toHaveTextContent("Pause");
  });

  it("never shows the same line twice", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    await screen.findByTestId("log-table");
    await user.click(screen.getByTestId("toggle-live"));

    const table = await screen.findByTestId("log-table");
    await waitFor(() =>
      expect(within(table).getByText(/cache miss for dashboard/)).toBeInTheDocument(),
    );
    // The tail's cursor is what makes this hold: a poll that asked for
    // everything each time would double the table every few seconds.
    expect(within(table).getAllByText(/cache miss for dashboard/)).toHaveLength(1);
  });

  it("hides the pager while following, because the stream has no page 2", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    await screen.findByTestId("log-table");
    expect(screen.getByText(/lines$/)).toBeInTheDocument();

    await user.click(screen.getByTestId("toggle-live"));
    await screen.findByTestId("live-banner");
    await waitFor(() => expect(screen.queryByText(/^\d+ lines$/)).not.toBeInTheDocument());
  });
});

describe("applying the retention policy", () => {
  it("is not offered to a reader who may not change the bound (§76)", async () => {
    withPermissions();
    render();

    await screen.findByTestId("log-table");
    // Absent rather than disabled: the button belongs to whoever owns the
    // setting, and this reader has `logs.view` alone.
    expect(screen.queryByTestId("prune-logs")).not.toBeInTheDocument();
  });

  it("is offered to somebody who owns it, and says what it will do", async () => {
    withPermissions("settings.manage");
    const user = userEvent.setup();
    render();

    await screen.findByTestId("log-table");
    await user.click(await screen.findByTestId("prune-logs"));

    // The bound is named before it is applied, and named as the *setting*.
    expect(await screen.findByText(/older than 30 days/)).toBeInTheDocument();
    expect(screen.getByText(/not a choice made here/)).toBeInTheDocument();
  });
});
