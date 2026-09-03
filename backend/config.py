"""Top-level config shim.

QF hard-codes ``app.config.from_object('config.Config')`` inside
``framework.api.server.create_app``, and ``framework.etl`` does
``from config import Config`` at import time. Both need a *top-level*
importable ``config`` module; ``src/config.py`` alone is not found. This
re-exports the real settings so QF is satisfied however the process is
launched.
"""

from src.config import Config  # noqa: F401
