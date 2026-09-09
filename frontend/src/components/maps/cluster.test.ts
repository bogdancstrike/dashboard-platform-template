import { describe, expect, it } from "vitest";

import type { MapPoint } from "@/api/maps";
import {
  clusterMarkers,
  describeCluster,
  overlaps,
  type Placed,
} from "@/components/maps/cluster";

/**
 * Clustering, asserted as geometry (§50).
 *
 * The tracker left this open with a good argument: "at thirty cities there is
 * nothing to cluster, and a clustering rule tuned against thirty points is a
 * rule that will be wrong at three thousand". Both halves are answered by
 * making the rule about *pixels*: whether two bubbles would overlap does not
 * depend on how many there are, and at continental zoom Amsterdam, Brussels
 * and London overlap with only thirty cities in the dataset.
 *
 * So these tests are plane geometry with no canvas in sight — which is the
 * point of keeping the projection in the component and the rule in a pure
 * function.
 */

const city = (name: string, value: number, at: [number, number] = [0, 0]): MapPoint => ({
  city: name,
  country: "Netherlands",
  map_name: "Netherlands",
  region: "EMEA",
  region_name: "Europe",
  longitude: at[0],
  latitude: at[1],
  rows: 1,
  value,
});

const placed = (point: MapPoint, x: number, y: number, radius = 10): Placed => ({
  point,
  x,
  y,
  radius,
});

describe("whether two markers overlap", () => {
  it("is about the drawn radius, not the distance on the ground", () => {
    const a = placed(city("Amsterdam", 10), 100, 100, 20);
    const b = placed(city("Brussels", 5), 130, 100, 8);

    // 30px apart, 28px of radius between them, 3px of insisted-on gap.
    expect(overlaps(a, b)).toBe(true);
    // The same two cities, drawn small: no overlap, so no cluster.
    expect(overlaps({ ...a, radius: 6 }, { ...b, radius: 6 })).toBe(false);
  });

  it("insists on a gap, because touching circles read as one blob", () => {
    const a = placed(city("A", 1), 0, 0, 10);
    const b = placed(city("B", 1), 20, 0, 10);

    expect(overlaps(a, b, 0)).toBe(false);
    expect(overlaps(a, b, 3)).toBe(true);
  });
});

describe("clustering the markers", () => {
  it("leaves markers that do not overlap alone", () => {
    const clusters = clusterMarkers([
      placed(city("Amsterdam", 10, [4.9, 52.4]), 100, 100),
      placed(city("Tokyo", 8, [139.7, 35.7]), 500, 200),
    ]);

    expect(clusters).toHaveLength(2);
    // A cluster of one is a *point*: its coordinate is the city's own, not a
    // centroid that has drifted.
    expect(clusters[0]!.points.map((point) => point.city)).toEqual(["Amsterdam"]);
    expect(clusters[0]!.longitude).toBeCloseTo(4.9);
  });

  it("merges a chain of overlapping cities into one smear", () => {
    // Each overlaps the next and only the next. The reader sees one blob, so
    // it is one bubble — three overlapping bubbles would be the same mess
    // with extra steps.
    const clusters = clusterMarkers([
      placed(city("Amsterdam", 3, [4.9, 52.4]), 100, 100),
      placed(city("Brussels", 2, [4.35, 50.85]), 118, 100),
      placed(city("Paris", 1, [2.35, 48.85]), 136, 100),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.points.map((point) => point.city)).toEqual([
      "Amsterdam",
      "Brussels",
      "Paris",
    ]);
  });

  it("adds up what it holds, because a bubble answers the same question", () => {
    const clusters = clusterMarkers([
      placed({ ...city("Amsterdam", 300, [5, 52]), rows: 12 }, 100, 100),
      placed({ ...city("Brussels", 100, [4, 51]), rows: 4 }, 110, 100),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.value).toBe(400);
    expect(clusters[0]!.rows).toBe(16);
  });

  it("sits where the weight is, not in the geometric middle", () => {
    // Three quarters of the measure is in Amsterdam, so the bubble belongs
    // near Amsterdam: a marker drawn at the midpoint of a big city and a
    // small one points at a place where almost nothing happened.
    const clusters = clusterMarkers([
      placed(city("Amsterdam", 300, [5, 52]), 100, 100),
      placed(city("Brussels", 100, [4, 48]), 110, 100),
    ]);

    expect(clusters[0]!.longitude).toBeCloseTo(4.75);
    expect(clusters[0]!.latitude).toBeCloseTo(51);
  });

  it("still places a cluster whose measure is zero everywhere", () => {
    // "No revenue anywhere this period" is an answer, and a weighted mean of
    // zeros is a division by zero drawn in the Gulf of Guinea.
    const clusters = clusterMarkers([
      placed(city("Amsterdam", 0, [6, 52]), 100, 100),
      placed(city("Brussels", 0, [4, 50]), 105, 100),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.longitude).toBeCloseTo(5);
    expect(clusters[0]!.latitude).toBeCloseTo(51);
  });

  it("is the same picture whichever order the points arrive in", () => {
    const points = [
      placed(city("Amsterdam", 3, [5, 52]), 100, 100),
      placed(city("Brussels", 9, [4, 51]), 112, 100),
      placed(city("Tokyo", 5, [139, 35]), 400, 300),
    ];
    const names = (input: Placed[]) =>
      clusterMarkers(input).map((cluster) => cluster.points.map((point) => point.city));

    expect(names(points)).toEqual(names([...points].reverse()));
    // Seeded from the largest, so the cluster leads with Brussels.
    expect(names(points)[0]).toEqual(["Brussels", "Amsterdam"]);
  });

  it("names what it swallowed, and says how many it did not name", () => {
    const cluster = clusterMarkers(
      ["A", "B", "C", "D", "E", "F"].map((name, index) =>
        placed(city(name, 10 - index, [index, 0]), 100 + index, 100),
      ),
    )[0]!;

    expect(describeCluster(cluster)).toBe("A, B, C, D and 2 more");
    expect(describeCluster(cluster, 6)).toBe("A, B, C, D, E, F");
  });
});
