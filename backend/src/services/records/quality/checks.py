"""The data-quality check model."""

from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field as dataclass_field
from datetime import timedelta
from typing import Any, Callable

from src.core.clock import iso, now
from src.services.records.explorer import Resource

VIEW_PERMISSION = "records.view"


#: Records named per check on the page. Enough to recognise the problem,
#: few enough that the count stays the headline — the same reasoning as the
#: bulk preview's sample.
SAMPLE = 5


#: How long since a customer was last spoken to before it is worth saying.
STALE_CONTACT_DAYS = 180


#: How long a device may be silent before somebody should look.
SILENT_DEVICE_DAYS = 14


@dataclass(frozen=True)
class Check:
    """One thing that can be wrong with a dataset.

    `filters` is the whole point: it is what a reader could type in the URL, so
    the count and the link are provably the same question. A check that needs
    SQL the filter vocabulary cannot express carries `predicate` instead and
    publishes a sample — see the module docstring.
    """

    key: str
    resource: str
    title: str
    #: What goes wrong downstream if this is left. The reason the check exists,
    #: in the words somebody would use to justify spending an hour on it.
    why: str
    #: What to do about it. A finding with no remedy is a complaint.
    fix: str
    severity: str = "WARNING"
    filters: dict[str, Any] = dataclass_field(default_factory=dict)
    #: For the checks a filter cannot express. Takes the resource and returns a
    #: SQLAlchemy clause, or a whole statement when the check is about
    #: duplication rather than about one row.
    predicate: Callable[[Resource], Any] | None = None

    @property
    def linkable(self) -> bool:
        return self.predicate is None


def _relative(days: int) -> str:
    """A moment the filter vocabulary understands, rounded to the day.

    Computed per request rather than frozen into the catalogue: "not contacted
    in six months" has to mean six months from *today*, and a constant would
    make the check slowly stop finding anything.

    Rounded to midnight, which matters twice. It is what a reader means — a
    task due at nine this morning is not "past its due date" at two in the
    afternoon, whatever the clock says — and it makes the *link* stable: a
    query string carrying `…T01:21:22.598686Z` is an address that means
    something different every time the page is opened, and two calls a
    millisecond apart produced two different links.
    """
    moment = (now() - timedelta(days=days)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return iso(moment)
