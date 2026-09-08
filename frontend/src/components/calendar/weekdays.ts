/**
 * Weekday codes, in the order a week runs (§19).
 *
 * One list, because the editor offers them and the server's expander reads
 * them: `services/calendar.WEEKDAYS` is the same seven strings in the same
 * order, and a second spelling here ("TUE" for Tuesday, say) would produce a
 * rule the server accepts and the expander silently drops — a series nobody
 * ever sees.
 */
export const WEEKDAY_CODES: ReadonlyArray<{ code: string; label: string }> = [
  { code: "MO", label: "Monday" },
  { code: "TU", label: "Tuesday" },
  { code: "WE", label: "Wednesday" },
  { code: "TH", label: "Thursday" },
  { code: "FR", label: "Friday" },
  { code: "SA", label: "Saturday" },
  { code: "SU", label: "Sunday" },
];
