import type { Profile } from "@/api/profile";

/** Monday first, because that is how every other calendar here is drawn. */
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/**
 * The tabs this page has, and the two it deliberately does not.
 *
 * Exported so the test asserts the *decision* rather than the rendering: a
 * fourth tab added here without a panel would be a dead tab, and a Preferences
 * tab added here would be the second copy this page exists to avoid.
 */
export const TABS = ["overview", "activity", "access"] as const;
export type ProfileTab = (typeof TABS)[number];

export function tabFrom(raw: string | null): ProfileTab {
  return (TABS as readonly string[]).includes(raw ?? "") ? (raw as ProfileTab) : "overview";
}

/**
 * The heatmap, in the shape the chart renderer already reads.
 *
 * Hours across, weekdays down. That way round because a working day is read
 * left to right and there are twenty-four of them against seven rows — the
 * transpose is a tall thin chart nobody can label.
 */
export function heatmapPanel(profile: Profile) {
  const hours = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}`);
  return {
    kind: "heatmap" as const,
    title: "When they work",
    groups: hours,
    categories: [...WEEKDAYS],
    series: profile.heatmap.map((cell) => ({
      name: WEEKDAYS[cell.day] ?? "—",
      group: hours[cell.hour] ?? "—",
      value: cell.value,
    })),
  };
}

/** Tasks completed per week — the shape of "am I getting through more". */
export function throughputPanel(profile: Profile) {
  return {
    kind: "bar" as const,
    title: "Tasks completed, by week",
    series: profile.throughput.map((point) => ({
      name: point.bucket.slice(0, 10),
      value: point.value,
    })),
  };
}

/** Which record types somebody spends their time on. */
export function touchesPanel(profile: Profile) {
  return {
    kind: "hbar" as const,
    title: "What they work on",
    series: profile.touches.map((entry) => ({ name: entry.name, value: entry.value })),
  };
}

/** Somebody's own summary line — role, where they sit, when they arrived. */
export function whereTheySit(profile: Profile): string {
  const parts = [
    profile.role.name,
    profile.department?.name,
    profile.organization?.name,
  ].filter(Boolean);
  return parts.join(" · ") || "No role assigned";
}
