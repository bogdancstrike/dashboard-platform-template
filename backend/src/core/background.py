"""Work that outlives the request that asked for it (§23, §30).

An export of two hundred thousand rows cannot be a request somebody's browser
holds open, and `core/export` refuses to try. The other half of that refusal is
this module: somewhere for the work to actually happen once the response has
gone.

**There is no worker process, and this does not pretend there is one.** The
compose stack runs PostgreSQL, Redis, MinIO, Keycloak and one API — a template
that shipped a Celery deployment nobody asked for would be a template making a
decision that belongs to whoever adopts it. So the work runs off the request
*inside this process*, and `mechanism()` names how, because "background" is a
word that hides three quite different things:

**`greenlet`** — under gunicorn with gevent workers, which is how the API is
served. A greenlet yields at every socket operation, so a job that spends its
life waiting on PostgreSQL costs the worker almost nothing while it runs.

**`thread`** — under `python main.py`, where nothing is patched. psycopg2
releases the GIL around the socket, so a daemon thread gets the same
concurrency for the same reason; it is a thread rather than a greenlet only
because there is no event loop to put a greenlet on.

**`inline`** — asked for explicitly by `synchronous()`, so a test can assert on
a finished job instead of on a race. Never the default: a test that passes only
because the work happened to be instant is a test that says nothing about the
code that ships.

Which one ran is recorded on the job, so an operator reading a slow export can
see whether they are looking at a greenlet on a busy worker or a thread in a
dev server — and so that swapping in a real queue later is a change to this
module and to nothing above it.

The one rule for a callable passed here: **it owns its own session and its own
errors.** The request's session is closed by the time it runs, and there is no
caller left to catch anything it raises — so an exception that reaches `spawn`
can only be logged, which is why every job's failure is recorded by the job
itself rather than left to this module to notice.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager

logger = logging.getLogger(__name__)

#: How work can be run off the request. Ordered most to least concurrent.
MECHANISMS = ("greenlet", "thread", "inline")

#: Set only by `synchronous()`. A module-level flag rather than a parameter
#: because the caller that queues the work is several frames from the test that
#: wants it finished, and threading a `synchronous=True` argument through the
#: service layer would put a test-only concern in the product's signatures.
_inline = threading.local()


def _forced_inline() -> bool:
    return bool(getattr(_inline, "on", False))


def _gevent_patched() -> bool:
    """Whether gevent has patched the standard library in this process.

    Asked of gevent rather than of the configuration: `wsgi.py` does the
    patching and a `SERVER=gunicorn` variable would be a second, separate claim
    about the same fact — one that is wrong the first time somebody runs the
    dev server with it set.
    """
    try:
        from gevent import monkey
    except ImportError:  # pragma: no cover - gevent is a hard dependency of the API
        return False
    return bool(monkey.is_module_patched("socket"))


def mechanism() -> str:
    """What `spawn` would use right now, without spawning anything.

    Exposed so a queued job can record how it will be run at the moment it is
    queued, and so `/health` can say it.
    """
    if _forced_inline():
        return "inline"
    return "greenlet" if _gevent_patched() else "thread"


def spawn(work: Callable[[], None], *, name: str) -> str:
    """Run `work` off the request and return the mechanism that will run it.

    Returns rather than yields: the caller has a row to write and wants the
    answer now, not when the work finishes.
    """
    chosen = mechanism()

    def guarded() -> None:
        try:
            work()
        except Exception:
            # Nothing above this frame is still running, so this is the last
            # place the traceback can be recorded. The *job* records its own
            # failure; this catch is for the case where recording it failed
            # too, which is the one an operator will otherwise never see.
            logger.exception("background work %r raised", name)

    if chosen == "inline":
        guarded()
        return chosen

    if chosen == "greenlet":
        import gevent

        gevent.spawn(guarded)
        return chosen

    # `daemon` so a dev server exits on Ctrl-C with work in flight rather than
    # hanging on a join nobody asked for. Under gunicorn this branch is not
    # reached, and a real deployment loses in-flight work on restart either
    # way — which is what `attempt` and a QUEUED row exist to survive.
    threading.Thread(target=guarded, name=f"background:{name}", daemon=True).start()
    return chosen


@contextmanager
def synchronous() -> Iterator[None]:
    """Run spawned work inline for the duration, for tests.

    Thread-local, so a test using this cannot change what a concurrently
    running one observes.
    """
    previous = getattr(_inline, "on", False)
    _inline.on = True
    try:
        yield
    finally:
        _inline.on = previous
