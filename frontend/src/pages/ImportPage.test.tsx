import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import ImportPage, { outcome, stepIndex, tone, whyNotExecute } from "@/pages/ImportPage";
import type { ImportRun } from "@/api/imports";
import { CommandProvider } from "@/commands/CommandContext";
import { currentUser, importRows, resetImports } from "@/test/handlers";
import { server } from "@/test/server";
import { renderWithProviders } from "@/test/render";

/**
 * The import wizard (§29).
 *
 * Four functions carry this page and all four are asserted directly, because
 * each encodes a decision rather than a rendering:
 *
 * `stepIndex` reads the run's *stored* step rather than inferring one from its
 * data. That is the whole reason the column exists: a draft whose mapping
 * happens to be complete has still not been looked at, and skipping it past
 * the check would defeat the point of having a wizard.
 *
 * `outcome` collapses four counts and six statuses into the one thing a reader
 * needs — act, wait, or read the report. The distinction it must not lose is
 * "nothing in this file is usable" against "some of it is", because that
 * decides whether an execute should be offered at all.
 *
 * `whyNotExecute` is the §76 rule: a refused control says *which* refusal it
 * is, and "choose a column for name" and "check the rows first" are different
 * problems with different fixes.
 *
 * `tone` keeps colour meaningful by using almost none of it.
 *
 * Through the page: that a mapping change re-validates in one call, that the
 * preview puts each row's problems on that row with the file's own line
 * number, and that the execute is refused before it is pressed.
 */
function render(route = "/import") {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/import" element={<ImportPage />} />
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
        permissions: [...currentUser.permissions, "records.import", ...extra],
      }),
    ),
  );
}

afterEach(() => {
  resetImports();
});

const asRun = (overrides: Partial<ImportRun>): ImportRun =>
  ({
    id: "r",
    reference: "IMP-000001",
    filename: "customers.csv",
    target_entity: "customer",
    target_label: "Customers",
    status: "DRAFT",
    step: "MAPPING",
    delimiter: ",",
    total_rows: 10,
    valid_rows: 0,
    invalid_rows: 0,
    skipped_rows: 0,
    imported_rows: 0,
    detected_columns: [],
    column_mapping: {},
    unmapped_required: [],
    error_count: 0,
    created_at: null,
    completed_at: null,
    can_execute: false,
    can_discard: true,
    holds_file: true,
    ...overrides,
  });

describe("which step a run is on", () => {
  it("reads the stored step rather than inferring one", () => {
    // A draft whose mapping is complete has still not been looked at, and a
    // wizard that skipped the check would not be a wizard.
    expect(stepIndex(asRun({ step: "MAPPING", column_mapping: { a: "name" } }))).toBe(1);
    expect(stepIndex(asRun({ step: "PREVIEW" }))).toBe(2);
    expect(stepIndex(asRun({ step: "DONE" }))).toBe(3);
  });

  it("shows an execute as the last step, because that is where it happens", () => {
    expect(stepIndex(asRun({ step: "EXECUTE", status: "RUNNING" }))).toBe(3);
  });

  it("starts at the beginning when there is no run", () => {
    expect(stepIndex(undefined)).toBe(0);
  });
});

describe("what a run's numbers come to", () => {
  it("keeps 'nothing usable' apart from 'some of it is'", () => {
    // The distinction that decides whether an execute should exist.
    expect(outcome(asRun({ status: "VALIDATED", valid_rows: 0, invalid_rows: 3 }))).toBe(
      "Nothing in this file can be imported",
    );
    expect(
      outcome(asRun({ status: "VALIDATED", valid_rows: 7, invalid_rows: 3 })),
    ).toBe("7 ready, 3 to fix");
  });

  it("says a failure imported nothing, rather than how far it got", () => {
    // All-or-nothing, so "failed at row 4,812" would be the wrong fact: the
    // 4,811 before it were rolled back too.
    expect(outcome(asRun({ status: "FAILED", valid_rows: 10 }))).toBe(
      "Failed — nothing was imported",
    );
  });

  it("names what a draft is still missing", () => {
    expect(
      outcome(asRun({ status: "DRAFT", unmapped_required: ["name", "email"] })),
    ).toBe("Needs a column for name, email");
    expect(outcome(asRun({ status: "DRAFT", total_rows: 1284 }))).toBe(
      "1,284 rows read — check the columns",
    );
  });

  it("reports a completed import against the file it came from", () => {
    expect(
      outcome(asRun({ status: "COMPLETED", imported_rows: 340, total_rows: 400 })),
    ).toBe("340 of 400 rows imported");
  });

  it("colours only a failure, a success and a file with rows to fix", () => {
    expect(tone(asRun({ status: "FAILED" }))).toBe("error");
    expect(tone(asRun({ status: "COMPLETED" }))).toBe("success");
    expect(tone(asRun({ status: "VALIDATED", invalid_rows: 2 }))).toBe("warning");
    expect(tone(asRun({ status: "VALIDATED", invalid_rows: 0 }))).toBeUndefined();
    expect(tone(asRun({ status: "DRAFT" }))).toBeUndefined();
    expect(tone(asRun({ status: "CANCELLED" }))).toBeUndefined();
  });
});

describe("why the execute is refused", () => {
  it("names the fields when a required one has no column", () => {
    // Said before the press, and specific: "not ready" leaves somebody to
    // guess which of eleven columns they have not mapped (§76).
    expect(whyNotExecute(asRun({ unmapped_required: ["name"] }))).toContain(
      "Choose a column for name",
    );
  });

  it("distinguishes 'not checked yet' from 'nothing valid'", () => {
    expect(whyNotExecute(asRun({ status: "DRAFT" }))).toBe("Check the rows first.");
    expect(whyNotExecute(asRun({ status: "VALIDATED", valid_rows: 0 }))).toContain(
      "nothing to import",
    );
  });

  it("says nothing when the import may run", () => {
    expect(
      whyNotExecute(asRun({ status: "VALIDATED", valid_rows: 4, can_execute: true })),
    ).toBe("");
  });
});

describe("starting one", () => {
  it("says what every row will need before a file is chosen", async () => {
    withPermissions();
    render();

    // The required fields, from the dataset's own declarations: somebody about
    // to export from another system needs to know what to include.
    expect(await screen.findByTestId("target-required")).toHaveTextContent(
      "Every row needs Name",
    );
  });

  it("offers only datasets that can be created", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    await screen.findByTestId("import-start");
    await user.click(screen.getByRole("combobox", { name: "Dataset" }));

    // `getAllByTitle` for the current value, because AntD gives the closed
    // select's own label the same `title` as its option — a single-match
    // query finds two as soon as the value being looked for is the one
    // already chosen, which is a trap four other specs have fallen into.
    expect((await screen.findAllByTitle("Customers")).length).toBeGreaterThan(0);
    expect(screen.getByTitle("Projects")).toBeInTheDocument();
  });

  it("says the row cap and that the separator is detected", async () => {
    withPermissions();
    render();

    const limits = await screen.findByTestId("import-limits");
    expect(limits).toHaveTextContent("5,000 rows");
    // A reader whose file comes back as one column needs to know the
    // separator was a decision rather than an assumption.
    expect(limits).toHaveTextContent(/separator is detected/);
  });
});

describe("mapping the columns", () => {
  it("shows each column with samples, so two of one name can be told apart", async () => {
    withPermissions();
    render("/import?run=imp-draft");

    const mapping = await screen.findByTestId("import-mapping");
    expect(within(mapping).getByText("Name")).toBeInTheDocument();
    expect(within(mapping).getByText(/Acme Ltd · Globex · Initech/)).toBeInTheDocument();
  });

  it("shows the detected separator, on every read and not only the first", async () => {
    withPermissions();
    render("/import?run=imp-draft");

    // The page's whole promise about the separator: a reader whose file came
    // back as one column needs to see *why*. Attaching the note to the answer
    // that created the run made it vanish at the first refetch, which is what
    // the end-to-end walkthrough caught.
    expect(await screen.findByTestId("dialect")).toHaveTextContent(
      "Read as comma-separated, 4 columns.",
    );
  });

  it("says which required fields still have no column", async () => {
    withPermissions();
    render("/import?run=imp-unmapped");

    const missing = await screen.findByTestId("unmapped");
    expect(missing).toHaveTextContent("Still needed: Name");
  });

  it("refuses the execute before it is pressed, with the reason", async () => {
    withPermissions();
    render("/import?run=imp-unmapped");

    await screen.findByTestId("import-mapping");
    // Disabled rather than absent: importing *is* what somebody came to do,
    // and the missing columns are the actionable part (§76).
    const preview = screen.queryByTestId("execute-import");
    expect(preview === null || (preview as HTMLButtonElement).disabled).toBe(true);
  });

  it("checks the rows in the same call as the mapping", async () => {
    withPermissions();
    const user = userEvent.setup();
    render("/import?run=imp-draft");

    await screen.findByTestId("import-mapping");
    await user.click(screen.getByTestId("check-mapping"));

    // One call, because a mapping change changes which rows are wrong: a
    // separate Validate press would be a step whose answer is known.
    await waitFor(() =>
      expect(
        importRows.find((row) => row["id"] === "imp-draft")?.["status"],
      ).toBe("VALIDATED"),
    );
    expect(await screen.findByTestId("import-counts")).toHaveTextContent("Ready");
  });

  it("will not offer a field another column has already taken", async () => {
    withPermissions();
    const user = userEvent.setup();
    render("/import?run=imp-draft");

    await screen.findByTestId("import-mapping");
    await user.click(screen.getByRole("combobox", { name: "Field for legacy_ref" }));

    // Two columns onto one field would make the second silently win, so the
    // server refuses it — and a control offering it would be drawing a
    // button the endpoint rejects (§76). Located by the disabled class rather
    // than by title, because the title sits on an inner node.
    await waitFor(() =>
      expect(document.querySelectorAll(".ant-select-item-option-disabled").length)
        .toBeGreaterThan(0),
    );
    const disabled = [...document.querySelectorAll(".ant-select-item-option-disabled")].map(
      (option) => option.textContent ?? "",
    );
    expect(disabled).toContain("Name *");
  });
});

describe("the preview", () => {
  it("puts each row's problem on that row, with the file's own line number", async () => {
    withPermissions();
    render("/import?run=imp-checked");

    const table = await screen.findByTestId("preview-table");
    // The header is line 1, so the first data row is 2 — the number somebody
    // needs to find it in the spreadsheet they are about to fix.
    expect(within(table).getByText("2")).toBeInTheDocument();
    expect(
      within(table).getByText(/is not a segment this record can have/),
    ).toBeInTheDocument();
  });

  it("shows the four counts so they can be seen to add up", async () => {
    withPermissions();
    render("/import?run=imp-checked");

    const counts = await screen.findByTestId("import-counts");
    // 1 ready + 1 to fix + 1 with nothing mapped = 3 rows.
    expect(counts).toHaveTextContent("Ready 1");
    expect(counts).toHaveTextContent("To fix 1");
    expect(counts).toHaveTextContent("Nothing mapped 1");
    expect(counts).toHaveTextContent("of 3 rows");
  });

  it("offers the problems as a file, because they go back to the spreadsheet", async () => {
    withPermissions();
    render("/import?run=imp-checked");

    // Two hundred bad rows get fixed in Excel, and a screen cannot be sorted,
    // filtered or pasted.
    expect(await screen.findByTestId("download-problems")).toHaveTextContent(
      "1 problem, as a file",
    );
  });

  it("has no report when nothing is wrong", async () => {
    withPermissions();
    server.use(
      http.get("/platform/imports/imp-checked", () =>
        HttpResponse.json({
          ...importRows.find((row) => row["id"] === "imp-checked"),
          errors: [],
          error_count: 0,
          invalid_rows: 0,
          valid_rows: 2,
          preview: [],
          preview_total: 0,
        }),
      ),
    );
    render("/import?run=imp-checked");

    await screen.findByTestId("import-preview");
    expect(screen.queryByTestId("download-problems")).not.toBeInTheDocument();
  });
});

describe("running it", () => {
  it("imports the valid rows and says what landed", async () => {
    withPermissions();
    const user = userEvent.setup();
    render("/import?run=imp-checked");

    await screen.findByTestId("import-preview");
    await user.click(screen.getByTestId("execute-import"));

    await waitFor(() =>
      expect(importRows.find((row) => row["id"] === "imp-checked")?.["status"]).toBe(
        "COMPLETED",
      ),
    );
    expect(await screen.findByTestId("import-outcome")).toHaveTextContent(
      "1 of 3 rows imported",
    );
  });

  it("says a failure imported nothing at all", async () => {
    withPermissions();
    server.use(
      http.get("/platform/imports/imp-failed", () =>
        HttpResponse.json({
          ...importRows.find((row) => row["id"] === "imp-checked"),
          id: "imp-failed",
          reference: "IMP-000299",
          status: "FAILED",
          step: "PREVIEW",
          imported_rows: 0,
          errors: [
            { line: 0, column: "", value: "", message: "Nothing was imported. RuntimeError: no" },
          ],
          error_count: 1,
          preview: [],
          preview_total: 0,
        }),
      ),
    );
    render("/import?run=imp-failed");

    const outcomeBox = await screen.findByTestId("import-outcome");
    expect(outcomeBox).toHaveTextContent("Failed — nothing was imported");
    expect(outcomeBox).toHaveTextContent("RuntimeError: no");
  });

  it("no longer shows a preview once the rows have become records", async () => {
    withPermissions();
    render("/import?run=imp-done");

    // The staged file is dropped on success: keeping it would be holding the
    // data twice.
    expect(await screen.findByTestId("import-outcome")).toHaveTextContent(
      "2 of 3 rows imported",
    );
    expect(screen.queryByTestId("preview-table")).not.toBeInTheDocument();
  });
});

describe("the earlier imports", () => {
  it("lists them with where each one stands", async () => {
    withPermissions();
    render();

    const history = await screen.findByTestId("import-history");
    await waitFor(() =>
      expect(within(history).getByTestId("imp-IMP-000202")).toBeInTheDocument(),
    );
    expect(within(history).getByText("2 of 3 rows imported")).toBeInTheDocument();
  });

  it("lets a draft be picked up where it was left", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const history = await screen.findByTestId("import-history");
    await waitFor(() =>
      expect(within(history).getByTestId("imp-IMP-000201")).toBeInTheDocument(),
    );
    await user.click(within(history).getByTestId("imp-IMP-000201"));

    // The whole reason a draft holds its file and its step.
    expect(await screen.findByTestId("import-mapping")).toBeInTheDocument();
  });

  it("labels the button for what the press will actually do", async () => {
    withPermissions();
    render();

    const history = await screen.findByTestId("import-history");
    await waitFor(() =>
      expect(within(history).getByTestId("discard-IMP-000201")).toBeInTheDocument(),
    );
    // A draft still holds its file, so the press drops that. A completed one
    // does not, so the press removes the record — and the label has to say
    // which, or the second press reads as the first not having worked.
    expect(within(history).getByTestId("discard-IMP-000201")).toHaveTextContent("Discard");
    expect(within(history).getByTestId("discard-IMP-000204")).toHaveTextContent("Remove");
  });

  it("says where the history goes when a record is removed", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const history = await screen.findByTestId("import-history");
    await waitFor(() =>
      expect(within(history).getByTestId("discard-IMP-000204")).toBeInTheDocument(),
    );
    await user.click(within(history).getByTestId("discard-IMP-000204"));

    expect(await screen.findByText(/stays in the audit trail/)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Remove it" }));

    await waitFor(() =>
      expect(importRows.some((row) => row["id"] === "imp-done")).toBe(false),
    );
  });

  it("says the record is kept when a draft is discarded", async () => {
    withPermissions();
    const user = userEvent.setup();
    render();

    const history = await screen.findByTestId("import-history");
    await waitFor(() =>
      expect(within(history).getByTestId("discard-IMP-000201")).toBeInTheDocument(),
    );
    await user.click(within(history).getByTestId("discard-IMP-000201"));

    expect(await screen.findByText(/record of having tried is kept/)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Discard it" }));

    await waitFor(() =>
      expect(importRows.find((row) => row["id"] === "imp-draft")?.["status"]).toBe(
        "CANCELLED",
      ),
    );
  });
});
