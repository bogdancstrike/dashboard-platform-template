/**
 * Markers that would sit on top of each other, merged into one (§50).
 *
 * The rule is **screen distance, not data**. Two customers 200km apart are two
 * dots at street level and one blob at continental zoom, and which of those is
 * true depends entirely on how far the reader has zoomed out — so a rule
 * written in kilometres, or in "cluster above N points", is a rule that is
 * wrong at every zoom but the one it was tuned at. This one asks the only
 * question that matters to somebody looking at the picture: *would these two
 * bubbles overlap?* If they would, they are drawn as one, and zooming in
 * splits them the moment they no longer do.
 *
 * That is also why this file takes pixels rather than coordinates. The caller
 * projects through ECharts' own geo transform (`convertToPixel`), which knows
 * the current zoom and pan; here it is plane geometry, and therefore testable
 * without a canvas.
 *
 * A cluster of one is a *point*, not a bubble: a "1" drawn in a circle tells
 * the reader nothing they could not see, and it hides the city name a single
 * marker's tooltip gives them.
 */

import type { MapPoint } from "@/api/maps";

/** One marker, projected to where it is actually drawn. */
export interface Placed {
  point: MapPoint;
  x: number;
  y: number;
  /** Half the symbol size, in pixels — what decides overlap. */
  radius: number;
}

/** One drawn marker: a city, or the several a reader cannot tell apart yet. */
export interface Cluster {
  /** Biggest first, so the label and the tooltip lead with the main one. */
  points: MapPoint[];
  /** Where to draw it: the measure-weighted centre of what it holds. */
  longitude: number;
  latitude: number;
  /** The sums, because a cluster answers the same question as its parts. */
  value: number;
  rows: number;
}

/**
 * How much clear space to insist on between two markers, in pixels.
 *
 * Not zero: two circles that touch exactly are two circles a reader has to
 * look twice at. Not large either — a generous gap merges cities that are
 * perfectly distinguishable, and the reader loses the city names for nothing.
 */
export const GAP = 3;

/** Whether two drawn markers overlap, allowing for the gap. */
export function overlaps(a: Placed, b: Placed, gap: number = GAP): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy) < a.radius + b.radius + gap;
}

/**
 * Group the markers that overlap, biggest first.
 *
 * Greedy from the largest marker outwards, and *transitively*: a chain of
 * cities each overlapping the next is one cluster, because that is what the
 * reader sees — a smear. Seeding from the largest keeps the outcome stable and
 * puts the cluster where the weight is rather than wherever the iteration
 * happened to start.
 *
 * Deterministic for a given set of pixels: ties break on the city name, so the
 * same view produces the same picture twice and a test can assert a shape
 * rather than a set.
 */
export function clusterMarkers(placed: Placed[], gap: number = GAP): Cluster[] {
  const order = [...placed].sort(
    (a, b) => b.point.value - a.point.value || a.point.city.localeCompare(b.point.city),
  );
  const taken = new Set<Placed>();
  const clusters: Cluster[] = [];

  for (const seed of order) {
    if (taken.has(seed)) continue;
    taken.add(seed);
    const members = [seed];
    // Transitive: each newly absorbed marker can pull in its own neighbours,
    // which is what makes a chain of overlapping cities one smear rather than
    // three overlapping bubbles.
    for (let index = 0; index < members.length; index += 1) {
      for (const candidate of order) {
        if (taken.has(candidate)) continue;
        if (!overlaps(members[index]!, candidate, gap)) continue;
        taken.add(candidate);
        members.push(candidate);
      }
    }
    clusters.push(collect(members.map((member) => member.point)));
  }

  return clusters;
}

/** The sums, and where the bubble goes. */
function collect(points: MapPoint[]): Cluster {
  const ordered = [...points].sort(
    (a, b) => b.value - a.value || a.city.localeCompare(b.city),
  );
  const value = ordered.reduce((sum, point) => sum + point.value, 0);
  const rows = ordered.reduce((sum, point) => sum + point.rows, 0);
  // Weighted by the measure, so a bubble holding Berlin and a village sits on
  // Berlin. Falling back to the plain mean when every value is zero, which is
  // a legitimate answer — "no revenue anywhere in this period".
  const weight = value || ordered.length;
  const share = (pick: (point: MapPoint) => number) =>
    ordered.reduce((sum, point) => sum + pick(point) * (value ? point.value : 1), 0) / weight;

  return {
    points: ordered,
    longitude: share((point) => point.longitude),
    latitude: share((point) => point.latitude),
    value,
    rows,
  };
}

/** What a cluster's tooltip and label call it. */
export function describeCluster(cluster: Cluster, limit = 4): string {
  const names = cluster.points.slice(0, limit).map((point) => point.city);
  const rest = cluster.points.length - names.length;
  return rest > 0 ? `${names.join(", ")} and ${rest} more` : names.join(", ");
}
