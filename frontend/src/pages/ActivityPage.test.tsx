import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import ActivityPage from "@/pages/ActivityPage";
import { CommandProvider } from "@/commands/CommandContext";
import { renderWithProviders } from "@/test/render";

/**
 * The activity feed (§35).
 *
 * What is worth asserting is what makes a feed usable rather than decorative:
 * the strip counts the whole match and holds still when it is used, a kind
 * with nothing in it is offered and refused rather than hidden, the day
 * headings appear where the day changes, and the sentence is the server's.
 */
function Address() {
  const location = useLocation();
  return <span data-testid="address">{location.pathname + location.search}</span>;
}

function render(route = "/activity") {
  return renderWithProviders(
    <CommandProvider>
      <Address />
      <Routes>
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/projects/:id" element={<div>the project</div>} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

describe("the activity feed", () => {
  it("counts every kind over the whole match, not the rows on screen", async () => {
    render();

    const strip = await screen.findByTestId("activity-kinds");
    // 30 across the strip against three rows in the feed: the counts are the
    // server's answer about the period, not an accounting of the page (§71).
    expect(within(strip).getByText("30")).toBeInTheDocument();
    expect(within(screen.getByTestId("activity-feed")).getAllByRole("listitem")).toHaveLength(3);
  });

  it("offers a kind with nothing in it, refused, rather than hiding it", async () => {
    render();

    // A chip that vanishes when nothing has happened teaches a reader that the
    // platform has stopped recording that kind (§76).
    const empty = await screen.findByTestId("activity-kind-FILE");
    expect(empty).toBeDisabled();
    expect(empty).toHaveTextContent("Files");
    expect(empty).toHaveTextContent("0");
  });

  it("narrows to a kind without moving the other counts", async () => {
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByTestId("activity-kind-COMMENT"));

    // The question is in the address, so a narrowed feed is a link (§69).
    await waitFor(() => expect(screen.getByTestId("address")).toHaveTextContent("kind=COMMENT"));

    const feed = screen.getByTestId("activity-feed");
    await waitFor(() => expect(within(feed).getAllByRole("listitem")).toHaveLength(1));
    // …and the strip still says what it said, because a strip whose numbers
    // change as you use it cannot be used to compare.
    const strip = screen.getByTestId("activity-kinds");
    expect(within(strip).getByText("30")).toBeInTheDocument();
    expect(within(strip).getByTestId("activity-kind-SECURITY")).toHaveTextContent("4");
  });

  it("groups the rows under the day they happened on", async () => {
    render();

    const feed = await screen.findByTestId("activity-feed");
    // Two on the 7th and one on the 5th, so two headings rather than three
    // rows each stamped with a date.
    expect(within(feed).getAllByRole("heading")).toHaveLength(2);
  });

  it("prints the sentence the server composed, and opens what it is about", async () => {
    render();

    const feed = await screen.findByTestId("activity-feed");
    const row = within(feed).getByText(/changed the status of project Billing replatform/);
    // A link, not a spliced sentence: `core/audit` composes the summary, and a
    // client that appended the subject to one written by hand produced
    // "updated the Viewer role Viewer".
    expect(row.closest("a")).toHaveAttribute("href", "/projects/project-1");
  });

  it("does not pretend an event about nothing in particular is a link", async () => {
    render();

    const feed = await screen.findByTestId("activity-feed");
    const row = within(feed).getByText("started acting as Uma User");
    expect(row.closest("a")).toBeNull();
  });

  it("says nothing happened rather than drawing an empty list", async () => {
    render("/activity?kind=FILE");

    // Reached by a link rather than a click, since the chip is refused — and
    // the page still has to say what it means (§34).
    expect(await screen.findByText("Nothing happened here")).toBeInTheDocument();
  });
});
