import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import CalendarPage from "@/pages/CalendarPage";
import { calendarEvents, resetCalendar } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * The calendar's failure paths and the week grid's own add (§19): a refused
 * move that snaps back, a window that cannot load, and an hour slot that
 * starts an event at that hour.
 */
function render(route = "/calendar?on=2026-03-10") {
  return renderWithProviders(
    <Routes>
      <Route path="/calendar" element={<CalendarPage />} />
    </Routes>,
    { route },
  );
}

afterEach(() => resetCalendar());

describe("when something fails", () => {
  it("snaps a refused move back and says why", async () => {
    const user = userEvent.setup();
    server.use(
      http.put("/platform/api/calendar/events/:id", () =>
        HttpResponse.json({ error: "conflict", message: "Room Aurora is booked that day." }, { status: 409 }),
      ),
    );
    render();
    await screen.findByTestId("calendar-month");
    const chip = screen.getByTestId("event-event-1:2026-03-10T09:00:00+00:00");
    chip.focus();
    await user.keyboard("{ArrowDown}");
    expect(await screen.findByText("Room Aurora is booked that day.")).toBeInTheDocument();
    expect(String(calendarEvents.find((item) => item["event_id"] === "event-1")?.["starts_at"])).toContain("2026-03-10");
    await waitFor(() => expect(screen.getByTestId("event-event-1:2026-03-10T09:00:00+00:00")).toBeInTheDocument());
  });

  it("says the calendar could not be loaded, and retries", async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(
      http.get("/platform/api/calendar/events", () => {
        calls += 1;
        return HttpResponse.json({ error: "unavailable", message: "The calendar store is not answering." }, { status: 503 });
      }),
    );
    render();
    expect(await screen.findByText("The calendar store is not answering.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(calls).toBeGreaterThan(1));
  });
});

describe("the week grid", () => {
  it("starts a new event at the hour that was clicked", async () => {
    const user = userEvent.setup();
    render("/calendar?on=2026-03-10&view=week");
    const slots = await screen.findAllByRole("button", { name: /^New event .* at / });
    await user.click(slots[0]!);
    expect(await screen.findByTestId("event-form")).toBeInTheDocument();
  });

  it("opens an event from the week grid", async () => {
    const user = userEvent.setup();
    render("/calendar?on=2026-03-10&view=week");
    const chip = await screen.findByTestId("event-event-1:2026-03-10T09:00:00+00:00");
    await user.click(chip);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
