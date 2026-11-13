import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  calendarApi,
  type CalendarEvent,
  type CalendarOccurrence,
  type CalendarWindow,
  type EventResponse,
} from "@/api/calendar";
import { ApiError } from "@/api/client";
import { usePageCommands } from "@/commands/CommandContext";
import { fromIsoDay, isoDay, movedTo, rangeFor } from "@/lib/calendarGrid";
import { queryKeys } from "@/lib/queryKeys";
import { applyParamChanges } from "@/hooks/useUrlState";

import { PLACES, asView } from "./views";

/**
 * The calendar's state: the view, day and filters in the address, the open
 * and edited events, the window query, answering an invitation and the
 * optimistic reschedule — and the palette commands.
 */
export function useCalendarPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();

  const [opened, setOpened] = useState<CalendarOccurrence | null>(null);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [creatingOn, setCreatingOn] = useState<Date | null>(null);
  const [composing, setComposing] = useState(false);

  const view = asView(params.get("view"));
  // Memoised on the *parameter*, not recomputed: `?? new Date()` is a fresh
  // object every render, so the window below it changed identity every render,
  // the query key with it, and the calendar refetched forever. The lint rule
  // called this a dependency warning; it was an infinite loop.
  const on = params.get("on");
  const anchor = useMemo(() => fromIsoDay(on) ?? new Date(), [on]);
  const category = params.get("category") ?? "";
  const onlyMine = params.get("mine") === "1";

  const set = (changes: Record<string, string | null>) =>
    setParams(
      (current) => applyParamChanges(current, changes),
      // Where the reader *is* ("view", "on") is a place back returns to, so it
      // is pushed; everything else is an adjustment and replaces.
      { replace: !Object.entries(changes).some(([key, value]) => PLACES.has(key) && value) },
    );

  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);

  const events = useQuery({
    queryKey: queryKeys.calendar(range.from.toISOString(), range.to.toISOString(), category, onlyMine),
    queryFn: ({ signal }) =>
      calendarApi.window(
        {
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          ...(category ? { category } : {}),
          ...(onlyMine ? { mine: "1" } : {}),
        },
        signal,
      ),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.calendar() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvent() });
  };

  const answer = useMutation({
    mutationFn: ({ id, response }: { id: string; response: EventResponse }) =>
      calendarApi.respond(id, response),
    onSuccess: (updated) => {
      message.success(`Answered for ${updated.title}`);
      refresh();
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That answer was refused."),
  });

  /**
   * Rescheduling, applied at once and put back if refused (§73).
   *
   * A drag that waits for a round trip before the chip moves reads as a drag
   * that did not take, and somebody drags it again. So the cached window is
   * rewritten immediately and restored if the server says no — the same rule
   * the notification list and the kanban board follow.
   *
   * The occurrence's `event_id` is what is written to, never its `id`: an
   * occurrence id is `<event>:<start>` and only the former is a primary key.
   */
  const reschedule = useMutation({
    mutationFn: ({ item, day }: { item: CalendarOccurrence; day: Date }) => {
      const when = movedTo(item, day);
      // A plain Error: this never reached the server, so there is no status
      // and no correlation id to carry, and inventing either would put a
      // fabricated reference in front of somebody.
      if (!when) throw new Error("That event has no time to move.");
      return calendarApi.update(item.event_id, when);
    },
    onMutate: async ({ item, day }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.calendar() });
      const previous = queryClient.getQueriesData<CalendarWindow>({ queryKey: queryKeys.calendar() });
      const when = movedTo(item, day);
      if (when) {
        queryClient.setQueriesData<CalendarWindow>({ queryKey: queryKeys.calendar() }, (current) =>
          current
            ? {
                ...current,
                items: current.items.map((candidate) =>
                  candidate.id === item.id
                    ? { ...candidate, ...when, day: isoDay(day) }
                    : candidate,
                ),
              }
            : current,
        );
      }
      return { previous };
    },
    onError: (error, _variables, context) => {
      for (const [key, value] of context?.previous ?? []) queryClient.setQueryData(key, value);
      message.error(
        error instanceof ApiError ? error.message : "That event could not be moved.",
      );
    },
    onSuccess: (updated, { day }) => {
      message.success(
        `${updated.title} moved to ${day.toLocaleDateString(undefined, {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}`,
      );
    },
    // Whether it worked or not: the optimistic window is a guess about one
    // event and the server's answer is the truth about all of them.
    onSettled: refresh,
  });

  usePageCommands("calendar", [
    {
      id: "calendar.new",
      label: "Add an event",
      keywords: "meeting calendar event new",
      run: () => {
        setCreatingOn(anchor);
        setComposing(true);
      },
    },
    {
      id: "calendar.today",
      label: "Go to today in the calendar",
      keywords: "today now jump",
      run: () => set({ on: null }),
    },
    {
      id: "calendar.unanswered",
      label: "Show the invitations I have not answered",
      keywords: "rsvp invitation unanswered",
      run: () => set({ view: "agenda", mine: "1" }),
    },
  ]);

  return { opened, setOpened, editing, setEditing, creatingOn, setCreatingOn, composing, setComposing, view, anchor, category, onlyMine, set, events, refresh, answer, reschedule };
}
