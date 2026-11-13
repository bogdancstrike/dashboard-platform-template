import type { FeatureFlag, FlagControls } from "@/api/settings";

/**
 * What a flag's reach adds up to, in words.
 *
 * Pure and exported. This is the sentence the page exists to say: off, on for
 * everybody, on for a named set, and on for a share of people. "50%" on its
 * own is the one answer that leaves a reader guessing.
 */
export function reachOf(flag: FeatureFlag): string {
  if (!flag.enabled) return "Off for everybody";
  const named = namedTargets(flag);

  if (flag.rollout_percentage >= 100) {
    return named.length > 0 ? `Everybody (and ${named.join(", ")})` : "Everybody";
  }
  if (flag.rollout_percentage <= 0) {
    return named.length > 0 ? `Only ${named.join(", ")}` : "Nobody — no rollout and nobody named";
  }
  const share = `${flag.rollout_percentage}% of people, always the same ones`;
  return named.length > 0 ? `${share}, plus ${named.join(", ")}` : share;
}

/** The roles, people, groups and organizations a flag names, each in words. */
function namedTargets(flag: FeatureFlag): string[] {
  const named: string[] = [];
  if (flag.target_roles.length > 0) named.push(flag.target_roles.join(", "));
  if (flag.target_user_ids.length > 0) {
    named.push(
      `${flag.target_user_ids.length} named ${flag.target_user_ids.length === 1 ? "person" : "people"}`,
    );
  }
  const groups = flag.target_group_ids?.length ?? 0;
  if (groups > 0) named.push(`${groups} ${groups === 1 ? "group" : "groups"}`);
  const orgs = flag.target_organization_ids?.length ?? 0;
  if (orgs > 0) named.push(`${orgs} ${orgs === 1 ? "organization" : "organizations"}`);
  return named;
}

/** How much a switch-off takes away, counted — empty when the flag gates nothing known. */
export function blastRadius(controls: FlagControls | undefined): string[] {
  if (!controls) return [];
  const parts: string[] = [];
  const count = (n: number, one: string, many: string) => (n > 0 ? [`${n} ${n === 1 ? one : many}`] : []);
  parts.push(...count(controls.routes.length, "page", "pages"));
  parts.push(...count(controls.components.length, "component", "components"));
  parts.push(...count(controls.endpoints.length, "API endpoint", "API endpoints"));
  parts.push(...count(controls.jobs.length, "background job", "background jobs"));
  parts.push(...count(controls.dependents.length, "dependent flag", "dependent flags"));
  return parts;
}

/** The flags that pass the state and search filters, grouped by product area in the catalogue's order. */
export function groupedFlags(
  items: FeatureFlag[],
  areas: Array<{ key: string; label: string }> | undefined,
  state: string,
  term: string,
): Array<[string, FeatureFlag[]]> {
  const needle = term.trim().toLowerCase();
  const visible = items.filter(
    (flag) =>
      (state !== "PARTIAL" || flag.partial) &&
      (!needle ||
        flag.key.includes(needle) ||
        flag.name.toLowerCase().includes(needle) ||
        (flag.description ?? "").toLowerCase().includes(needle)),
  );
  const areaOrder = (areas ?? []).map((area) => area.key);
  const grouped = new Map<string, FeatureFlag[]>();
  for (const flag of visible) {
    const area = flag.area ?? "custom";
    grouped.set(area, [...(grouped.get(area) ?? []), flag]);
  }
  return [...grouped.entries()].sort(
    ([a], [b]) => (areaOrder.indexOf(a) + 1 || 999) - (areaOrder.indexOf(b) + 1 || 999),
  );
}
