"""Records on a map (§44, §61).

The analysis compiler groups one table by its own columns, deliberately: it
does not join, because a compiler that joins is a compiler with a second
language in it. That is exactly why a map needs its own service. "Where are our
orders?" is answered by the *customer's* city, and "how is the fleet doing in
Northern Europe?" by the region a device's row points at — one hop away, in
another table, every time.

So this is not a second copy of the compiler; it is the one shape of question
the compiler cannot express. What it deliberately keeps is the compiler's
habits:

**Aggregated in PostgreSQL.** One `GROUP BY` per view, not a fetch of every row
followed by a count in Python. A map of four thousand devices that downloads
four thousand devices is a map nobody waits for (§71).

**Everything is declared.** Which datasets can be mapped, how each one reaches
a place, and what may be measured on it are the `MAPPABLE` table below —
checked against the same `Resource` permission the list and the explorer check,
so a caller who may not read devices cannot read where the devices are.

**What cannot be placed is counted, never dropped.** A row whose city is not in
the gazetteer, or which names no place at all, is real: "1 240 customers, 89 of
which we cannot place" is the honest sentence, and a map that quietly draws
1 151 dots answers a different question from the list beside it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import Numeric, cast, func, select

from src.core import geography
from src.core.errors import ValidationError
from src.services.analysis import period_window
from src.services.explorer import _base_statement, resource_for

#: What a dataset can be measured by on a map. `count` measures rows; anything
#: else names a numeric column and is summed.
Metric = tuple[str, str, str]


@dataclass(frozen=True, slots=True)
class Mappable:
    """One dataset, and how a row of it reaches a place on the map.

    A dataset arrives at a place one of two ways: it carries the place itself
    (a customer has a city), or it points at something that does (an order has
    a customer). Anything further than one hop is not a map, it is a graph —
    `/find/relationships` already draws those.
    """

    key: str
    label: str
    #: The column on this model holding the city, when it has one.
    city_column: str = ""
    #: `(related model attribute on this model, related model, its city column)`
    #: when the place is one hop away.
    via: tuple[str, str, str] | None = None
    #: The FK column naming a row in `regions`, when the model has one.
    region_column: str = ""
    #: `(key, label, column)` — `column` empty means "count the rows".
    metrics: tuple[Metric, ...] = (("count", "Records", ""),)


def _mappable() -> dict[str, Mappable]:
    """Built lazily so importing this module does not pull every model."""
    return {
        "customer": Mappable(
            "customer", "Customers",
            city_column="city",
            region_column="region_id",
            metrics=(
                ("count", "Accounts", ""),
                ("value", "Lifetime value", "lifetime_value"),
                ("open_orders", "Open orders", "open_orders"),
            ),
        ),
        "device": Mappable(
            "device", "Devices",
            # A device's location reads "Berlin — Depot 4": the site matters to
            # whoever visits it and the city is what a map can place.
            city_column="location",
            region_column="region_id",
            metrics=(
                ("count", "Devices", ""),
                ("errors", "Errors", "error_count"),
                ("uptime", "Uptime hours", "uptime_hours"),
            ),
        ),
        "order": Mappable(
            "order", "Orders",
            via=("customer_id", "customer", "city"),
            region_column="region_id",
            metrics=(("count", "Orders", ""), ("revenue", "Revenue", "total")),
        ),
        "ticket": Mappable(
            "ticket", "Tickets",
            via=("customer_id", "customer", "city"),
            metrics=(("count", "Tickets", ""),),
        ),
        "project": Mappable(
            "project", "Projects",
            via=("customer_id", "customer", "city"),
            region_column="region_id",
            metrics=(("count", "Projects", ""), ("budget", "Budget", "budget")),
        ),
    }


def catalogue(*, principal) -> dict[str, Any]:
    """What can be put on a map, and what may be measured on it."""
    datasets = []
    for entry in _mappable().values():
        resource = resource_for(entry.key)
        if not principal.can(resource.permission):
            continue
        datasets.append({
            "key": entry.key,
            "label": entry.label,
            "path": resource.path,
            # How this dataset reaches a place, said out loud: a reader
            # comparing "orders" with "customers" is entitled to know that the
            # orders are drawn at their customer's city and not their own.
            "placed_by": "own city" if entry.city_column else "the customer's city",
            "metrics": [
                {"key": key, "label": label, "field": field}
                for key, label, field in entry.metrics
            ],
        })

    return {
        "datasets": datasets,
        # The map's own vocabulary of places, so the frontend never guesses a
        # coordinate or a country name.
        "places": [
            {
                "city": place.city,
                "country": place.country,
                "map_name": geography.map_name(place.country),
                "region": place.region,
                "region_name": geography.region_name(place.region),
                "latitude": place.latitude,
                "longitude": place.longitude,
            }
            for place in geography.PLACES
        ],
    }


def places(session, args, *, principal) -> dict[str, Any]:
    """Where one dataset is, measured one way, over one period."""
    entry = _mappable().get(str((args or {}).get("dataset") or "customer"))
    if entry is None:
        raise ValidationError(
            "That dataset cannot be put on a map.",
            details={"available": sorted(_mappable())},
        )
    resource = resource_for(entry.key, principal=principal)
    key, label, column = _metric(entry, (args or {}).get("metric"))
    window = period_window((args or {}).get("period") or "all_time")

    statement = _base_statement(resource)
    if window.start is not None:
        statement = statement.where(resource.model.created_at >= window.start)
    if window.end is not None:
        statement = statement.where(resource.model.created_at <= window.end)

    statement, city = _placed(entry, resource, statement)
    measure = (
        func.count()
        if not column
        else func.coalesce(func.sum(cast(getattr(resource.model, column), Numeric)), 0)
    )

    rows = session.execute(
        statement.with_only_columns(city.label("city"), func.count().label("rows"),
                                    measure.label("value"))
        .group_by(city)
    ).all()

    total = 0
    measured = 0.0
    by_city: dict[str, dict[str, Any]] = {}
    unplaced = {"rows": 0, "value": 0.0}

    for row in rows:
        count = int(row.rows or 0)
        value = float(row.value or 0)
        total += count
        measured += value
        place = geography.place_for(_city_of(row.city))
        if place is None:
            unplaced["rows"] += count
            unplaced["value"] += value
            continue
        current = by_city.setdefault(
            place.city,
            {
                "city": place.city,
                "country": place.country,
                "map_name": geography.map_name(place.country),
                "region": place.region,
                "region_name": geography.region_name(place.region),
                "latitude": place.latitude,
                "longitude": place.longitude,
                "rows": 0,
                "value": 0.0,
            },
        )
        # Several sites in one city — "Berlin — Depot 4" and "Berlin — Office
        # 9" — are one dot, because that is what a dot on a world map can be.
        current["rows"] += count
        current["value"] += value

    points = sorted(by_city.values(), key=lambda item: -item["value"] or -item["rows"])

    return {
        "dataset": entry.key,
        "dataset_label": entry.label,
        "path": resource.path,
        "metric": {"key": key, "label": label, "field": column},
        "period": {
            "key": window.key,
            "from": window.start.isoformat() if window.start else None,
            "to": window.end.isoformat() if window.end else None,
        },
        "points": points,
        "countries": _fold(points, "map_name"),
        # Named, not coded: "NEU" in a table is a table written for whoever
        # built the seed.
        "regions": _fold(points, "region_name"),
        "total": total,
        "measured": measured,
        # Reported, never dropped. A map that silently omits rows answers a
        # different question from the list beside it.
        "unplaced": unplaced,
    }


def _fold(points: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    """The same points added up one level higher — by country, or by region."""
    folded: dict[str, dict[str, Any]] = {}
    for point in points:
        bucket = folded.setdefault(
            str(point[key]), {"name": point[key], "rows": 0, "value": 0.0, "cities": 0}
        )
        bucket["rows"] += point["rows"]
        bucket["value"] += point["value"]
        bucket["cities"] += 1
    return sorted(folded.values(), key=lambda item: -item["value"] or -item["rows"])


def _metric(entry: Mappable, requested: Any) -> Metric:
    name = str(requested or "").strip() or entry.metrics[0][0]
    for metric in entry.metrics:
        if metric[0] == name:
            return metric
    raise ValidationError(
        "That dataset cannot be measured that way.",
        details={"metric": name, "allowed": [metric[0] for metric in entry.metrics]},
    )


def _placed(entry: Mappable, resource, statement):
    """The statement that can see a place, and the column holding it.

    An outer join, not an inner one: an order whose customer has been removed
    is still an order, and dropping it here would make the map's total quietly
    smaller than the list's. It lands in `unplaced` instead, which is where a
    row nobody can place belongs.
    """
    if entry.city_column:
        return statement, getattr(resource.model, entry.city_column)

    hop, related_key, column = entry.via or ("", "", "")
    related = resource_for(related_key).model
    joined = statement.join(
        related, getattr(resource.model, hop) == related.id, isouter=True
    )
    return joined, getattr(related, column)


def _city_of(value: Any) -> str:
    """The city out of whatever the column holds.

    A device's location is "Berlin — Depot 4"; a customer's city is "Berlin".
    Splitting on the separator the seed writes keeps one gazetteer serving both
    rather than a second lookup keyed on site strings.
    """
    text = str(value or "").strip()
    return text.split("—")[0].strip() if "—" in text else text
