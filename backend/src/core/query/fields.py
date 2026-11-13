"""Field and FieldSet: what a dataset declares it can filter, sort and search."""

from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field as dataclass_field
from typing import Any

from sqlalchemy import String, cast

from src.core.query.operators import OPERATORS_BY_KIND

#: A filter value long enough to be a mistake or an attack, not a search term.
MAX_FILTER_CHARS = 500


#: Guards `IN (...)` against a client pasting a whole column into one parameter.
MAX_FILTER_VALUES = 200


KINDS = frozenset({"text", "enum", "bool", "number", "datetime", "uuid", "json", "array"})


@dataclass(frozen=True, slots=True)
class Field:
    """One column an endpoint exposes to filtering, sorting and search."""

    name: str
    column: Any
    kind: str = "text"
    sortable: bool = True
    filterable: bool = True
    #: Included in the free-text `q` sweep. Only ever text-shaped columns: a
    #: `q` that silently matches a UUID prefix looks broken to whoever typed it.
    searchable: bool = False
    #: Offer distinct values with counts so the filter menu is built from the
    #: data rather than a hardcoded list that drifts.
    facet: bool = False
    #: Human label the frontend query builder shows for this field.
    label: str = ""
    #: Fixed choice list for enum fields, so the builder can render a select
    #: without a round trip.
    choices: tuple[str, ...] = ()
    #: Extra names this column may be sorted by, for URLs already in the wild.
    #: Deliberately not filter parameters: two spellings of one filter is how a
    #: column ends up narrowed twice by contradictory clauses.
    aliases: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.kind not in KINDS:  # pragma: no cover - programmer error
            raise ValueError(f"unknown field kind {self.kind!r}")

    @property
    def title(self) -> str:
        """The heading and query-builder label for this column.

        Sentence case, not Title Case: it is what the explicit labels in the
        resource declarations already use ("Due date", "SLA breached"), and a
        column list mixing "Battery Percent" with "Due date" reads as two
        products. An acronym or a unit still needs an explicit `label`.
        """
        if self.label:
            return self.label
        spaced = self.name.replace("_", " ")
        return spaced[:1].upper() + spaced[1:]

    @property
    def expression(self):
        """The comparable SQL expression. JSON/array columns are compared as
        their rendered text — cheap enough for a filter nobody runs in a loop,
        and the alternative is a generated column plus a migration per filter."""
        if self.kind in ("json", "array"):
            return cast(self.column, String)
        return self.column


@dataclass(frozen=True, slots=True)
class FieldSet:
    fields: tuple[Field, ...]
    by_name: dict[str, Field] = dataclass_field(default_factory=dict)

    def __init__(self, *fields: Field) -> None:
        object.__setattr__(self, "fields", tuple(fields))
        index: dict[str, Field] = {}
        for spec in fields:
            index[spec.name] = spec
            for alias in spec.aliases:
                index[alias] = spec
        object.__setattr__(self, "by_name", index)

    @property
    def searchable(self) -> tuple[Field, ...]:
        return tuple(f for f in self.fields if f.searchable)

    @property
    def facets(self) -> tuple[Field, ...]:
        return tuple(f for f in self.fields if f.facet)

    def sort_column(self, name: str, fallback: str):
        spec = self.by_name.get(name)
        if spec is None or not spec.sortable:
            spec = self.by_name[fallback]
        return spec.column

    def describe(self) -> list[dict[str, Any]]:
        """The field catalogue the advanced query builder is generated from
        (§4). Shipping it from the same declaration the SQL is built from is
        what stops the builder offering an operator the backend cannot honour."""
        return [
            {
                "name": f.name,
                "label": f.title,
                "kind": f.kind,
                "sortable": f.sortable,
                "filterable": f.filterable,
                "searchable": f.searchable,
                "facet": f.facet,
                "operators": sorted(OPERATORS_BY_KIND.get(f.kind, ())),
                "choices": list(f.choices),
            }
            for f in self.fields
        ]
