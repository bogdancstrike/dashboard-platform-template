"""Background job endpoints (§23).

Two permissions, and the split is the design: `jobs.view` reads the queue,
`jobs.manage` acts on it. A retry re-runs real work against real rows, so it is
not something everybody who may watch the queue should be able to do.

No POST that creates a job. Nothing in the platform enqueues one yet — that
belongs with `/exports` (§30) — and an endpoint that wrote a row no worker
reads would be a queue that silently swallows work.
"""

from __future__ import annotations

from typing import Any

from src.api.handler import Call, endpoint
from src.core.auth import me, requires
from src.core.db import session_scope
from src.services.platform import jobs as service


@requires("jobs.view")
@endpoint
def catalogue(call: Call):
    """The filter vocabulary, the per-status counts, and what this reader may do."""
    with session_scope() as session:
        return service.catalogue(session, principal=me()), 200


@requires("jobs.view")
def collection(app=None, operation: str = "", request=None, **_: Any):
    """One page of the queue: filtered, faceted, sorted and paged in PostgreSQL."""
    args = request.args if request is not None else {}
    with session_scope() as session:
        return service.listing(session, args, principal=me()), 200


@requires("jobs.view")
@endpoint
def item(call: Call, job_id: str = ""):
    """One job in full: its payload, its result and its own log lines."""
    identifier = job_id
    with session_scope() as session:
        return service.entry(session, identifier, principal=me()), 200


@requires("jobs.view", "jobs.manage")
@endpoint
def retry(call: Call, job_id: str = ""):
    """Queue another attempt on the same job (§23).

    Refused while the job is still running, and refused once it has used its
    attempts — both with the reason and the bound named, because a queue that
    appears to accept a retry and does nothing is worse than one that says no.
    """
    identifier = job_id
    with session_scope() as session:
        return service.retry(session, identifier, principal=me()), 200


@requires("jobs.view", "jobs.manage")
@endpoint
def allow_attempts(call: Call, job_id: str = ""):
    """Grant a job more attempts (§23).

    The action the retry refusal points at. Its own verb rather than a flag on
    retry, because raising a limit and running the work are two decisions.
    """
    identifier = job_id
    payload = (call.loose_body) or {}
    with session_scope() as session:
        return service.allow_attempts(session, identifier, payload, principal=me()), 200


@requires("jobs.view", "jobs.manage")
@endpoint
def cancel(call: Call, job_id: str = ""):
    """Stop a job that has not finished, keeping the row (§23).

    Not a delete: a queue whose cancelled jobs vanish cannot answer "why did
    the nightly export not run last Tuesday".
    """
    identifier = job_id
    with session_scope() as session:
        return service.cancel(session, identifier, principal=me()), 200
