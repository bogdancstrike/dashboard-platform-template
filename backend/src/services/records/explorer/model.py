"""The declarations a dataset is made of: metrics, insights, writable fields, identity, the resource."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from src.core.query import Field, FieldSet


@dataclass(frozen=True, slots=True)
class Metric:
    """One headline number a dataset can answer about itself.

    Declared beside the fields rather than computed in a page, for the same
    reason the field catalogue is: a number a screen works out for itself is a
    second definition of it, and the two disagree the first time somebody
    changes what "open" means.
    """

    key: str
    label: str
    #: `count` · `sum` · `avg` · `share` — `share` is the percentage of rows
    #: matching `equals`, which is how "SLA breached" and "overdue" are asked.
    kind: str = "count"
    #: The field aggregated. Required for `sum` and `avg`.
    field: str = ""
    #: For `count` and `share`: restrict to rows whose `field` is one of these.
    equals: tuple[str, ...] = ()
    #: How the client should render it: `number` · `currency` · `percent` ·
    #: `hours`. A formatting hint, not a unit conversion.
    format: str = "number"
    hint: str = ""


@dataclass(frozen=True, slots=True)
class Insight:
    """What a dataset can say about the rows currently in view.

    Three shapes, because three questions are worth answering above a list:
    *how much* (metrics), *of what kinds* (breakdowns) and *going which way*
    (a trend). Anything more specific belongs on a report.
    """

    metrics: tuple[Metric, ...] = ()
    #: Faceted fields worth charting rather than only filtering by.
    breakdowns: tuple[str, ...] = ()
    #: The date field a time series is drawn over, when one makes sense.
    trend: str = ""
    #: Aggregated alongside the trend, when the dataset has money or effort in
    #: it. Empty means the trend counts rows.
    trend_value: str = ""


@dataclass(frozen=True, slots=True)
class Writable:
    """One field a create or edit form may write, and the limits on it.

    Deliberately a *second* declaration rather than a flag on :class:`Field`:
    what a column can be filtered by and what a form may put into it are two
    different questions, and answering both from one place is how a dataset
    ends up accidentally editable because somebody wanted to sort by it.

    Everything a form needs to *render* the control — label, kind, choices —
    still comes from the `Field`, so a writable field cannot describe itself
    differently from the way the same field is filtered.
    """

    name: str
    #: Refused as empty on create. An edit may still omit it entirely; what it
    #: may not do is blank it.
    required: bool = False
    #: Inclusive bounds for number fields, enforced server-side. A percentage
    #: column that accepts 400 is a chart with a bar off the top of the panel.
    minimum: float | None = None
    maximum: float | None = None


@dataclass(frozen=True, slots=True)
class Identity:
    """The human-readable identifier a created record is given.

    Generated, never accepted from the client: `TSK-00042` is the string people
    quote to each other, and a form that lets two of them be typed produces two
    records nobody can tell apart in a sentence.
    """

    field: str
    prefix: str
    width: int = 5


@dataclass(frozen=True, slots=True)
class Resource:
    """Everything the generic explorer needs to expose one ORM entity."""

    key: str
    label: str
    description: str
    model: type
    fields: FieldSet
    default_columns: tuple[str, ...]
    default_sort: str = "updated_at"
    permission: str = "records.view"
    #: The route the entity pages live under — `/tickets`, `/customers`.
    #: Plural because that is what a list is, and a URL is read by people.
    route: str = ""
    #: Which field names a record on its own detail page, which one identifies
    #: it in a sentence, and which one carries its state. Declared rather than
    #: guessed: a heading that reads "a1f3c8de-…" is a heading nobody can use.
    title_field: str = "name"
    subtitle_field: str = ""
    status_field: str = "status"
    #: Long-form fields read as document sections in record previews. Explicit
    #: opt-in keeps a new database column from becoming public by accident.
    content_fields: tuple[str, ...] = ()
    #: What this dataset can say about itself above a list (§44).
    insight: Insight = Insight()
    #: The fields a form may write (§9). Empty means the dataset is read-only,
    #: and the API says so rather than silently ignoring a payload.
    editable: tuple[Writable, ...] = ()
    #: How a created record is named. Absent means the dataset cannot be
    #: created through the API, only edited.
    identity: Identity | None = None

    @property
    def writable(self) -> dict[str, Writable]:
        """The write declarations by field name, for validation and for the
        catalogue the form is rendered from."""
        return {spec.name: spec for spec in self.editable}

    def writability(self, name: str) -> dict[str, Any]:
        """What a form may do with one field (§9).

        Carried *on* the field wherever fields are published rather than in a
        list beside them: a form renders the fields it is given, and a separate
        "editable" array is a second place for the two to disagree about which
        field `progress` is.
        """
        spec = self.writable.get(name)
        if spec is None:
            return {"editable": False}
        field = self.fields.by_name.get(name)
        return {
            "editable": True,
            "required": spec.required,
            "minimum": spec.minimum,
            "maximum": spec.maximum,
            # What a foreign key points at, so a form renders a picker for it
            # rather than a box somebody has to paste a UUID into. Read off the
            # column's own ForeignKey, so a new relation gets its picker the
            # day it is declared.
            "references": references_of(field) if field else "",
        }

    @property
    def path(self) -> str:
        return self.route or f"/{self.key}s"

    def label_for(self, row: Any) -> str:
        """What to call one record, in one place, so every screen agrees."""
        for name in (self.title_field, self.subtitle_field, "reference", "code", "name"):
            value = getattr(row, name, None) if name else None
            if value:
                return str(value)
        return str(getattr(row, "id", ""))


#: Datasets that are pickable but not explorable. People have a directory of
#: their own (`/api/directory/people`), which is the business card a viewer is
#: allowed to see rather than the user administration record.
_PICKABLE_TABLES = {"users": "user"}


#: The dataset registry, bound by `explorer.registry` when it loads: a field
#: names the dataset its foreign key points at without the model importing the
#: registry that is built from it.
_registry: Callable[[], dict[str, Any]] = dict


def bind_registry(provider: Callable[[], dict[str, Any]]) -> None:
    global _registry
    _registry = provider


def references_of(field: Field) -> str:
    """Which dataset a foreign-key column points at, named as a picker wants it.

    Derived from the schema, never listed here: the column already carries its
    `ForeignKey`, and a second table-to-dataset mapping kept by hand is wrong
    the first time anybody adds a relation.
    """
    for key in getattr(field.column, "foreign_keys", set()) or set():
        table = key.column.table.name
        if table in _PICKABLE_TABLES:
            return _PICKABLE_TABLES[table]
        for resource in _registry().values():
            if getattr(resource.model, "__tablename__", "") == table:
                return resource.key
    return ""
