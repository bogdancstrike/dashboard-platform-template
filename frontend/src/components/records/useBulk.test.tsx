import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HttpResponse, http } from "msw";
import { Route, Routes } from "react-router-dom";

import OrdersLedgerPage from "@/pages/entities/OrdersLedgerPage";
import { CommandProvider } from "@/commands/CommandContext";
import { confirmLabel, settableFields } from "@/components/records/BulkDialog";
import { explorerCatalogue } from "@/test/handlers";
import { server } from "@/test/server";
import { renderWithProviders } from "@/test/render";

/**
 * Bulk selection, through the page that carries it (§43, §75).
 *
 * Tested on the ledger rather than on the hook in isolation, because the claims
 * worth making are about what a reader can do: tick rows, be told what would
 * happen *before* it happens, and read both halves of what did.
 *
 * The three properties:
 *
 * **The preview is not skippable.** The dialog asks the server what the
 * selection covers and renders the split — ticked by hand against matched by
 * filter — because those two are trusted differently and one total hides which
 * of them somebody is about to act on.
 *
 * **A partial result is shown in full.** The fixture always refuses one row of
 * a multi-row gesture, so the panel that reports "n applied, 1 refused" cannot
 * ship untested.
 *
 * **A refusal is on the button.** A reader who cannot delete gets a disabled
 * control naming the permission, not a dialog that takes their confirmation
 * first (§76).
 */

function render() {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/orders" element={<OrdersLedgerPage />} />
        <Route path="/orders/:id" element={<div>the order</div>} />
      </Routes>
    </CommandProvider>,
    { route: "/orders" },
  );
}

/**
 * Tick the first `count` data rows, the way a reader does.
 *
 * Waits for a *row* rather than for the table: the table renders as soon as
 * the columns are known, so `findByRole("table")` resolves while the only
 * checkbox on screen is the header's — which selects the nothing that is
 * loaded, and every later assertion is then measured against a selection that
 * was never made. The first version of this helper did exactly that.
 */
async function tick(user: ReturnType<typeof userEvent.setup>, count: number) {
  await screen.findAllByText(/ORD-/);
  const table = screen.getByRole("table");
  const boxes = within(table).getAllByRole("checkbox");
  expect(boxes.length).toBeGreaterThan(count);
  // The first is the header's "select the page"; the rest are rows.
  for (let index = 1; index <= count; index += 1) {
    await user.click(boxes[index]!);
  }
}

describe("what a bulk edit may set", () => {
  it("offers the closed vocabularies and nothing else", () => {
    const orders = explorerCatalogue.items.find((item) => item.key === "order");
    const names = settableFields(orders).map((field) => field.name);

    // A status, a payment state — the edits somebody actually applies to
    // forty rows.
    expect(names).toContain("status");
    expect(names).toContain("payment_status");
    // Never a free-text field: "set the reference of these two hundred
    // records" is the most destructive control a list could offer, and it is
    // never what anybody wants.
    expect(names).not.toContain("reference");
    expect(names).not.toContain("total");
  });

  it("says nothing when the dataset declares no settable field", () => {
    expect(settableFields(undefined)).toEqual([]);
  });
});

describe("the confirm button", () => {
  it("names the act rather than asking for agreement", () => {
    const orders = explorerCatalogue.items.find((item) => item.key === "order");
    // "OK" on a dialog that deletes forty records is a button somebody presses
    // without reading.
    expect(confirmLabel("delete", 12, orders)).toBe("Delete 12 orders");
    expect(confirmLabel("update", 1, orders)).toBe("Update 1 order");
  });
});

describe("selecting rows", () => {
  it("says how many, and offers the whole filtered set", async () => {
    const user = userEvent.setup();
    render();
    await tick(user, 2);

    const bar = await screen.findByTestId("bulk-bar");
    expect(within(bar).getByTestId("bulk-count")).toHaveTextContent("2 orders selected");
    // Ticking the header box selects the page, which is almost never what
    // somebody means when the filter matches more than that.
    expect(within(bar).getByTestId("bulk-select-all")).toBeInTheDocument();
  });

  it("clears without touching anything", async () => {
    const user = userEvent.setup();
    render();
    await tick(user, 1);

    await user.click(screen.getByTestId("bulk-clear"));
    expect(screen.queryByTestId("bulk-bar")).not.toBeInTheDocument();
  });

  it("shows nothing at all when nothing is selected", async () => {
    render();
    await screen.findByRole("table");
    // A bar that is always there, empty, is a strip of chrome the reader
    // learns to ignore.
    expect(screen.queryByTestId("bulk-bar")).not.toBeInTheDocument();
  });
});

describe("the preview (§75)", () => {
  it("asks the server what the selection covers before anything is applied", async () => {
    const user = userEvent.setup();
    render();
    await tick(user, 2);

    await user.click(screen.getByTestId("bulk-delete"));
    const preview = await screen.findByTestId("bulk-preview");
    expect(preview).toHaveTextContent("2 orders you selected");
    // And which records, by name: a count nobody can check against anything
    // is a count nobody can refuse.
    expect(preview.textContent).toMatch(/ORD-/);
  });

  it("does not ask until an update knows what it would set", async () => {
    const user = userEvent.setup();
    render();
    await tick(user, 1);

    await user.click(screen.getByTestId("bulk-update"));
    // A preview of "change nothing to nothing" is a question with no answer.
    expect(screen.queryByTestId("bulk-preview")).not.toBeInTheDocument();
    expect(screen.getByTestId("bulk-confirm")).toBeDisabled();
  });

  it("splits hand-picked from filter-matched once both are in play", async () => {
    const user = userEvent.setup();
    render();
    await tick(user, 1);
    await user.click(screen.getByTestId("bulk-select-all"));
    await user.click(screen.getByTestId("bulk-delete"));

    const preview = await screen.findByTestId("bulk-preview");
    // The split §75 asks for: ticking a box is knowing what is in it, and
    // filtering is not.
    expect(within(preview).getByText(/selected by hand/)).toBeInTheDocument();
    expect(within(preview).getByText(/matched by the filter/)).toBeInTheDocument();
  });

  it("refuses to go on when the server says it is over the cap", async () => {
    server.use(
      http.post("/platform/api/records/order/bulk/preview", () =>
        HttpResponse.json({
          resource_type: "order", action: "delete", changes: {},
          total: 9000, by_hand: 0, by_filter: 9000,
          limit: 500, over_limit: true,
          sample: [], refused: [], eligible: 9000,
          describes: "9000 orders matching the filter",
        }),
      ),
    );
    const user = userEvent.setup();
    render();
    await tick(user, 1);
    await user.click(screen.getByTestId("bulk-delete"));

    expect(await screen.findByTestId("bulk-over-limit")).toBeInTheDocument();
    // Reported *and* blocked: a cap the dialog explains and then lets somebody
    // past is not a cap.
    expect(screen.getByTestId("bulk-confirm")).toBeDisabled();
  });

  it("names every reason a row will be left alone", async () => {
    server.use(
      http.post("/platform/api/records/order/bulk/preview", () =>
        HttpResponse.json({
          resource_type: "order", action: "update", changes: { status: "CANCELLED" },
          total: 10, by_hand: 10, by_filter: 0,
          limit: 500, over_limit: false,
          sample: [], eligible: 6,
          refused: [{ reason: "Already has these values", count: 4 }],
          describes: "10 orders you selected",
        }),
      ),
    );
    const user = userEvent.setup();
    render();
    await tick(user, 1);
    await user.click(screen.getByTestId("bulk-delete"));

    // "4 will be left alone" is something a reader acts on; four identical
    // lines are something they scroll past.
    expect(
      await screen.findByText(/4 will be left alone — already has these values/),
    ).toBeInTheDocument();
  });
});

describe("applying it (§43)", () => {
  it("reports both halves, and keeps the refusals on screen", async () => {
    const user = userEvent.setup();
    render();
    await tick(user, 2);

    await user.click(screen.getByTestId("bulk-delete"));
    await screen.findByTestId("bulk-preview");
    await user.click(screen.getByTestId("bulk-confirm"));

    const result = await screen.findByTestId("bulk-result");
    // Forty-eight applied and two refused is the normal outcome of a bulk
    // gesture. A toast saying "done" would hide the two; a red error would
    // hide the forty-eight.
    expect(result).toHaveTextContent(/could not be updated/);
    const failures = within(result).getByRole("table");
    expect(failures).toHaveTextContent("Somebody else changed it while you were looking.");
  });

  it("clears the selection once the change has landed", async () => {
    const user = userEvent.setup();
    render();
    await tick(user, 2);

    await user.click(screen.getByTestId("bulk-delete"));
    await screen.findByTestId("bulk-preview");
    await user.click(screen.getByTestId("bulk-confirm"));
    await screen.findByTestId("bulk-result");
    await user.click(screen.getByTestId("bulk-done"));

    // Leaving rows ticked after they were deleted invites the same gesture
    // twice.
    await waitFor(() => expect(screen.queryByTestId("bulk-bar")).not.toBeInTheDocument());
  });
});

describe("a reader who may not write", () => {
  it("is shown the refusal on the control, not after confirming", async () => {
    // Refused on the *catalogue*, which is where the server publishes its
    // answer for this caller — the same source `useRecordEditing` reads, so a
    // page cannot offer a single delete and refuse a bulk one.
    server.use(
      http.get("/platform/api/explorer/catalog", () =>
        HttpResponse.json({
          ...explorerCatalogue,
          items: explorerCatalogue.items.map((item) =>
            item.key === "order" ? { ...item, can_edit: false, can_delete: false } : item,
          ),
        }),
      ),
    );
    const user = userEvent.setup();
    render();
    await tick(user, 1);

    expect(await screen.findByTestId("bulk-delete")).toBeDisabled();
    expect(screen.getByTestId("bulk-update")).toBeDisabled();
  });

  it("says when the dataset has no field a bulk change could set", async () => {
    server.use(
      http.get("/platform/api/explorer/catalog", () =>
        HttpResponse.json({
          ...explorerCatalogue,
          items: explorerCatalogue.items.map((item) =>
            item.key === "order"
              ? { ...item, fields: item.fields.map((field) => ({ ...field, editable: false })) }
              : item,
          ),
        }),
      ),
    );
    const user = userEvent.setup();
    render();
    await tick(user, 1);

    // Permitted, but there is nothing to set — a different refusal, and one a
    // reader would otherwise read as a permission problem (§76).
    expect(await screen.findByTestId("bulk-update")).toBeDisabled();
    expect(screen.getByTestId("bulk-delete")).toBeEnabled();
  });
});
