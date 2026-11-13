"""Records placed on the map, folded by city."""

from __future__ import annotations

from typing import Any

from sqlalchemy import Numeric, cast, func

from src.core import geography
from src.core.errors import ValidationError
from src.services.analytics.analysis import period_window
from src.services.records.explorer import _base_statement, resource_for
from src.services.records.maps.mappables import Mappable, Metric, _mappable


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
