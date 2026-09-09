import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HttpResponse, http } from "msw";
import { Route, Routes } from "react-router-dom";

import ComparePage, { idsFrom, summarise } from "@/pages/ComparePage";
import type { Comparison } from "@/api/compare";
import { CommandProvider } from "@/commands/CommandContext";
import { server } from "@/test/server";
import { renderWithProviders } from "@/test/render";

/**
 * Two or more records side by side (§47).
 *
 * The claims:
 *
 * **The differing fields are marked, not merely tinted.** Colour alone is not a
 * signal (§64), and these are the only rows a reader came to the page to find.
 *
 * **The fields that agree are one click away, not absent.** They are the
 * evidence that two records are the same thing, which is the question this
 * page is usually opened to answer.
 *
 * **A refusal is shown as one.** Six records is more than can be read side by
 * side and the server says so; a page that swallowed that would show an empty
 * table.
 */

const IDS = ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"];

function render(route = `/compare?type=order&ids=${IDS.join(",")}`) {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/compare" element={<ComparePage />} />
        <Route path="/orders" element={<div>the order ledger</div>} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

describe("the pure parts", () => {
  it("reads the ids from the address, keeping the reader's order", () => {
    expect(idsFrom("b, a ,c")).toEqual(["b", "a", "c"]);
  });

  it("drops a record named twice rather than comparing it with itself", () => {
    // Otherwise the table shows nothing differing and nothing wrong.
    expect(idsFrom("a,b,a")).toEqual(["a", "b"]);
  });

  it("says nothing when the address names nothing", () => {
    expect(idsFrom(null)).toEqual([]);
    expect(idsFrom("")).toEqual([]);
  });

  it("counts what differs and what does not", () => {
    const said = summarise({
      records: [{}, {}],
      resource_label: "Orders",
      differing: 2,
      same: 7,
    } as unknown as Comparison);
    expect(said).toBe("2 orders · 2 fields differ · 7 the same");
  });

  it("says so plainly when they are identical", () => {
    // The strongest evidence there is that two records are the same thing
    // recorded twice, so it is the headline rather than an absence of rows.
    const said = summarise({
      records: [{}, {}],
      resource_label: "Orders",
      differing: 0,
      same: 9,
    } as unknown as Comparison);
    expect(said).toBe("2 orders — identical in all 9 fields");
  });
});

describe("the page", () => {
  it("marks the fields the records disagree about", async () => {
    render();
    const table = await screen.findByTestId("compare-table");
    // A marker as well as the tint, because colour alone is not a signal.
    expect(within(table).getAllByText("differs").length).toBeGreaterThan(0);
    expect(within(table).getByText("Status")).toBeInTheDocument();
  });

  it("shows only the differences until asked for everything", async () => {
    const user = userEvent.setup();
    render();
    const table = await screen.findByTestId("compare-table");
    // Channel agrees, so it is not among the differences.
    expect(within(table).queryByText("Channel")).not.toBeInTheDocument();

    await user.click(
      screen.getByText(/Every field/, { selector: ".ant-segmented-item-label" }),
    );
    expect(within(screen.getByTestId("compare-table")).getByText("Channel")).toBeInTheDocument();
  });

  it("names each record and links to it", async () => {
    render();
    await screen.findByTestId("compare-table");
    const heading = screen.getByRole("link", { name: /REC-00001/ });
    expect(heading).toHaveAttribute("href", `/orders/${IDS[0]}`);
  });

  it("asks for a selection rather than failing when given one record", async () => {
    render(`/compare?type=order&ids=${IDS[0]}`);
    // One record compared with nothing is its own page, and the page says
    // where to make the choice rather than showing an error.
    expect(await screen.findByText("Choose at least two records")).toBeInTheDocument();
  });

  it("shows the server's refusal when there are too many", async () => {
    server.use(
      http.get("/platform/api/records/:resourceType/compare", () =>
        HttpResponse.json(
          {
            error: "validation_error",
            message: "7 records is more than 5 can be read side by side. Compare fewer.",
            details: { ids: 7, limit: 5 },
          },
          { status: 400 },
        ),
      ),
    );
    render();
    // Shown, with both numbers, so a reader can narrow rather than guess.
    expect(await screen.findByTestId("compare-refused")).toHaveTextContent(
      "more than 5 can be read side by side",
    );
  });

  it("says when every field agrees", async () => {
    server.use(
      http.get("/platform/api/records/:resourceType/compare", () =>
        HttpResponse.json({
          resource_type: "order",
          resource_label: "Orders",
          path: "/orders",
          records: IDS.map((id, index) => ({
            id, title: `REC-0000${index + 1}`, path: `/orders/${id}`, status: "CONFIRMED",
          })),
          fields: [
            { name: "status", label: "Status", kind: "enum",
              values: ["CONFIRMED", "CONFIRMED"], differs: false },
          ],
          differing: 0,
          same: 1,
          limit: 5,
        }),
      ),
    );
    render();
    expect(await screen.findByTestId("compare-identical")).toBeInTheDocument();
  });
});
