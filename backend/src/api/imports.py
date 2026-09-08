"""Import endpoints (§29).

One permission, `records.import` — narrower than `records.create` on purpose:
creating one record is a form somebody filled in and can see, while importing
five thousand is an act nobody reads row by row. It is also what `/import`
declares in the navigation, and the route guard reads the navigation entry, so
the two must agree.

The operations are the wizard's steps, and the shape of the set is the point:
**catalogue** says what may be imported into and what each field accepts,
**begin** takes the file and reads it, **mapping** says which column is which
field *and validates every row in the same call*, **item** is the preview,
**execute** writes them, **problems** hands back the error report as a file,
and **item**'s `DELETE` lets one go — the file on the first press, the
record on the second.

Two things deliberately absent. There is no "validate" call: changing a mapping
changes which rows are wrong, so making somebody press Validate afterwards
would be a step whose answer is already known. And there is no partial execute
— see the service docstring on why half an import is the outcome this flow
exists to prevent.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services import imports as service


@requires("records.import")
def catalogue(app=None, operation: str = "", request=None, **_: Any):
    """What can be imported into, what each field accepts, and the limits.

    The fields come from the same `Writable` declarations an edit form is
    rendered from, so a field that becomes writable becomes importable the same
    day — and the wizard cannot offer one the create would refuse.
    """
    with session_scope() as session:
        return service.catalogue(session, principal=me()), 200


@requires("records.import")
def collection(app=None, operation: str = "", request=None, **_: Any):
    """My imports, newest first, filtered and faceted in PostgreSQL."""
    args = request.args if request is not None else {}
    with session_scope() as session:
        return service.listing(session, args, principal=me()), 200


@requires("records.import")
def begin(app=None, operation: str = "", request=None, **_: Any):
    """Accept a file, read it, and propose a mapping. The first step.

    The CSV arrives as text in the body rather than through a presigned upload,
    because the API has to parse it: sending it to object storage and fetching
    it back would move the same bytes through the same worker twice. Bounded by
    `core/importer.MAX_BYTES` and refused before anything is stored.
    """
    with session_scope() as session:
        return service.begin(session, json_body(), principal=me()), 201


@requires("records.import")
def item(app=None, operation: str = "", request=None, import_id: str = "", **kwargs: Any):
    """One import with a page of its rows and their problems — the preview.

    `DELETE` takes two presses, as `/exports` and `/mail` do: the first
    abandons the draft and drops the staged copy of somebody's spreadsheet,
    the second removes the record. `removed` in the answer says which
    happened, and the audit trail keeps the history either way.
    """
    identifier = import_id or str(kwargs.get("import_id") or "")
    method = (request.method if request is not None else "GET").upper()
    with session_scope() as session:
        if method == "DELETE":
            return service.discard(session, identifier, principal=me()), 200
        return service.entry(session, identifier, principal=me()), 200


@requires("records.import")
def mapping(app=None, operation: str = "", request=None, import_id: str = "", **kwargs: Any):
    """Set which column is which field, and validate every row.

    One call for both, because they are one thought: a mapping change changes
    which rows are wrong. Answers with the preview, so the page has the result
    of the decision it just made.
    """
    identifier = import_id or str(kwargs.get("import_id") or "")
    with session_scope() as session:
        return service.map_columns(session, identifier, json_body(), principal=me()), 200


@requires("records.import")
def execute(app=None, operation: str = "", request=None, import_id: str = "", **kwargs: Any):
    """Write the valid rows — all of them or none of them.

    Runs off the request, as a queued export does (§30), and answers with the
    run marked RUNNING plus the mechanism producing it. A small import is
    finished before the page redraws; a large one is followed.
    """
    identifier = import_id or str(kwargs.get("import_id") or "")
    with session_scope() as session:
        return service.execute(session, identifier, principal=me()), 202


@requires("records.import")
def problems(app=None, operation: str = "", request=None, import_id: str = "", **kwargs: Any):
    """The error report, as a CSV.

    A file rather than a list, because the rows have to go back to the
    spreadsheet they came from: line, column, the value as written, and the
    reason.
    """
    identifier = import_id or str(kwargs.get("import_id") or "")
    with session_scope() as session:
        return service.problems(session, identifier, principal=me())
