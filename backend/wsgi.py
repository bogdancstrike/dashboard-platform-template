"""WSGI entrypoint — `gunicorn wsgi:application`.

The psycopg2 patch has to happen before the first connection is opened, not
before the first *query*: a connection created by an unpatched driver blocks
the whole event loop for the lifetime of that connection, and the symptom is a
server that looks fine under one request and serialises under two.

`gunicorn.conf.py` also patches, in `post_fork`. This copy is not redundant —
it covers `gunicorn -k gevent wsgi:application` run without the config file,
and any other green WSGI server that imports this module directly. Patching
twice is harmless; patching neither is a production incident.
"""

from __future__ import annotations


def _patch_psycopg_if_green() -> None:
    try:
        from gevent import monkey
    except ImportError:
        return
    if not monkey.is_module_patched("socket"):
        # Synchronous worker: psycopg2 is already doing the right thing.
        return
    from psycogreen.gevent import patch_psycopg

    patch_psycopg()


_patch_psycopg_if_green()

from src.api.app import create_application  # noqa: E402

application = create_application()

#: `gunicorn wsgi:app` is the spelling half the world uses.
app = application
