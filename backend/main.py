"""Development entrypoint — `python main.py`.

Werkzeug's server, single process, no gevent. Production runs
`gunicorn -c gunicorn.conf.py wsgi:application` instead; the two differ in how
requests are served and in nothing else, because both build the app through
`src.api.app.create_application`.
"""

from __future__ import annotations

import os
import sys

# Running `python main.py` puts `backend/` on the path already; running it as
# `python backend/main.py` from the repository root does not, and QF's
# `create_app` needs a top-level importable `config`.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from framework.api.server import CustomRequestHandler  # noqa: E402
from framework.commons.logger import logger as log  # noqa: E402

from src.api.app import create_application  # noqa: E402
from src.config import Config  # noqa: E402


def main() -> int:
    host = os.getenv("API_HOST", "0.0.0.0")
    port = Config.API_PORT
    app = create_application()

    log.info(f"development server on http://{host}:{port}{Config.API_PREFIX}/docs", "cyan")
    app.run(
        host=host,
        port=port,
        # The reloader would build the application twice and is off by default
        # so `docker compose up` does not double every startup log line.
        debug=os.getenv("FLASK_DEBUG", "false").lower() in ("1", "true", "yes"),
        use_reloader=os.getenv("FLASK_RELOAD", "false").lower() in ("1", "true", "yes"),
        threaded=True,
        request_handler=CustomRequestHandler,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
