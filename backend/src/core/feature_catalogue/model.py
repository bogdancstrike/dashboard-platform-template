"""What a feature is, and the areas features belong to."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Feature:
    key: str
    name: str
    description: str
    #: Who owns it — the navigation area it lives in.
    area: str
    stage: str = "GA"
    experimental: bool = False
    default_on: bool = True
    default_rollout: int = 100
    requires: tuple[str, ...] = ()
    #: Frontend routes (React Router paths) that show the switched-off page.
    routes: tuple[str, ...] = ()
    #: Navigation item keys hidden from the menu.
    nav: tuple[str, ...] = ()
    #: UI pieces outside the routes that disappear (human-readable).
    components: tuple[str, ...] = ()
    #: `api_url` patterns from `maps/endpoint.json` that refuse when off.
    endpoints: tuple[str, ...] = ()
    #: Background job codes skipped while the flag is off everywhere.
    jobs: tuple[str, ...] = ()
    #: Live-channel message `type`s not delivered to a reader without it.
    live: tuple[str, ...] = ()
    #: Endpoint *payload* rules enforced in the service (documented here).
    payload_rules: tuple[str, ...] = field(default_factory=tuple)


#: The areas, in the order the administration screen groups them.
AREAS: tuple[tuple[str, str], ...] = (
    ("overview", "Overview"),
    ("ai", "AI"),
    ("find", "Find"),
    ("analyse", "Analyse"),
    ("work", "Work"),
    ("collaboration", "Collaboration"),
    ("records", "Records"),
    ("data", "Data"),
    ("platform", "Platform"),
    ("developers", "Developers"),
)
