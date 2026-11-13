import { type CalendarView } from "@/lib/calendarGrid";

/** The address keys that are places rather than adjustments (§history). */
export const PLACES = new Set(["view", "on"]);

export const VIEW_LABELS: Record<CalendarView, string> = {
  month: "Month",
  week: "Week",
  day: "Day",
  agenda: "Agenda",
};

export function asView(raw: string | null): CalendarView {
  return raw === "week" || raw === "day" || raw === "agenda" ? raw : "month";
}
