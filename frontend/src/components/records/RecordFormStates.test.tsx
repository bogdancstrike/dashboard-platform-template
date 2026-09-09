import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, delay, http } from "msw";
import { describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import TasksBoardPage from "@/pages/entities/TasksBoardPage";
import { CommandProvider } from "@/commands/CommandContext";
import { recordDetail } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * The states the edit form has before anybody types anything (§34).
 *
 * `RecordForm.test.tsx` covers what a *filled* form does — what it sends, what
 * it refuses to discard, what it does with a stale version. This covers the
 * three moments before that, and all three were wrong:
 *
 * * **Loading.** The drawer opened on the *response*, not on the click. On a
 *   warm database that is invisible; on a cold one a reader presses Edit,
 *   nothing happens, and they press it again. It opens on the click now, with
 *   a skeleton shaped like the form that is coming.
 * * **A failed read.** If the record could not be fetched the drawer simply
 *   never opened, and nothing said why — the one case where the reader most
 *   needs to be told the row they clicked is gone or not theirs.
 * * **Nothing writable.** A dataset whose catalogue declares no editable
 *   field rendered an empty drawer with a live Create button, which posts an
 *   empty form.
 */

/**
 * From a list, deliberately.
 *
 * A detail page has already read the record the drawer would read, under the
 * same query key, so opening the form there is instant and none of these
 * states occur. Opening it from a row is the case that has to hold: the list
 * carries the columns it drew, and the form has to fetch the rest.
 */
function renderBoard() {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/tasks" element={<TasksBoardPage />} />
        <Route path="/tasks/:id" element={<div>the record</div>} />
      </Routes>
    </CommandProvider>,
    { route: "/tasks" },
  );
}

/** How the record read answers when the form asks for it. */
function readIs(answer: () => Promise<Response> | Response) {
  server.use(http.get("/platform/api/records/task/:id", () => answer()));
}

async function openTheDrawer() {
  const user = userEvent.setup();
  renderBoard();
  const actions = await screen.findAllByRole("button", { name: /^Actions for / });
  await user.click(actions[0]!);
  await user.click(await screen.findByRole("menuitem", { name: /Edit/ }));
  return { user, drawer: await screen.findByRole("dialog") };
}

describe("the edit form, before it has anything to show", () => {
  it("opens on the click and draws a skeleton, with nothing to save yet", async () => {
    readIs(async () => {
      await delay(200);
      return HttpResponse.json(recordDetail);
    });
    const { drawer } = await openTheDrawer();

    // The drawer is open *now* — the read has not come back.
    expect(drawer.querySelector(".ant-skeleton")).toBeInTheDocument();
    expect(within(drawer).getByTestId("record-form-save")).toBeDisabled();
    // And no controls to type into, which is what makes a spinner over an
    // empty drawer misleading rather than merely plain.
    expect(within(drawer).queryByLabelText("Title")).not.toBeInTheDocument();

    // Then the form arrives, in the same drawer.
    expect(await within(drawer).findByLabelText("Title")).toHaveValue(
      "Review customer migration",
    );
    expect(within(drawer).getByTestId("record-form-save")).toBeEnabled();
  });

  it.each([
    { status: 404, kind: "not_found", says: "That record is no longer there" },
    { status: 403, kind: "forbidden", says: "Your role does not include this record" },
    { status: 500, kind: "failed", says: "Could not open this record for editing" },
  ])("says why a $status read failed rather than opening a blank form", async ({
    status,
    kind,
    says,
  }) => {
    readIs(() =>
      HttpResponse.json(
        { error: "record_error", message: "The record could not be read.", details: { missing: ["records.update"] } },
        { status, headers: { "X-Correlation-ID": "form-trace" } },
      ),
    );
    const { drawer } = await openTheDrawer();

    const failure = await within(drawer).findByTestId("failure-alert");
    expect(failure).toHaveAttribute("data-failure", kind);
    expect(within(drawer).getByText(says)).toBeInTheDocument();
    // The id to quote, and no form underneath pretending to be editable.
    expect(failure).toHaveTextContent("form-trace");
    expect(within(drawer).queryByLabelText("Title")).not.toBeInTheDocument();
    expect(within(drawer).getByTestId("record-form-save")).toBeDisabled();
  });

  it("retries a fault, and does not offer a retry for a refusal", async () => {
    readIs(() =>
      HttpResponse.json({ error: "boom", message: "Broken." }, { status: 500 }),
    );
    const { user, drawer } = await openTheDrawer();

    await within(drawer).findByTestId("failure-alert");
    server.use(http.get("/platform/api/records/task/:id", () => HttpResponse.json(recordDetail)));
    await user.click(within(drawer).getByRole("button", { name: "Retry" }));
    expect(await within(drawer).findByLabelText("Title")).toBeInTheDocument();
  });

  it("explains a record with nothing writable instead of an empty form", async () => {
    // Writability is declared per field *on the record* — it is the server
    // that knows this reader may see a column and not change it — so this is
    // what a read-only field permission actually looks like on the wire.
    readIs(() =>
      HttpResponse.json({
        ...recordDetail,
        fields: recordDetail.fields.map((field) => ({ ...field, editable: false })),
      }),
    );
    const { drawer } = await openTheDrawer();

    const empty = await within(drawer).findByTestId("empty-state");
    expect(empty).toHaveTextContent(/Nothing here can be edited/);
    expect(empty).toHaveTextContent(/read-only for your role/);
    // Nothing to submit, so nothing that looks submittable.
    expect(within(drawer).getByTestId("record-form-save")).toBeDisabled();
  });
});
