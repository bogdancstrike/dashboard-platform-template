"""Export endpoints (§30).

One permission, `records.export` — the same one that answers an immediate
download, because exporting in the background is not a different act, only a
slower one. It is also what `/exports` declares in the navigation, and the
route guard reads the navigation entry: a page whose API required more than
its nav entry does is a page some roles reach and cannot use.

Seven operations, and the shape of the set is the point: **estimate** before
committing to anything, **queue** to accept one, **collection** and **item** to
read them, **download** for a signed URL that does not put the bytes through
this worker, **again** to ask the same question afresh, and **forget** (as
`DELETE`) to let one go — the file on the first press, the record on the
second.

There is no retry, and `again` is why. Retrying would re-run the old job in
place against rows that have moved on since it was requested; asking again
produces a new reference and a new file and leaves the old record alone.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services import exports as service


@requires("records.export")
def catalogue(app=None, operation: str = "", request=None, **_: Any):
    """What can be exported, the ceilings that apply, and where mine stand.

    The ceilings come from the settings table, so the number this page prints
    is the number the API will enforce.
    """
    with session_scope() as session:
        return service.catalogue(session, principal=me()), 200


@requires("records.export")
def collection(app=None, operation: str = "", request=None, **_: Any):
    """My exports, newest first, filtered and faceted in PostgreSQL."""
    args = request.args if request is not None else {}
    with session_scope() as session:
        return service.listing(session, args, principal=me()), 200


@requires("records.export")
def estimate(app=None, operation: str = "", request=None, **_: Any):
    """How many rows a query has, and whether it streams or has to be queued.

    Asked before the file is committed to, because the answer changes what the
    page should offer: queueing a background job for forty rows would be a step
    added for nothing.
    """
    with session_scope() as session:
        return service.estimate(session, json_body(), principal=me()), 200


@requires("records.export")
def queue(app=None, operation: str = "", request=None, **_: Any):
    """Accept an export and start producing it off the request.

    Returns the job immediately, with the mechanism that is producing it in
    `ran_as`. The row count is taken before the row is written, so an export
    beyond the installation's ceiling is refused with the number rather than
    accepted and failed later.
    """
    with session_scope() as session:
        return service.queue(session, json_body(), principal=me()), 201


@requires("records.export")
def again(app=None, operation: str = "", request=None, export_id: str = "", **kwargs: Any):
    """Ask the same question again, as a new export.

    Not a retry: the rows have moved on since the original was requested, so
    this queues a fresh export from the stored query rather than re-running the
    old job in place. What the page offers on a failed or stalled one.
    """
    identifier = export_id or str(kwargs.get("export_id") or "")
    with session_scope() as session:
        return service.again(session, identifier, principal=me()), 201


@requires("records.export")
def item(app=None, operation: str = "", request=None, export_id: str = "", **kwargs: Any):
    """One of my exports, with its log lines — or a `DELETE` that lets it go.

    `DELETE` takes two presses, the platform's own rule for this shape of thing
    (`/mail` bins a thread on the first and removes it on the second): the
    first drops the file, the second removes the record. `removed` in the
    answer says which happened. Two presses because the acts are different
    sizes — one takes a copy of production data out of object storage, the
    other tidies away a note — and because the audit trail keeps the history
    either way.
    """
    identifier = export_id or str(kwargs.get("export_id") or "")
    method = (request.method if request is not None else "GET").upper()
    with session_scope() as session:
        if method == "DELETE":
            return service.forget(session, identifier, principal=me()), 200
        return service.entry(session, identifier, principal=me()), 200


@requires("records.export")
def download(app=None, operation: str = "", request=None, export_id: str = "", **kwargs: Any):
    """A signed URL for the file.

    A URL rather than the bytes, deliberately: streaming a finished artefact
    back through a gevent worker costs the same worker twice for a file object
    storage can serve on its own. `core/storage` signs it either way — MinIO in
    the compose stack, this process when storage is local.
    """
    identifier = export_id or str(kwargs.get("export_id") or "")
    with session_scope() as session:
        return service.download(session, identifier, principal=me()), 200
