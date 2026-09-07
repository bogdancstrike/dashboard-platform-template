"""Where the places in this dataset actually are (§44, §61).

A record carries a city and a country as *text* — "Amsterdam", "Netherlands" —
because that is what a person types and what a report prints. A map needs a
latitude and a longitude, and nothing in the schema has one.

The two are reconciled here, by a gazetteer: the thirty cities this platform's
data uses, each with its real coordinates, its country and the region it
belongs to. That is a lookup table of facts about the world, not data about the
business, which is why it lives in `core` beside the vocabularies rather than
in a column somebody would have to backfill.

Three consequences worth stating.

**No migration and no reseed.** The join is `customers.city = "Amsterdam"`,
done at query time. Adding coordinates as columns would mean a schema change
and a backfill for every existing row, to store a fact that has not changed
since the city was founded.

**The seed picks from this list**, so a city that can be seeded is a city that
can be placed. The alternative — two lists, one to generate and one to map —
is a map with holes in it the first time anybody adds a city to one of them.

**What cannot be placed is counted, never dropped.** `PLACES` covers the
cities this dataset uses; a row naming somewhere else is real and has to be
reported as unplaced. A map that silently omits rows is a map that answers a
different question from the list beside it.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Place:
    """One city, where it is, and which country and region hold it."""

    city: str
    country: str
    #: The region code in `regions.code` — `WEU`, `NAM`, `APA`.
    region: str
    latitude: float
    longitude: float


#: Every city this platform's data uses. Coordinates are the city centre, to
#: two decimal places — roughly a kilometre, which is the precision a dot on a
#: world map can express.
PLACES: tuple[Place, ...] = (
    Place("Amsterdam", "Netherlands", "WEU", 52.37, 4.90),
    Place("Rotterdam", "Netherlands", "WEU", 51.92, 4.48),
    Place("Berlin", "Germany", "WEU", 52.52, 13.40),
    Place("Munich", "Germany", "WEU", 48.14, 11.58),
    Place("Paris", "France", "WEU", 48.86, 2.35),
    Place("Lyon", "France", "WEU", 45.76, 4.84),
    Place("Madrid", "Spain", "WEU", 40.42, -3.70),
    Place("Milan", "Italy", "WEU", 45.46, 9.19),
    Place("Bucharest", "Romania", "CEU", 44.43, 26.10),
    Place("Cluj-Napoca", "Romania", "CEU", 46.77, 23.60),
    Place("Timișoara", "Romania", "CEU", 45.75, 21.23),
    Place("Warsaw", "Poland", "CEU", 52.23, 21.01),
    Place("Kraków", "Poland", "CEU", 50.06, 19.94),
    Place("Prague", "Czechia", "CEU", 50.08, 14.44),
    Place("Budapest", "Hungary", "CEU", 47.50, 19.04),
    Place("Vienna", "Austria", "CEU", 48.21, 16.37),
    Place("Stockholm", "Sweden", "NEU", 59.33, 18.07),
    Place("Gothenburg", "Sweden", "NEU", 57.71, 11.97),
    Place("Copenhagen", "Denmark", "NEU", 55.68, 12.57),
    Place("Oslo", "Norway", "NEU", 59.91, 10.75),
    Place("Helsinki", "Finland", "NEU", 60.17, 24.94),
    Place("London", "United Kingdom", "UKI", 51.51, -0.13),
    Place("Manchester", "United Kingdom", "UKI", 53.48, -2.24),
    Place("Dublin", "Ireland", "UKI", 53.35, -6.26),
    Place("New York", "United States", "NAM", 40.71, -74.01),
    Place("Austin", "United States", "NAM", 30.27, -97.74),
    Place("Toronto", "Canada", "NAM", 43.65, -79.38),
    Place("Singapore", "Singapore", "APA", 1.35, 103.82),
    Place("Sydney", "Australia", "APA", -33.87, 151.21),
    Place("Tokyo", "Japan", "APA", 35.68, 139.65),
)

PLACES_BY_CITY: dict[str, Place] = {place.city: place for place in PLACES}


@dataclass(frozen=True, slots=True)
class Region:
    """A commercial region: the grouping a business reports by."""

    code: str
    name: str
    timezone: str
    currency: str


#: The regions the platform is organised into. `regions.code` in the database
#: holds the code; a screen that shows "NEU" where it could show "Northern
#: Europe" is a screen written for whoever built the seed.
REGIONS: tuple[Region, ...] = (
    Region("WEU", "Western Europe", "Europe/Amsterdam", "EUR"),
    Region("CEU", "Central Europe", "Europe/Bucharest", "EUR"),
    Region("NEU", "Northern Europe", "Europe/Stockholm", "SEK"),
    Region("UKI", "United Kingdom & Ireland", "Europe/London", "GBP"),
    Region("NAM", "North America", "America/New_York", "USD"),
    Region("APA", "Asia Pacific", "Asia/Singapore", "USD"),
)

REGIONS_BY_CODE: dict[str, Region] = {region.code: region for region in REGIONS}


def region_name(code: str) -> str:
    """What to call a region, falling back to its code when it is unknown."""
    region = REGIONS_BY_CODE.get(code)
    return region.name if region else code

#: What a country is called on the world map the frontend draws, where that
#: differs from what the records call it.
#:
#: Declared rather than left to chance: a name that does not match is a country
#: that stays uncoloured, which looks exactly like a country with no customers.
#: That is the one failure a choropleth cannot survive, and it is silent.
MAP_NAMES: dict[str, str] = {
    "United States": "United States of America",
}


def map_name(country: str) -> str:
    """What the world map calls this country."""
    return MAP_NAMES.get(country, country)


def place_for(city: str | None) -> Place | None:
    """The gazetteer entry for a city, or `None` when it is somewhere else."""
    return PLACES_BY_CITY.get((city or "").strip()) if city else None
