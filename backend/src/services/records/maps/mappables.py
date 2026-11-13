"""What can be put on a map, and the map catalogue."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from src.core import geography
from src.services.records.explorer import resource_for

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
