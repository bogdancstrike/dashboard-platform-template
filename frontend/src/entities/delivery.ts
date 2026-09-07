/**
 * Whether a project is where it should be (§8, §48).
 *
 * A project detail page that lists `progress: 40`, `budget: 120000` and
 * `spent: 96000` has told a reader three facts and answered no question. The
 * question people open a project to ask is *are we all right*, and the answer
 * lives in the gaps between those numbers: 40% delivered against 80% of the
 * money is a finding; 40% against 38% is a Tuesday.
 *
 * So the arithmetic lives here, once, as plain functions — the page renders
 * what it returns and decides nothing. That also makes it testable at the
 * level that can catch it: the interesting cases are a project that has not
 * started, one with no budget, one already finished and one past its date,
 * and none of those need a browser to assert.
 */

export interface ProjectStanding {
  /** How much of the schedule has been used, 0–100, or `null` with no dates. */
  elapsed: number | null;
  /** How much of the budget has been used, 0–100 and uncapped, or `null`. */
  burn: number | null;
  /** What the team reports as delivered, 0–100. */
  progress: number;
  /** Days until the due date; negative once it is past. `null` with no date. */
  daysLeft: number | null;
  /** Points of progress behind the schedule. Negative means ahead. */
  scheduleGap: number | null;
  /** Points of budget spent beyond the progress delivered. */
  budgetGap: number | null;
  /** `ahead` · `even` · `behind` · `done` — what the gaps add up to. */
  standing: "ahead" | "even" | "behind" | "done";
  /** The same answer as a sentence, for the reader who wants it in words. */
  summary: string;
}

export interface ProjectFacts {
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  budget: number | null;
  spent: number | null;
  progress: number | null;
}

/**
 * Anything further behind than this is worth saying out loud.
 *
 * Ten points rather than zero because a project is never exactly on its line,
 * and a page that reports "behind" at 51% elapsed against 50% delivered has
 * taught its reader to ignore it.
 */
const MEANINGFUL_GAP = 10;

export function projectStanding(facts: ProjectFacts, now: Date = new Date()): ProjectStanding {
  const progress = clamp(facts.progress ?? 0);
  const elapsed = share(facts.startDate, facts.dueDate, now);
  const burn = facts.budget && facts.budget > 0 ? ((facts.spent ?? 0) / facts.budget) * 100 : null;
  const daysLeft = daysUntil(facts.dueDate, now);

  const scheduleGap = elapsed === null ? null : round(elapsed - progress);
  const budgetGap = burn === null ? null : round(burn - progress);

  const standing = facts.completedAt
    ? "done"
    : worst(scheduleGap, budgetGap) > MEANINGFUL_GAP
      ? "behind"
      : best(scheduleGap, budgetGap) < -MEANINGFUL_GAP
        ? "ahead"
        : "even";

  return {
    elapsed,
    burn,
    progress,
    daysLeft,
    scheduleGap,
    budgetGap,
    standing,
    summary: summarise(standing, progress, elapsed, burn, daysLeft),
  };
}

/** How far between two instants "now" is, as a percentage, clamped to 0–100. */
function share(from: string | null, to: string | null, now: Date): number | null {
  const start = instant(from);
  const end = instant(to);
  if (start === null || end === null || end <= start) return null;
  return clamp(((now.valueOf() - start) / (end - start)) * 100);
}

function daysUntil(value: string | null, now: Date): number | null {
  const moment = instant(value);
  if (moment === null) return null;
  return Math.round((moment - now.valueOf()) / 86_400_000);
}

function instant(value: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).valueOf();
  return Number.isNaN(parsed) ? null : parsed;
}

const clamp = (value: number) => Math.min(100, Math.max(0, Math.round(value)));
const round = (value: number) => Math.round(value);
/** The worse of the two gaps, ignoring the one that cannot be computed. */
const worst = (a: number | null, b: number | null) => Math.max(a ?? -Infinity, b ?? -Infinity);
const best = (a: number | null, b: number | null) => Math.min(a ?? Infinity, b ?? Infinity);

function summarise(
  standing: ProjectStanding["standing"],
  progress: number,
  elapsed: number | null,
  burn: number | null,
  daysLeft: number | null,
): string {
  if (standing === "done") return "Delivered and closed.";

  const parts = [`${progress}% delivered`];
  if (elapsed !== null) parts.push(`${elapsed}% of the schedule used`);
  if (burn !== null) parts.push(`${Math.round(burn)}% of the budget spent`);

  const verdict =
    standing === "behind"
      ? "running behind"
      : standing === "ahead"
        ? "running ahead"
        : "tracking together";

  const deadline =
    daysLeft === null
      ? ""
      : daysLeft < 0
        ? `, ${Math.abs(daysLeft)} days past due`
        : `, ${daysLeft} days left`;

  return `${parts.join(" · ")} — ${verdict}${deadline}.`;
}
