import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AnalysisCatalogue } from "@/api/analysis";
import { QuestionBar } from "@/components/analysis/QuestionBar";
import type { AnalysisDraft } from "@/entities/analysisDraft";
import { analysisCatalogue } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";

/**
 * The question as a sentence (§45): each choice writes the address, and a
 * choice that makes a later one meaningless clears it — a stale column is a
 * question the compiler rejects, reported as though the reader asked for it.
 */
const CATALOGUE = analysisCatalogue as unknown as AnalysisCatalogue;

const DRAFT: AnalysisDraft = {
  resource: "order",
  group: "placed_at",
  grain: "month",
  stack: "",
  aggregation: "sum",
  measure: "total",
  aggregation2: "",
  measure2: "",
  period: "last_90_days",
  chart: "bar",
};

function show(draft: Partial<AnalysisDraft> = {}, withSecondMeasure = false) {
  const onChange = vi.fn();
  renderWithProviders(<QuestionBar catalogue={CATALOGUE} draft={{ ...DRAFT, ...draft }} onChange={onChange} withSecondMeasure={withSecondMeasure} />);
  return onChange;
}

async function choose(label: string, option: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: label }));
  const item = await waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")].find(
      (node) => node.textContent === option,
    );
    if (!found) throw new Error(`${option} not offered for ${label}`);
    return found;
  });
  await user.click(item);
}

describe("the question bar", () => {
  it("clears every column of the old dataset when the dataset changes", async () => {
    const onChange = show();
    await choose("Dataset", "Tickets");
    expect(onChange).toHaveBeenCalledWith({ resource: "ticket", group: null, grain: null, stack: null, measure: null, measure2: null, agg2: null });
  });

  it("offers a bucket only for a date, and clears it when the grouping changes", async () => {
    const onChange = show();
    expect(screen.getByRole("combobox", { name: "Granularity" })).toBeInTheDocument();
    await choose("Granularity", "week");
    expect(onChange).toHaveBeenLastCalledWith({ grain: "week" });
    await choose("Group by", "Status");
    expect(onChange).toHaveBeenLastCalledWith({ group: "status", grain: null });
  });

  it("does not offer a bucket for a category", () => {
    show({ group: "status", grain: "" });
    expect(screen.queryByRole("combobox", { name: "Granularity" })).not.toBeInTheDocument();
  });

  it("splits by a second category, never the first one or a date", async () => {
    const onChange = show({ group: "status" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Then by" }));
    const offered = await waitFor(() => {
      const found = [...document.querySelectorAll<HTMLElement>(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")].map((node) => node.textContent);
      if (!found.length) throw new Error("nothing offered");
      return found;
    });
    expect(offered).toEqual(["Channel"]);
    await choose("Then by", "Channel");
    expect(onChange).toHaveBeenLastCalledWith({ stack: "channel" });
  });

  it("drops the measured column when the aggregation becomes a count", async () => {
    const onChange = show();
    await choose("Aggregation", "Count");
    expect(onChange).toHaveBeenLastCalledWith({ agg: "count", measure: null });
  });

  it("keeps the column for another aggregation, and picks one", async () => {
    const onChange = show();
    await choose("Aggregation", "Avg");
    expect(onChange).toHaveBeenLastCalledWith({ agg: "avg", measure: "total" });
    await choose("Measured column", "Items");
    expect(onChange).toHaveBeenLastCalledWith({ measure: "item_count" });
  });

  it("hides the column for a count", () => {
    show({ aggregation: "count", measure: "" });
    expect(screen.queryByRole("combobox", { name: "Measured column" })).not.toBeInTheDocument();
  });

  it("offers a second measure only where a picture can read one", () => {
    show();
    expect(screen.queryByRole("combobox", { name: "Second aggregation" })).not.toBeInTheDocument();
  });

  it("chooses a second measure and its column, and clears the column for a count", async () => {
    const onChange = show({ aggregation2: "sum", measure2: "total" }, true);
    await choose("Second measured column", "Items");
    expect(onChange).toHaveBeenLastCalledWith({ measure2: "item_count" });
    await choose("Second aggregation", "Count");
    expect(onChange).toHaveBeenLastCalledWith({ agg2: "count", measure2: null });
    await choose("Second aggregation", "Avg");
    expect(onChange).toHaveBeenLastCalledWith({ agg2: "avg", measure2: "total" });
  });

  it("chooses a time range, including all of it", async () => {
    const onChange = show();
    await choose("Period", "All time");
    expect(onChange).toHaveBeenLastCalledWith({ period: "all_time" });
  });

  it("still draws before the catalogue arrives", () => {
    renderWithProviders(<QuestionBar catalogue={undefined} draft={DRAFT} onChange={vi.fn()} />);
    expect(screen.getByTestId("question-bar")).toBeInTheDocument();
  });
});
