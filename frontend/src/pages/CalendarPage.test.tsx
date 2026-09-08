import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import CalendarPage from "@/pages/CalendarPage";
import { CommandProvider } from "@/commands/CommandContext";
import { calendarEvents, resetCalendar } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";

/**
 * The calendar page (§19).
 *
 * The date arithmetic is asserted in `lib/calendarGrid.test.ts`, where it is a
 * pure function. What is worth asserting here is what the *page* decides: that
 * the view and the day are in the address, that a day showing more than fits
 * offers a way to see the rest, that a clash is named rather than counted,
 * that an unanswered invitation is a filter and not a decoration, and that
 * answering one is a single click in the agenda.
 */
function Address() {
  const location = useLocation();
  return <span data-testid="address">{location.pathname + location.search}</span>;
}

/**
 * Anchored on a fixed day, always.
 *
 * The fixture answers any window with the same March 2026 events, so the tests
 * name the month they mean rather than depending on the day the suite runs.
 */
function render(route = "/calendar?on=2026-03-10") {
  return renderWithProviders(
    <CommandProvider>
      <Address />
      <Routes>
        <Route path="/calendar" element={<CalendarPage />} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

afterEach(() => resetCalendar());

describe("the month view", () => {
  it("draws six weeks and puts each event in its own day", async () => {
    render();

    const grid = await screen.findByTestId("calendar-month");
    // The whole of March, plus the neighbouring days that fill the grid.
    expect(within(grid).getByTestId("day-2026-03-10")).toBeInTheDocument();
    expect(within(grid).getByTestId("day-2026-02-23")).toBeInTheDocument();

    const tenth = screen.getByTestId("day-2026-03-10");
    expect(within(tenth).getByText("Delivery review")).toBeInTheDocument();
    expect(within(tenth).getByText("Morning standup")).toBeInTheDocument();
  });

  it("says how many events a day has, for a reader who cannot see the grid", async () => {
    render();

    await screen.findByTestId("calendar-month");
    // The count is in the label, so a screen reader hears it rather than
    // counting list items. Read off the cell rather than matched as a whole
    // sentence: the date half is `toLocaleDateString`'s, so a regex spelling
    // it "10 March" passes in one locale and fails in another.
    expect(screen.getByTestId("day-2026-03-10").getAttribute("aria-label")).toContain(
      "2 events",
    );
    expect(screen.getByTestId("day-2026-03-16").getAttribute("aria-label")).toContain(
      "1 event",
    );
  });

  it("names a clash rather than counting it", async () => {
    render();

    await screen.findByTestId("calendar-month");
    // "Clashes with the Morning standup" is actionable; "1 conflict" is a hunt
    // through the reader's own calendar.
    const chip = screen.getByTestId("event-event-1:2026-03-10T09:00:00+00:00");
    expect(within(chip).getByLabelText("Clashes")).toBeInTheDocument();
  });

  it("opens a day when its date is clicked, keeping it in the address", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByTestId("calendar-month");
    await user.click(screen.getByLabelText("Open 2026-03-12"));

    // The view and the day are a link somebody can send (§69).
    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent("view=day"),
    );
    expect(screen.getByTestId("address")).toHaveTextContent("on=2026-03-12");
  });
});

describe("the header", () => {
  it("promotes unanswered invitations, because that is the only count that is a to-do", async () => {
    const user = userEvent.setup();
    render();

    // One invitation is unanswered in the fixture.
    const tag = await screen.findByText("1 to answer");
    await user.click(tag);

    // And it is a filter, not a decoration.
    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent("view=agenda"),
    );
    expect(screen.getByTestId("address")).toHaveTextContent("mine=1");
  });

  it("keeps the view in the address, so a week is a link", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByTestId("calendar-month");
    await user.click(screen.getByTitle("Week"));

    await waitFor(() => expect(screen.getByTestId("calendar-week")).toBeInTheDocument());
    expect(screen.getByTestId("address")).toHaveTextContent("view=week");
  });

  it("steps a month at a time, and Today comes back", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByTestId("calendar-month");
    const before = screen.getByTestId("cal-title").textContent;
    await user.click(screen.getByLabelText("Next"));

    await waitFor(() =>
      expect(screen.getByTestId("cal-title").textContent).not.toBe(before),
    );
    await user.click(screen.getByTestId("cal-today"));
    // Today drops the anchor from the address rather than writing today's
    // date into it — a link that says "today" still means today tomorrow.
    await waitFor(() =>
      expect(screen.getByTestId("address")).not.toHaveTextContent("on="),
    );
  });

  it("narrows to one kind, server-side, and says how many of each there are", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByTestId("calendar-month");
    await user.click(screen.getByRole("combobox", { name: "Kind" }));
    // The count comes with the choice, so somebody can see there is one
    // holiday before filtering to it.
    await user.click(await screen.findByTitle("Holiday (1)"));

    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent("category=HOLIDAY"),
    );
    await waitFor(() =>
      expect(screen.queryByText("Delivery review")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Public holiday")).toBeInTheDocument();
  });
});

describe("the week view", () => {
  it("draws an hour band derived from the events, not a fixed working day", async () => {
    render("/calendar?on=2026-03-10&view=week");

    const week = await screen.findByTestId("calendar-week");
    // An all-day marker gets its own band: placed at midnight it would drag
    // the hour band down to 00:00 and leave eight empty rows.
    expect(within(week).getByTestId("week-day-2026-03-10")).toBeInTheDocument();
    expect(screen.getByLabelText(/Tuesday 09:00/)).toBeInTheDocument();
  });
});

describe("the agenda", () => {
  it("answers an invitation in one click, without opening anything", async () => {
    const user = userEvent.setup();
    render("/calendar?on=2026-03-10&view=agenda");

    const agenda = await screen.findByTestId("calendar-agenda");
    // The reason somebody opens their own agenda is usually to answer these.
    const row = within(agenda).getByTestId(
      "agenda-event-2:2026-03-10T09:30:00+00:00",
    );

    // Nothing is chosen until the reader chooses. This is what the first
    // version of the control got wrong: a `Segmented` with no value
    // highlights its *first* option, so every unanswered invitation read as
    // "Going" — beside the words "You have not answered yet."
    const buttons = within(row).getByTestId("response-buttons");
    for (const label of ["Going", "Maybe", "No"]) {
      expect(within(buttons).getByRole("button", { name: label })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }

    await user.click(within(buttons).getByRole("button", { name: "Going" }));

    await waitFor(() =>
      expect(
        calendarEvents.find((item) => item["event_id"] === "event-2")?.["my_response"],
      ).toBe("ACCEPTED"),
    );
  });

  it("names a repeat beside the occurrence it is drawing", async () => {
    render("/calendar?on=2026-03-10&view=agenda");

    const agenda = await screen.findByTestId("calendar-agenda");
    // So a reader knows why editing would move five of them.
    expect(
      within(agenda).getByText(/every week on Thursday, until 2026-06-30/),
    ).toBeInTheDocument();
  });

  it("strikes through a cancelled event rather than only dimming it", async () => {
    render("/calendar?on=2026-03-10&view=agenda");

    const agenda = await screen.findByTestId("calendar-agenda");
    const row = within(agenda).getByTestId("agenda-event-5:2026-03-11T11:00:00+00:00");
    // Colour alone is not a fact (§64) — and a cancelled event offers no
    // answer control, because there is nothing to answer.
    expect(row.className).toContain("nu-agenda-row--cancelled");
    expect(within(row).queryByTestId("response-buttons")).not.toBeInTheDocument();
  });
});

describe("an event opened", () => {
  async function open(title = "Delivery review") {
    const user = userEvent.setup();
    render();
    await screen.findByTestId("calendar-month");
    await user.click(screen.getByText(title));
    return { user, drawer: await screen.findByRole("dialog") };
  }

  it("leads with what it is and who is coming", async () => {
    const { drawer } = await open();
    expect(within(drawer).getByText("Delivery review")).toBeInTheDocument();
    // Twice on purpose: once as an attendee, once as "organised by".
    expect(within(drawer).getAllByText("Ada Administrator")).toHaveLength(2);
    expect(within(drawer).getByText("organiser")).toBeInTheDocument();
    // In words, not a colour: "no answer" and "not going" are different facts.
    expect(within(drawer).getByText("going")).toBeInTheDocument();
  });

  it("names the clash, and says it is the reader's own", async () => {
    const { drawer } = await open();
    expect(within(drawer).getByTestId("event-clash")).toHaveTextContent(
      "Clashes with Morning standup",
    );
  });

  it("warns that an edit changes the whole series, before it is used", async () => {
    const { drawer } = await open("Weekly sync");
    // Not after the save, in a toast: an editor that silently changed one
    // occurrence — or all of them — loses an afternoon either way.
    expect(
      within(drawer).getByText(/Repeats every week on Thursday/),
    ).toBeInTheDocument();
    expect(
      within(drawer).getByText(/changes every occurrence/),
    ).toBeInTheDocument();
  });

  it("offers the answer control to somebody invited, and no edit controls", async () => {
    const { drawer } = await open("Morning standup");
    // Answering needs no permission beyond being invited; editing needs both
    // `calendar.manage` and being the organiser.
    expect(within(drawer).getByTestId("my-response")).toBeInTheDocument();
    expect(within(drawer).getByText("You have not answered yet.")).toBeInTheDocument();
    // And the control agrees with that sentence rather than contradicting it.
    expect(
      within(drawer).getByRole("button", { name: "Going" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(within(drawer).queryByTestId("edit-event")).not.toBeInTheDocument();
    expect(within(drawer).queryByTestId("cancel-event")).not.toBeInTheDocument();
  });

  it("answers from the drawer, through the same endpoint the agenda uses", async () => {
    const { user, drawer } = await open("Morning standup");
    await user.click(within(drawer).getByRole("button", { name: "Maybe" }));

    await waitFor(() =>
      expect(
        calendarEvents.find((item) => item["event_id"] === "event-2")?.["my_response"],
      ).toBe("TENTATIVE"),
    );
  });

  it("says what cancelling a series does and does not undo", async () => {
    const { user, drawer } = await open("Weekly sync");
    await user.click(within(drawer).getByTestId("cancel-event"));

    expect(await screen.findAllByText("Cancel Weekly sync?")).not.toHaveLength(0);
    expect(
      screen.getAllByText(/Every occurrence of this repeat is cancelled/),
    ).not.toHaveLength(0);
  });
});
