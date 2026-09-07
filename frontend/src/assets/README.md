# Vendored assets

## `world-110m.geo.json`

Country outlines for the map page (§44, §61), at 1:110 000 000 — the
resolution a world map in a browser panel can express, and small enough
(171 KB raw, ~53 KB gzipped) to sit inside the map route's lazy chunk rather
than in the main bundle.

**Source**: [Natural Earth](https://www.naturalearthdata.com) via
[`world-atlas@2`](https://github.com/topojson/world-atlas)
(`countries-110m.json`), public domain. Converted from TopoJSON to GeoJSON
once and committed, rather than decoded at runtime: the alternative is a
`topojson-client` dependency in the browser bundle to undo a compression that
saves 60 KB before gzip.

Coordinates are rounded to two decimal places, which is about a kilometre —
finer than a pixel at this scale.

**Why it is vendored rather than fetched.** The stack runs offline behind
`docker compose up`, and a map that is blank without a CDN is a map that is
blank in exactly the environment this template exists to demonstrate.

Country names in `properties.name` are Natural Earth's. Where the platform's
own records spell one differently — "United States" against "United States of
America" — the difference is declared in `core/geography.py:MAP_NAMES` and
asserted by a test, because a name that does not match is a country that stays
uncoloured, which looks exactly like a country with no customers.
