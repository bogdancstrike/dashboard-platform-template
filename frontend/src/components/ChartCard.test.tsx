import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/api/client";
import type { ChartPanel } from "@/api/dashboard";
import { ChartCard } from "@/components/ChartCard";
import { renderWithProviders } from "@/test/render";

/**
 * The states a chart has, and the one it used to lie about (§34, §2).
 *
 * A panel whose query failed arrived here as `panel === undefined` with
 * `loading` already false, and the card fell through to its empty state:
 * **"Nothing in this period"**. That is not a state, it is a *finding* — and a
 * reader who takes it as one has been told the quarter was quiet when in fact
 * the request was refused or the server broke. Charts are the surface people
 * screenshot into board packs, so a chart that cannot draw must say it cannot
 * draw.
 *
 * The four states, then: it is loading (a skeleton in the card, not a spinner
 * over a blank one), it has nothing to draw (and says which "nothing" —
 * see the `empty` prop), it failed (which way, with the id to quote), and it
 * has data (which every other suite covers).
 */

const PANEL: ChartPanel = {
  kind: "bar",
  title: "Tickets by severity",
  series: [
    { name: "CRITICAL", value: 4 },
    { name: "HIGH", value: 11 },
  ],
};

/** The failure a refused or broken panel query actually delivers. */
function apiError(status: number, details: Record<string, unknown> = {}) {
  return new ApiError(
    status,
    { error: "panel", message: "That figure could not be computed.", details },
    "chart-trace",
  );
}

describe("a chart panel", () => {
  it("draws a skeleton in the card while it loads, and no empty verdict", () => {
    const view = renderWithProviders(
      <ChartCard id="probe" panel={undefined} loading />,
    );

    expect(view.container.querySelector(".ant-skeleton")).toBeInTheDocument();
    // Not "Nothing in this period" — nothing has been asked yet.
    expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument();
  });

  it("says there is nothing in the period when there is genuinely nothing", () => {
    renderWithProviders(<ChartCard id="probe" panel={{ ...PANEL, series: [] }} />);

    expect(screen.getByTestId("empty-state")).toHaveTextContent("Nothing in this period");
    // And no CSV of nothing.
    expect(screen.getByRole("button", { name: /Download this panel as CSV/ })).toBeDisabled();
  });

  it("lets the caller say which nothing it is", () => {
    // The chart builder's case: the picture the reader chose needs a grouping
    // their question does not have, and the data is fine.
    renderWithProviders(
      <ChartCard
        id="probe"
        panel={undefined}
        empty={{ title: "A treemap needs a grouping", hint: "Pick a dimension." }}
      />,
    );

    expect(screen.getByTestId("empty-state")).toHaveTextContent("A treemap needs a grouping");
    expect(screen.queryByText("Nothing in this period")).not.toBeInTheDocument();
  });

  it.each([
    { status: 403, kind: "forbidden", says: "Your role does not include this figure" },
    { status: 404, kind: "not_found", says: "That figure is no longer published" },
    { status: 500, kind: "failed", says: "This panel could not be drawn" },
  ])("says a $status panel failed rather than showing it as empty", ({ status, kind, says }) => {
    renderWithProviders(
      <ChartCard
        id="probe"
        panel={undefined}
        error={apiError(status, { missing: ["analysis.run"] })}
        onRetry={vi.fn()}
      />,
    );

    const failure = screen.getByTestId("failure-alert");
    expect(failure).toHaveAttribute("data-failure", kind);
    expect(failure).toHaveTextContent(says);
    // The id to quote, and never the empty state's verdict.
    expect(failure).toHaveTextContent("chart-trace");
    expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument();
  });

  it("offers a retry for a fault and not for a refusal", async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    const view = renderWithProviders(
      <ChartCard id="probe" panel={undefined} error={apiError(500)} onRetry={retry} />,
    );

    await user.click(
      within(screen.getByTestId("failure-alert")).getByRole("button", { name: "Retry" }),
    );
    expect(retry).toHaveBeenCalledTimes(1);

    view.unmount();
    renderWithProviders(
      <ChartCard id="probe" panel={undefined} error={apiError(403)} onRetry={retry} />,
    );
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("keeps a failed panel out of the table view as well", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ChartCard id="probe-table" panel={undefined} error={apiError(500)} onRetry={vi.fn()} />,
    );

    // The chart/table switch is chrome and stays usable, but neither view may
    // present a failure as an answer.
    await user.click(screen.getByTitle("Table"));
    expect(screen.getByTestId("failure-alert")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
