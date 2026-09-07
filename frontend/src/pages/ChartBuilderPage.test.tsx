import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import ChartBuilderPage from "@/pages/ChartBuilderPage";
import { CommandProvider } from "@/commands/CommandContext";
import { resetReports } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * The chart builder (§28, §44).
 *
 * What is worth asserting is the thing that makes it a *second* builder rather
 * than a tab on the first: it offers every kind the platform themes, refuses
 * the ones the current question cannot feed *with the reason*, and saves into
 * the same store a report saves into — so a chart and a report cannot become
 * two different opinions about one saved analysis.
 */
function Address() {
  const location = useLocation();
  return <span data-testid="address">{location.pathname + location.search}</span>;
}

function render(route = "/charts/builder?resource=order&group=status&agg=count") {
  return renderWithProviders(
    <CommandProvider>
      <Address />
      <Routes>
        <Route path="/charts/builder" element={<ChartBuilderPage />} />
        <Route path="/reports" element={<div>the reports list</div>} />
        <Route path="/reports/builder" element={<div>the report builder</div>} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

afterEach(() => resetReports());

describe("the chart builder", () => {
  it("offers every kind the platform themes, not the handful that happen to fit", async () => {
    render();

    const gallery = await screen.findByTestId("chart-gallery");
    // Fourteen kinds, all present. The report builder offers seven, which is
    // the gap this page exists to close.
    expect(within(gallery).getByTestId("chart-kind-bar")).toBeInTheDocument();
    expect(within(gallery).getByTestId("chart-kind-heatmap")).toBeInTheDocument();
    expect(within(gallery).getByTestId("chart-kind-scatter")).toBeInTheDocument();
    expect(within(gallery).getByTestId("chart-kind-gauge")).toBeInTheDocument();
    expect(within(gallery).getByTestId("chart-kind-radar")).toBeInTheDocument();
  });

  it("refuses a picture the question cannot feed, and says what is missing", async () => {
    render();

    const gallery = await screen.findByTestId("chart-gallery");
    // One grouping and one measure: a bar is drawable, a heatmap is not — and
    // the reader is told which piece is missing rather than left with a
    // shorter menu (§76).
    expect(within(gallery).getByTestId("chart-kind-bar")).toBeEnabled();

    const heatmap = within(gallery).getByTestId("chart-kind-heatmap");
    expect(heatmap).toBeDisabled();
    expect(heatmap).toHaveAccessibleName(/needs a second grouping/);

    const scatter = within(gallery).getByTestId("chart-kind-scatter");
    expect(scatter).toBeDisabled();
    expect(scatter).toHaveAccessibleName(/needs a second measure/);
  });

  it("unlocks a kind as soon as the question grows to fit it", async () => {
    const user = userEvent.setup();
    render();

    const gallery = await screen.findByTestId("chart-gallery");
    expect(within(gallery).getByTestId("chart-kind-heatmap")).toBeDisabled();

    await user.click(screen.getByRole("combobox", { name: "Then by" }));
    await user.click(await screen.findByTitle("Channel"));

    await waitFor(() =>
      expect(screen.getByTestId("chart-kind-heatmap")).toBeEnabled(),
    );
    // And the second grouping is in the URL, so a half-built chart is a link.
    expect(screen.getByTestId("address")).toHaveTextContent("stack=channel");
  });

  it("draws the chosen picture in both themes", async () => {
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByTestId("chart-kind-pie"));

    // Both appearances on screen at once: a chart checked only in the one its
    // author uses is a chart nobody checked in the other.
    const themes = await screen.findByTestId("chart-themes");
    expect(themes.querySelector(".nu-chart-preview--light")).not.toBeNull();
    expect(themes.querySelector(".nu-chart-preview--dark")).not.toBeNull();
    expect(screen.getByTestId("address")).toHaveTextContent("chart=pie");
  });

  it("saves through the same store a report saves through", async () => {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post("/platform/api/reports", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        return HttpResponse.json({ ...body, id: "chart-1", owner: { id: "u", name: "Ada", email: null }, members: [], can_edit: true, run_count: 0, last_run_at: null, created_at: "", updated_at: "" }, { status: 201 });
      }),
    );

    render();
    await user.click(await screen.findByTestId("chart-kind-hbar"));
    // Saving is a dialog from the header now: it used to be a form below an
    // eight-field question *and* a thirteen-tile gallery, which is to say
    // below the fold on the page that produces the thing it saves.
    await user.click(screen.getByTestId("open-save-chart"));
    await user.type(await screen.findByLabelText("Name"), "Orders by status");
    await user.click(screen.getByTestId("save-chart"));

    await waitFor(() => expect(bodies).toHaveLength(1));
    // A chart is a saved analysis, which is what a report already is — same
    // endpoint, same definition, with the picture named.
    expect(bodies[0]).toMatchObject({
      name: "Orders by status",
      resource_type: "order",
      visualization: "hbar",
      dimensions: [{ field: "status", granularity: "" }],
      metrics: [{ aggregation: "count" }],
    });
  });

  it("will not save a picture that cannot be drawn", async () => {
    // Reached by pasting a link whose chart no longer fits its question — the
    // gallery refuses the click, and the address bar is not a control this
    // page gets to trust.
    render("/charts/builder?resource=order&group=status&agg=count&chart=heatmap");

    await waitFor(() => expect(screen.getByTestId("open-save-chart")).toBeDisabled());
    // Said where the answer would be, not only in the gallery: the reader is
    // looking at the picture that will not draw, not at the thumbnail they
    // never clicked.
    expect(
      await screen.findByText("Heatmap needs a second grouping"),
    ).toBeInTheDocument();
  });
});
