"""WSGI entrypoint — `gunicorn -c gunicorn.conf.py wsgi:application`.

Monkey-patching happens at the top of this module, before anything imports
`ssl`, `socket` or `psycopg2`. Order is the whole point: a connection opened by
an unpatched driver blocks the event loop for its entire life, and the symptom
is a server that looks fine under one request and serialises under two.

The application itself is built by `src.api.app.create_application`, which the
test suite also calls — patching lives here rather than there so importing the
factory in a test does not green-thread the interpreter.
"""

from __future__ import annotations

# gevent first, before any stdlib module it needs to replace is imported.
from gevent import monkey  # noqa: E402

monkey.patch_all()

try:  # make psycopg2 yield to the gevent hub instead of blocking it
    import psycogreen.gevent

    psycogreen.gevent.patch_psycopg()
except Exception:  # pragma: no cover - synchronous worker, nothing to patch
    pass

import sys  # noqa: E402
from pathlib import Path  # noqa: E402

BACKEND_ROOT = Path(__file__).resolve().parent
# QF's `create_app` does `from_object('config.Config')` and its ETL module does
# `from config import Config`, both of which need `backend/` on the path however
# the process was launched.
sys.path.insert(0, str(BACKEND_ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from src.api.app import create_application  # noqa: E402
from src.config import Config  # noqa: E402

application = create_application()

#: `gunicorn wsgi:app` is the spelling half the world uses.
app = application

__all__ = ["Config", "app", "application"]
