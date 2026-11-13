import type { ActivityEntry } from "@/api/activity";

const DAY_MS = 86_400_000;

export function dayKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dayHeading(key: string): string {
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - DAY_MS).toISOString());
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, m! - 1, d).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

/** Entries per day over the last 14 days, oldest first — the strip above the trail. */
export function perDay(items: ActivityEntry[]): Array<{ key: string; label: string; n: number }> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(dayKey(item.occurred_at), (counts.get(dayKey(item.occurred_at)) ?? 0) + 1);
  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date(Date.now() - (13 - index) * DAY_MS);
    const key = dayKey(date.toISOString());
    return { key, label: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }), n: counts.get(key) ?? 0 };
  });
}
