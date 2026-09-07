/**
 * Where a ticket stands against the clock it is measured on (§8, §48).
 *
 * A support desk is judged on three moments and one deadline: when the ticket
 * arrived, when somebody first answered, when it was resolved, and when it was
 * promised. A page that prints those four timestamps has printed the inputs to
 * the question rather than the answer, and the answer — *is this one about to
 * cost us, and what is the next thing to do about it* — is the reason anybody
 * opens a ticket at all.
 *
 * The arithmetic is here rather than in the page for the same reason the
 * project's is: the cases that matter are boundaries — resolved after the
 * deadline, breached but still open, due in an hour, never answered — and each
 * of them is one assertion against a fixed clock rather than a browser.
 *
 * Note that `breached` is read from the record, not recomputed. The server
 * decides whether an SLA was missed; a page that decides for itself is a
 * second opinion that will disagree with every report ever run.
 */

export interface TicketFacts {
  createdAt: string | null;
  dueAt: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  resolutionMinutes: number | null;
  breached: boolean;
}

export interface SlaStanding {
  /** What the strip should say about itself, and how urgently. */
  tone: "success" | "danger" | "warning" | "info";
  /** The headline: "Breached", "Resolved", "Due in 5 hours". */
  headline: string;
  /** One line of detail beneath it. */
  detail: string;
  /** Minutes until the deadline; negative once past. `null` with no deadline. */
  minutesLeft: number | null;
  /** Minutes from arrival to the first human answer, when there was one. */
  responseMinutes: number | null;
  /** Minutes from arrival to resolution, preferring the recorded figure. */
  resolutionMinutes: number | null;
}

/** Anything closer than this reads as urgent rather than as a date. */
const SOON_MINUTES = 24 * 60;

export function slaStanding(facts: TicketFacts, now: Date = new Date()): SlaStanding {
  const due = instant(facts.dueAt);
  const created = instant(facts.createdAt);
  const resolved = instant(facts.resolvedAt);
  const responded = instant(facts.firstResponseAt);

  const minutesLeft = due === null ? null : Math.round((due - now.valueOf()) / 60_000);
  const responseMinutes = elapsedMinutes(created, responded);
  const resolutionMinutes =
    facts.resolutionMinutes ?? elapsedMinutes(created, resolved);

  if (resolved !== null) {
    // Resolved late is still resolved, but the page must not congratulate
    // somebody for a ticket that missed its promise.
    return {
      tone: facts.breached ? "warning" : "success",
      headline: facts.breached ? "Resolved late" : "Resolved",
      detail: resolutionMinutes === null
        ? "No resolution time was recorded."
        : `Closed after ${duration(resolutionMinutes)}${
            facts.breached ? ", past the deadline it was given" : ""
          }.`,
      minutesLeft,
      responseMinutes,
      resolutionMinutes,
    };
  }

  const answered = responseMinutes === null
    ? "Nobody has answered it yet."
    : `First answered after ${duration(responseMinutes)}.`;

  if (facts.breached || (minutesLeft !== null && minutesLeft < 0)) {
    return {
      tone: "danger",
      headline: "SLA breached",
      detail: minutesLeft === null
        ? `Marked as breached. ${answered}`
        : `Due ${duration(Math.abs(minutesLeft))} ago. ${answered}`,
      minutesLeft,
      responseMinutes,
      resolutionMinutes: null,
    };
  }

  if (minutesLeft === null) {
    return {
      tone: "info",
      headline: "No deadline",
      detail: `This ticket carries no SLA. ${answered}`,
      minutesLeft,
      responseMinutes,
      resolutionMinutes: null,
    };
  }

  return {
    tone: minutesLeft <= SOON_MINUTES ? "warning" : "info",
    headline: `Due in ${duration(minutesLeft)}`,
    detail: answered,
    minutesLeft,
    responseMinutes,
    resolutionMinutes: null,
  };
}

function elapsedMinutes(from: number | null, to: number | null): number | null {
  if (from === null || to === null) return null;
  return Math.max(0, Math.round((to - from) / 60_000));
}

function instant(value: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).valueOf();
  return Number.isNaN(parsed) ? null : parsed;
}

/** Minutes as the unit a person would use to say them out loud. */
export function duration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.round((minutes % (24 * 60)) / 60);
  return hours ? `${days}d ${hours}h` : `${days}d`;
}
