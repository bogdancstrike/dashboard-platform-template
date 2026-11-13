"""Tag endpoints (§37).

The permission split is the point, and it is not the obvious one: reading the
vocabulary needs nothing beyond being signed in, because a tag is a label on
records the caller can already see and a picker that cannot list the options is
not a picker. *Applying* one needs `records.update` — it is an edit to that
record and it is audited as one. Changing the vocabulary itself needs
`tags.manage`, because a rename changes what every record carrying the tag says.
"""

from __future__ import annotations

from src.api.handler import Call, endpoint
from src.core.auth import requires
from src.services.records import tags as service


@requires()
@endpoint
def collection(call: Call):
    """The vocabulary, or a new tag in it."""
    if call.method == "POST":
        return call.run(service.create, call.body), 201
    return call.run(service.vocabulary), 200


@requires()
@endpoint
def item(call: Call, tag_id: str = ""):
    """Rename, recolour or remove one tag."""
    if call.method == "PUT":
        return call.run(service.update, tag_id, call.body), 200
    return call.run(service.remove, tag_id), 200


@requires("records.view")
@endpoint
def on_record(call: Call, resource_type: str = "", record_id: str = ""):
    """The tags on one record, and setting them.

    `records.view` gates the handler because both verbs begin by reading the
    record; the write's own permission is required by the service, so a caller
    who may read but not edit is told which permission is missing rather than
    which route to use.
    """
    if call.method == "PUT":
        return call.run(service.apply, resource_type, record_id, call.body), 200
    return call.run(service.on_record, resource_type, record_id), 200
