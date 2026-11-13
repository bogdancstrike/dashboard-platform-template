import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import type { CalendarEvent } from "@/api/calendar";
import { EventEditor, recurrenceOf } from "@/components/calendar/EventEditor";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * The event form (§19): once or repeating, all day or timed, and what it
 * sends — because a wrong rule produces a series nobody ever sees.
 */
const CATEGORIES = ["MEETING", "DEADLINE", "OUT_OF_OFFICE"];

const STANDUP = {
  id: "event-9:1",
  event_id: "event-9",
  title: "Stand-up",
  category: "MEETING",
  location: "Room Aurora",
  description: "Fifteen minutes.",
  all_day: false,
  starts_at: "2026-03-10T09:00:00Z",
  ends_at: "2026-03-10T09:15:00Z",
  participants: [{ user_id: "user-1", name: "Ada Administrator", email: "admin@nucleus.example", initials: "AA", response: "ACCEPTED" }],
  recurrence: { freq: "WEEKLY", interval: 1, byday: ["MO", "WE"] },
  recurrence_until: "2026-06-30T00:00:00Z",
  recurrence_text: "every week on Monday and Wednesday",
  reminder_minutes: 10,
  can_edit: true,
} as unknown as CalendarEvent;

function open(props: Partial<Parameters<typeof EventEditor>[0]> = {}) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(<EventEditor open event={null} categories={CATEGORIES} onClose={onClose} onSaved={onSaved} {...props} />);
  return { onSaved, onClose };
}

describe("the repeat rule", () => {
  it("is nothing for a one-off, and never an interval below one", () => {
    expect(recurrenceOf({ repeat: "NONE" })).toBeNull();
    expect(recurrenceOf({ repeat: "DAILY", interval: 0 })).toEqual({ freq: "DAILY", interval: 1 });
    expect(recurrenceOf({ repeat: "MONTHLY", interval: 3, byday: ["MO"] })).toEqual({ freq: "MONTHLY", interval: 3 });
    expect(recurrenceOf({ repeat: "WEEKLY", interval: 2, byday: ["TU", "TH"] })).toEqual({ freq: "WEEKLY", interval: 2, byday: ["TU", "TH"] });
    expect(recurrenceOf({ repeat: "WEEKLY" })).toEqual({ freq: "WEEKLY", interval: 1 });
  });
});

describe("a new event", () => {
  it("wants a title, then adds a weekly series on chosen days", async () => {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post("/platform/api/calendar/events", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        return HttpResponse.json({ ...STANDUP, ...body, event_id: "event-new" }, { status: 201 });
      }),
    );
    const { onSaved } = open({ day: new Date("2026-04-07T00:00:00Z") });
    expect(screen.getByText("New event")).toBeInTheDocument();
    await user.click(screen.getByTestId("save-event"));
    expect(await screen.findByText(/needs a (title|name)|Say what|required/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText("What is it"), "Ünïcode review ✓");
    await user.click(screen.getByText("Weekly"));
    expect(await screen.findByTestId("repeat-detail")).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Days" }));
    const tuesday = await waitFor(() => {
      const found = [...document.querySelectorAll<HTMLElement>(".ant-select-item-option")].find((node) => /Tue/.test(node.textContent ?? ""));
      if (!found) throw new Error("no Tuesday");
      return found;
    });
    await user.click(tuesday);
    await user.click(screen.getByTestId("save-event"));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(bodies[0]).toMatchObject({ title: "Ünïcode review ✓", category: "MEETING", recurrence: { freq: "WEEKLY", interval: 1, byday: ["TU"] }, all_day: false });
    // The day the reader clicked, at nine.
    expect(String(bodies[0]!["starts_at"])).toContain("2026-04-07");
  });

  it("reports a refused save in the server's words", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("/platform/api/calendar/events", () =>
        HttpResponse.json({ error: "conflict", message: "Room Aurora is booked then." }, { status: 409 }),
      ),
    );
    open();
    await user.type(screen.getByLabelText("What is it"), "Clash");
    await user.click(screen.getByTestId("save-event"));
    expect(await screen.findByText("Room Aurora is booked then.")).toBeInTheDocument();
  });

  it("switches to whole days", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("switch", { name: "All day" }));
    expect(screen.getByRole("switch", { name: "All day" })).toBeChecked();
  });
});

describe("an existing event", () => {
  it("warns before editing a series, and saves every occurrence with its rule", async () => {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.put("/platform/api/calendar/events/:id", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        return HttpResponse.json({ ...STANDUP, ...body });
      }),
    );
    const { onSaved } = open({ event: STANDUP });
    expect(screen.getByText("Edit event")).toBeInTheDocument();
    expect(screen.getByText("This repeats every week on Monday and Wednesday")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Stand-up")).toBeInTheDocument();
    await user.click(screen.getByText("Monthly"));
    await user.click(screen.getByTestId("save-event"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(bodies[0]).toMatchObject({ recurrence: { freq: "MONTHLY", interval: 1 }, reminder_minutes: 10 });
    expect(bodies[0]!["recurrence_until"]).toContain("2026-06-30");
  });

  it("makes a series a one-off again, and drops its horizon", async () => {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.put("/platform/api/calendar/events/:id", async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(STANDUP);
      }),
    );
    open({ event: STANDUP });
    await user.click(screen.getByText("Once"));
    await waitFor(() => expect(screen.queryByTestId("repeat-detail")).not.toBeInTheDocument());
    await user.click(screen.getByTestId("save-event"));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ recurrence: null, recurrence_until: null });
  });

  it("asks before throwing away an edit", async () => {
    const user = userEvent.setup();
    const { onClose } = open({ event: STANDUP });
    await user.type(screen.getByDisplayValue("Stand-up"), "!");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect((await screen.findAllByText("Discard your changes?")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalled();
  });
});
