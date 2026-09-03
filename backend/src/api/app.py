"""Application assembly — the one place the process is put together.

QF builds the whole API: `FrameworkApp.run()` creates the Flask app, attaches
Flask-RESTX, and mounts every endpoint declared in `maps/endpoint.json`. This
module adds only what QF leaves to the application — the cross-cutting hooks
and the error handlers — and checks the map before any of it runs.

Boot order is load-bearing:

1. the endpoint map is verified, so a bad handler reference refuses to boot
   rather than surfacing as a 500 on first call;
2. QF's `create_app` loads `config.Config` onto `app.config`;
3. correlation and CORS hooks, which read `ALLOWED_ORIGINS` from that config;
4. error handlers last, on both the app and the Api — Flask-RESTX handles
   exceptions inside `Resource.dispatch_request`, so an `@app.errorhandler`
   alone never sees anything raised by a mounted endpoint.

The namespace in the map is the URL prefix: QF mounts a namespace at `/{name}`,
so the `platform` namespace is what puts every route under `/platform`.
"""

from __future__ import annotations

from pathlib import Path

from flask import Flask

from src.config import Config

#: `backend/` — the app root QF resolves `maps/endpoint.json` and `instance/`
#: against.
BACKEND_ROOT = Path(__file__).resolve().parents[2]


def create_application() -> Flask:
    """Build the fully wired Flask application."""
    from framework.app import FrameworkApp
    from framework.commons.logger import logger as log
    from framework.config.settings import FrameworkSettings

    from src.api import endpoint_map
    from src.core.correlation import install_flask_hooks
    from src.core.errors import install_flask_error_handlers, install_restx_error_handlers

    # Before anything is mounted: every handler the map names must import, and
    # the namespace must agree with the prefix the frontend and proxy expect.
    endpoint_map.verify()
    endpoint_map.check_prefix(Config.API_PREFIX)

    settings = FrameworkSettings(
        # No Kafka in this template. QF's runner still imports the ETL module at
        # load time — hence the kafka/redis entries in requirements.txt — but
        # nothing connects.
        enable_etl=False,
        enable_api=True,
        enable_dynamic_endpoints=True,
        endpoint_json_path=endpoint_map.ENDPOINT_MAP_RELATIVE,
        api_host="0.0.0.0",
        api_port=Config.API_PORT,
        api_version=Config.APP_VERSION,
        api_title=Config.APP_NAME,
        api_description=Config.APP_DESCRIPTION,
        enable_tracing=Config.ENABLE_TRACING,
        otlp_endpoint=Config.OTLP_ENDPOINT or None,
        service_name=Config.SERVICE_NAME,
    )

    handles = FrameworkApp(settings, app_root=BACKEND_ROOT).run()
    app = handles.app

    install_flask_hooks(app)
    install_restx_error_handlers(handles.api)
    install_flask_error_handlers(app)

    log.info(
        f"{Config.APP_NAME} {Config.APP_VERSION} ready: "
        f"{len(endpoint_map.routes())} endpoints under {Config.API_PREFIX} "
        f"[{Config.ENVIRONMENT}]",
        "green",
    )
    return app
