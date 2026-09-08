import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router-dom";

import ExportsPage, { advice, situation, tone } from "@/pages/ExportsPage";
import type { ExportEstimate, ExportRow } from "@/api/exports";
import { CommandProvider } from "@/commands/CommandContext";
import { currentUser, exportRows, resetExports } from "@/test/handlers";
import { server } from "@/test/server";
import { renderWithProviders } from "@/test/render";

/**
 * Exports (§30).
 *
 * Two functions carry this page's whole argument, so both are asserted
 * directly rather than only through the DOM.
 *
 * `situation` is the mapping from six statuses and three derived flags onto
 * the four things a reader can actually do: wait, download, act, or nothing.
 * The row it must not lose is the *stalled* one — queued so long that nothing
 * is going to pick it up, which is what a restart mid-export leaves behind and
 * which looks exactly like "still running" unless the page says otherwise.
 *
 * `advice` is the decision the drawer makes before offering a button: a small
 * query should be a download and a large one a background job, and the row
 * count is what chooses. A page that queued a background job for forty rows
 * would be adding a step to something already instant.
 *
 * The other claim worth pinning: a dead download is never offered. Whether a
 * file exists depends on retention, on discarding, and on what is in object
 * storage — so `downloadable` arrives on the row and this page never
 * re-derives it.
 */
function render(route = "/exports") {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/exports" element={<ExportsPage />} />
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
        permissions: [...currentUser.permissions, "records.export", ...extra],
      }),
    ),
  );
}

afterEach(() => {
  resetExports();
  vi.restoreAllMocks();
});

const row = (overrides: Partial<ExportRow>): ExportRow =>
  ({
    id: "e",
    reference: "EXP-000001",
    name: "Tickets — CSV",
    status: "SUCCEEDED",
    resource_type: "ticket",
    format: "csv",
    description: "Tickets",
    columns: [],
    rows: 10,
    size_bytes: 100,
    checksum: null,
    requested_at: null,
    started_at: null,
    finished_at: null,
    duration_ms: null,
    progress: 100,
    attempt: 1,
    max_attempts: 1,
    error_message: null,
    ran_as: "greenlet",
    expires_at: null,
    expired: false,
    stalled: false,
    downloadable: true,
    has_file: true,
    log_lines: [],
    ...overrides,
  });

const estimateOf = (overrides: Partial<ExportEstimate>): ExportEstimate =>
  ({
    resource_type: "ticket",
    format: "csv",
    description: "Tickets",
    columns: [],
    rows: 100,
    maximum: 100_000,
    streams_up_to: 50_000,
    can_stream: true,
    can_queue: true,
    too_large: false,
    ...overrides,
  });

describe("what an export's row comes to", () => {
  it("keeps stalled apart from still running", () => {
    // The distinction this page exists for. Both leave somebody with no file,
    // and only one of them is worth waiting for.
    expect(situation(row({ status: "QUEUED", stalled: true, downloadable: false }))).toBe(
      "Stopped without finishing — nothing is going to pick it up",
    );
    expect(situation(row({ status: "RUNNING", downloadable: false }))).toBe("Being produced");
    expect(situation(row({ status: "QUEUED", downloadable: false }))).toBe("Waiting to start");
  });

  it("keeps expired apart from discarded, and both from failed", () => {
    // Three ways to have no file, and they call for different things: request
    // it again, request it again, and look at why it broke.
    expect(situation(row({ expired: true, downloadable: false }))).toContain("has gone");
    expect(situation(row({ downloadable: false }))).toContain("discarded");
    expect(situation(row({ status: "FAILED", downloadable: false }))).toBe("Failed");
  });

  it("says plainly when there is a file", () => {
    expect(situation(row({}))).toBe("Ready to download");
  });

  it("colours only what a reader has to act on or can take away", () => {
    // A list where every line is coloured is a list where the colour says
    // nothing (§64).
    expect(tone(row({}))).toBe("success");
    expect(tone(row({ status: "FAILED", downloadable: false }))).toBe("error");
    expect(tone(row({ status: "QUEUED", stalled: true, downloadable: false }))).toBe("warning");
    expect(tone(row({ status: "CANCELLED", downloadable: false }))).toBeUndefined();
    expect(tone(row({ expired: true, downloadable: false }))).toBeUndefined();
  });
});

describe("what to offer for a query of a given size", () => {
  it("offers the immediate download when it is small enough", () => {
    expect(advice(estimateOf({ rows: 1284 }))).toContain("small enough to download");
  });

  it("explains why a large one becomes a background export", () => {
    // Not merely "queued": the reason is the size, and saying so is what stops
    // it reading as an arbitrary extra step.
    const text = advice(estimateOf({ rows: 184_203, can_stream: false }));
    expect(text).toContain("184,203");
    expect(text).toContain("background export");
  });

  it("refuses above the installation's own ceiling, with the number", () => {
    const text = advice(
      estimateOf({ rows: 900_000, can_stream: false, can_queue: false, too_large: true }),
    );
    expect(text).toContain("100,000");
    expect(text).toContain("Narrow the query");
  });

  it("says so when nothing matches, rather than offering an empty file", () => {
    expect(advice(estimateOf({ rows: 0 }))).toBe("Nothing matches this query yet.");
  });
});

describe("the list", () => {
  it("says where each export stands, in words", async () => {
    withPermissions();
    render();

    const table = await screen.findByTestId("exports-table");
    await waitFor(() =>
      expect(within(table).getByText("Ready to download")).toBeInTheDocument(),
    );
    expect(within(table).getByText("Being produced")).toBeInTheDocument();
    expect(within(table).getByText(/nothing is going to pick it up/)).toBeInTheDocument();
  });

  it("leads with the stalled ones, because nothing else will deal with them", async () => {
    withPermissions();
    render();

    // The notice exists because the situation is the platform's own doing: the
    // work runs in the API process and a restart loses it.
    const notice = await screen.findByTestId("stalled-notice");
    expect(notice).toHaveTextContent("One export stopped without finishing");
    expect(notice).toHaveTextContent(/restart/);
  });

  it("offers a download only where there is a file", async () => {
    withPermissions();
    render();

    await screen.findByTestId("exports-table");
    expect(await screen.findByTestId("download-EXP-000101")).toBeInTheDocument();
    // Expired, failed and stalled rows get the action that can actually help.
    expect(screen.getByTestId("again-EXP-000105")).toBeInTheDocument();
    expect(screen.getByTestId("again-EXP-000103")).toBeInTheDocument();
    expect(screen.getByTestId("again-EXP-000104")).toBeInTheDocument();
    expect(screen.queryByTestId("download-EXP-000105")).not.toBeInTheDocument();
  });

  it("shows the row count of the file, and progress only while there is none", async () => {
    withPermissions();
    render();

    const table = await screen.findByTestId("exports-table");
    await waitFor(() => expect(within(table).getByText("1,284")).toBeInTheDocument());
    // A number for a file nobody has written is the defect this page was built
    // out of, so a running export shows progress instead.
    expect(table.querySelector(".nu-exp-progress")).not.toBeNull();
  });

  it("cannot discard something still being produced", async () => {
    withPermissions();
    render();

    await screen.findByTestId("exports-table");
    expect(await screen.findByTestId("discard-EXP-000102")).toBeDisabled();
    expect(screen.getByTestId("discard-EXP-000101")).toBeEnabled();
  });

  it("counts the statuses for the filter, from the catalogue", async () => {
    withPermissions();
    render();

    // The counts are of the whole list, not of what is on screen (§71).
    const filter = await screen.findByText(/^All \(5\)$/);
    expect(filter).toBeInTheDocument();
  });
});

describe("asking for one", () => {
  it("shows the row count before it offers a button", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    await screen.findByTestId("exports-table");
    await user.click(screen.getByTestId("new-export"));

    // The fact that chooses between the two actions, shown before either.
    const estimate = await screen.findByTestId("estimate");
    expect(estimate).toHaveTextContent("1,284 rows");
    expect(estimate).toHaveTextContent("small enough to download");
    expect(screen.getByTestId("queue-export")).toHaveTextContent("Export it");
  });

  it("says the ceilings the server enforces, not numbers of its own", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    await screen.findByTestId("exports-table");
    await user.click(screen.getByTestId("new-export"));

    // Read from the catalogue, which reads them from the settings table: a
    // page printing its own limits is a page that stops being true when an
    // administrator edits one.
    const limits = await screen.findByTestId("limits");
    expect(limits).toHaveTextContent("50,000");
    expect(limits).toHaveTextContent("100,000");
    expect(limits).toHaveTextContent("7 days");
  });

  it("changes the offer when the query is too large to stream", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    await screen.findByTestId("exports-table");
    await user.click(screen.getByTestId("new-export"));
    await screen.findByTestId("estimate");

    await user.click(screen.getByRole("combobox", { name: "Dataset" }));
    await user.click(await screen.findByTitle("Orders"));

    await waitFor(() =>
      expect(screen.getByTestId("estimate")).toHaveTextContent("184,203"),
    );
    // Same button, different promise: the size decided which.
    expect(screen.getByTestId("queue-export")).toHaveTextContent("Queue it");
  });

  it("refuses the button when the query is beyond the ceiling", async () => {
    withPermissions();
    server.use(
      http.post("/platform/exports/estimate", () =>
        HttpResponse.json({
          resource_type: "ticket",
          format: "csv",
          description: "Tickets",
          columns: [],
          rows: 900_000,
          maximum: 100_000,
          streams_up_to: 50_000,
          can_stream: false,
          can_queue: false,
          too_large: true,
        }),
      ),
    );
    const user = userEvent.setup();
    render();

    await screen.findByTestId("exports-table");
    await user.click(screen.getByTestId("new-export"));

    // Refused before it is pressed, with the reason beside it (§76).
    await waitFor(() => expect(screen.getByTestId("queue-export")).toBeDisabled());
    expect(screen.getByTestId("estimate")).toHaveTextContent("Narrow the query");
  });

  it("queues one and opens it, because the file is what comes next", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    await screen.findByTestId("exports-table");
    await user.click(screen.getByTestId("new-export"));
    await screen.findByTestId("estimate");
    await user.click(screen.getByTestId("queue-export"));

    await waitFor(() =>
      expect(exportRows.some((item) => item["reference"] === "EXP-000200")).toBe(true),
    );
    expect(await screen.findByTestId("export-detail")).toBeInTheDocument();
  });
});

describe("the file", () => {
  it("opens the signed URL rather than proxying the bytes", async () => {
    withPermissions();
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    const user = userEvent.setup();
    render();

    await screen.findByTestId("exports-table");
    await user.click(await screen.findByTestId("download-EXP-000101"));

    await waitFor(() => expect(opened).toHaveBeenCalled());
    // Object storage serves it, so a finished export never costs the API
    // worker a second time.
    expect(String(opened.mock.calls[0]?.[0])).toContain("storage.example");
  });

  it("discarding drops the file and keeps the row", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    await screen.findByTestId("exports-table");
    await user.click(await screen.findByTestId("discard-EXP-000101"));
    await user.click(await screen.findByRole("button", { name: "Discard the file" }));

    await waitFor(() => {
      const kept = exportRows.find((item) => item["id"] === "exp-ready");
      expect(kept).toBeTruthy();
      expect(kept?.["downloadable"]).toBe(false);
    });
    // "What did I export, and when" is what this list answers, so the row
    // survives the file.
    expect(await screen.findByTestId("exp-EXP-000101")).toBeInTheDocument();
  });

  it("the confirmation says the record is kept, not that it is deleted", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    await screen.findByTestId("exports-table");
    await user.click(await screen.findByTestId("discard-EXP-000101"));

    expect(
      await screen.findByText(/The record of having asked for it is kept/),
    ).toBeInTheDocument();
  });

  it("a second press removes the record, and says so", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    await screen.findByTestId("exports-table");
    // First press: the file.
    await user.click(await screen.findByTestId("discard-EXP-000101"));
    await user.click(await screen.findByRole("button", { name: "Discard the file" }));
    await waitFor(() =>
      expect(exportRows.find((item) => item["id"] === "exp-ready")).toBeTruthy(),
    );

    // Second press: the record. The copy changes between the two, because a
    // confirmation that promised to keep something and then removed it would
    // be the page contradicting itself.
    await user.click(await screen.findByTestId("discard-EXP-000101"));
    expect(await screen.findByText(/stays in the audit trail/)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Remove it" }));

    await waitFor(() =>
      expect(exportRows.some((item) => item["id"] === "exp-ready")).toBe(false),
    );
  });

  it("labels the button for what the press will actually do", async () => {
    withPermissions();
    render();

    await screen.findByTestId("exports-table");
    // A file to discard, versus a record to remove — the failed export has no
    // file, so its first press is already the second kind.
    expect(await screen.findByTestId("discard-EXP-000101")).toHaveTextContent("Discard");
    expect(screen.getByTestId("discard-EXP-000103")).toHaveTextContent("Remove");
  });

  it("asking again produces a new export and leaves the old row alone", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    await screen.findByTestId("exports-table");
    await user.click(await screen.findByTestId("again-EXP-000103"));

    await waitFor(() =>
      expect(exportRows.some((item) => item["reference"] === "EXP-000199")).toBe(true),
    );
    // The failed row is still there: it is the record of what happened.
    expect(screen.getByTestId("exp-EXP-000103")).toBeInTheDocument();
  });

  it("is never called Retry, because the old file is not coming back", async () => {
    withPermissions();
    render();

    await screen.findByTestId("exports-table");
    expect(await screen.findByTestId("again-EXP-000103")).toHaveTextContent("Request again");
    expect(screen.queryByText("Retry")).not.toBeInTheDocument();
  });
});

describe("one export", () => {
  it("names which background mechanism produced it", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("exports-table");
    await waitFor(() => expect(within(table).getByTestId("exp-EXP-000101")).toBeInTheDocument());
    await user.click(within(table).getByTestId("exp-EXP-000101"));

    const detail = await screen.findByTestId("export-detail");
    // "Background" hides three different things, and a slow export reads
    // differently depending on which one is producing it.
    expect(within(detail).getByText("greenlet")).toBeInTheDocument();
  });

  it("shows the failure where the description would be", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("exports-table");
    await waitFor(() => expect(within(table).getByTestId("exp-EXP-000103")).toBeInTheDocument());
    await user.click(within(table).getByTestId("exp-EXP-000103"));

    const situationBox = await screen.findByTestId("export-situation");
    expect(situationBox).toHaveTextContent("Failed");
    expect(situationBox).toHaveTextContent("the bucket said no");
  });

  it("shows the export's own log without a second request", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("exports-table");
    await waitFor(() => expect(within(table).getByTestId("exp-EXP-000101")).toBeInTheDocument());
    await user.click(within(table).getByTestId("exp-EXP-000101"));

    const log = await screen.findByTestId("export-log");
    expect(log).toHaveTextContent("1,284 rows to write");
    expect(log).toHaveTextContent("finished");
  });

  it("says when the file will stop being available", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const table = await screen.findByTestId("exports-table");
    await waitFor(() => expect(within(table).getByTestId("exp-EXP-000101")).toBeInTheDocument());
    await user.click(within(table).getByTestId("exp-EXP-000101"));

    const detail = await screen.findByTestId("export-detail");
    // Derived from `retention.export_days`, so a reader is not left guessing
    // how long they have.
    expect(within(detail).getByText("File kept until")).toBeInTheDocument();
  });
});
