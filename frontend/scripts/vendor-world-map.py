#!/usr/bin/env python3
"""Rebuild `src/assets/world-110m.geo.json` from Natural Earth.

    python3 scripts/vendor-world-map.py

Run this only to refresh the vendored basemap; the output is committed so the
application builds and runs with no network. See `src/assets/README.md` for
why it is vendored rather than fetched.

Three things happen here, and the third is the one worth reading.

**TopoJSON is decoded to GeoJSON.** The source is arc-encoded, which saves
about 60 KB before gzip; undoing it at build time is cheaper than shipping a
`topojson-client` dependency to every browser to undo it at run time.

**Coordinates are rounded to two decimals** — about a kilometre, which is finer
than a pixel on a world map in a browser panel.

**Rings that cross the antimeridian are split.** Natural Earth stores Russia,
Fiji and Antarctica as single rings running past ±180°, on the assumption that
whatever draws them applies a projection that knows about the seam. ECharts'
`geo` maps longitude to x linearly, so an unsplit ring draws a horizontal line
straight across the map — which is what the first version of this asset did,
twice. Splitting at the seam and closing each half along the meridian is what
a projection would have done.
"""

from __future__ import annotations

import json
import pathlib
import urllib.request

SOURCE = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json"
TARGET = pathlib.Path(__file__).resolve().parent.parent / "src/assets/world-110m.geo.json"
PRECISION = 2


def decode(topology: dict) -> list[list[list[float]]]:
    """Every arc, as absolute coordinates."""
    scale_x, scale_y = topology["transform"]["scale"]
    shift_x, shift_y = topology["transform"]["translate"]

    arcs = []
    for arc in topology["arcs"]:
        x = y = 0
        points = []
        for dx, dy in arc:
            x += dx
            y += dy
            points.append(
                [round(x * scale_x + shift_x, PRECISION), round(y * scale_y + shift_y, PRECISION)]
            )
        arcs.append(points)
    return arcs


def stitch(indexes: list[int], arcs: list) -> list[list[float]]:
    """One ring, from the arcs it is made of. A negative index runs backwards."""
    ring: list[list[float]] = []
    for index in indexes:
        arc = arcs[~index][::-1] if index < 0 else arcs[index]
        ring.extend(arc if not ring else arc[1:])
    return ring


def split_at_seam(ring: list[list[float]]) -> list[list[list[float]]]:
    """Cut a ring where it crosses ±180°, and close each half at the meridian.

    A step of more than 180° in longitude between neighbouring points is not a
    country that wide; it is the seam. Each resulting run is closed along the
    meridian it left through, which is the shape a projection would have drawn.
    """
    if not ring or max(p[0] for p in ring) - min(p[0] for p in ring) <= 180:
        return [ring]

    runs: list[list[list[float]]] = [[]]
    previous: list[float] | None = None
    for point in ring:
        if previous is not None and abs(point[0] - previous[0]) > 180:
            # Leave through the meridian the previous point was nearest, and
            # re-enter through the other one.
            leaving = 180.0 if previous[0] > 0 else -180.0
            runs[-1].append([leaving, previous[1]])
            runs.append([[-leaving, point[1]]])
        runs[-1].append(point)
        previous = point

    # The first and last runs are two halves of one shape either side of the
    # seam; joining them keeps a country from being drawn as two.
    if len(runs) > 1:
        runs[0] = runs[-1] + runs[0]
        runs.pop()

    closed = []
    for run in runs:
        if len(run) < 4:
            continue
        if run[0] != run[-1]:
            run.append(run[0])
        closed.append(run)
    return closed


def polygons(geometry: dict, arcs: list) -> list[list[list[list[float]]]]:
    """Every polygon of one country, with its rings split at the seam."""
    groups = (
        [geometry["arcs"]] if geometry["type"] == "Polygon" else geometry["arcs"]
    )
    out = []
    for group in groups:
        rings = []
        for indexes in group:
            rings.extend(split_at_seam(stitch(indexes, arcs)))
        if rings:
            out.append(rings)
    return out


def main() -> int:
    with urllib.request.urlopen(SOURCE) as response:  # noqa: S310 - a pinned CDN URL
        topology = json.load(response)

    arcs = decode(topology)
    features = []
    for geometry in topology["objects"]["countries"]["geometries"]:
        if geometry["type"] not in ("Polygon", "MultiPolygon"):
            continue
        shapes = polygons(geometry, arcs)
        if not shapes:
            continue
        features.append({
            "type": "Feature",
            "properties": {"name": geometry["properties"]["name"]},
            "geometry": {"type": "MultiPolygon", "coordinates": shapes},
        })

    TARGET.write_text(
        json.dumps(
            {"type": "FeatureCollection", "features": features}, separators=(",", ":")
        )
        + "\n"
    )
    print(f"{TARGET.name}: {len(features)} countries, {TARGET.stat().st_size:,} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
