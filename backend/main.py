"""Development runner — `python main.py`.

Production serves the same application with gunicorn and gevent workers:

    gunicorn -c gunicorn.conf.py wsgi:application

This imports the app from `wsgi`, so the two paths differ in how requests are
served and in nothing else — including the gevent patching, which `wsgi` does
at import.
"""

from __future__ import annotations

import signal
import sys

from framework.commons.logger import logger as log

from wsgi import Config, app


def _shutdown(signum, _frame):
    log.info(f"shutdown signal received: {signal.Signals(signum).name}")
    sys.exit(0)


def main() -> int:
    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    host = "0.0.0.0"
    log.info(f"{Config.APP_NAME} dev server on http://{host}:{Config.API_PORT}/", "cyan")
    app.run(
        host=host,
        port=Config.API_PORT,
        # The reloader would build the application twice, doubling every startup
        # log line under `docker compose up`.
        debug=False,
        use_reloader=False,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
