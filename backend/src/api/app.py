"""Application assembly — the one place the process is put together.

The shape is QF's, with one deviation. `FrameworkApp.start_api()` builds its
Flask-RESTX `Api` without a URL prefix, and this platform serves everything
under `API_PREFIX` so a reverse proxy can route `/platform/*` to the API and
everything else to the SPA. So the Api is mounted here instead, and QF's
*router* — `generate_endpoints_from_config` — is still what creates the
resources. That keeps the handler calling convention QF defines, which is the
part the rest of the codebase is written against.

Boot order is load-bearing:

1. QF's `create_app` loads `config.Config` onto `app.config`;
2. correlation and CORS hooks, which read `ALLOWED_ORIGINS` from that config;
3. handlers are imported and verified, so a bad route refuses to boot;
4. routes are mounted;
5. error handlers last, on both the app and the Api — Flask-RESTX handles
   exceptions inside `Resource.dispatch_request`, so an `@app.errorhandler`
   alone never sees them.
"""

from __future__ import annotations

from pathlib import Path

from flask import Flask, jsonify
from flask_restx import Api

from src.config import Config

#: `backend/` — the app root QF resolves `instance/` and relative paths against.
BACKEND_ROOT = Path(__file__).resolve().parents[2]


def create_application(*, endpoint_map: str | Path | None = None) -> Flask:
    """Build the fully wired Flask application."""
    from framework.api.dynamic import generate_endpoints_from_config
    from framework.app import FrameworkApp
    from framework.commons.logger import logger as log
    from framework.config.settings import FrameworkSettings

    from src.api.endpoint_map import verify_handlers, write_endpoint_map
    from src.api.routes import ROUTES
    from src.core.correlation import install_flask_hooks
    from src.core.errors import install_flask_error_handlers, install_restx_error_handlers

    settings = FrameworkSettings(
        # No Kafka in this template. The ETL module is still imported by QF's
        # runner at load time — hence the kafka/redis entries in requirements —
        # but nothing connects.
        enable_etl=False,
        # Both off because this function does the equivalent work below, with a
        # prefix QF's version cannot express.
        enable_api=False,
        enable_dynamic_endpoints=False,
        enable_tracing=Config.ENABLE_TRACING,
        otlp_endpoint=Config.OTLP_ENDPOINT or None,
        service_name=Config.SERVICE_NAME,
        api_version=Config.APP_VERSION,
        api_title=Config.APP_NAME,
        api_description=Config.APP_DESCRIPTION,
    )

    framework = FrameworkApp(settings, app_root=BACKEND_ROOT)
    app = framework.build_flask_app()
    # With the API and ETL disabled this only initialises tracing, but it keeps
    # QF as the thing that decides what "starting up" means.
    framework.run()

    install_flask_hooks(app)

    prefix = Config.API_PREFIX.rstrip("/")
    api = Api(
        app,
        version=Config.APP_VERSION,
        title=Config.APP_NAME,
        description=Config.APP_DESCRIPTION,
        prefix=prefix,
        # Flask-RESTX does not prefix the docs route itself, so it is spelled
        # out in full; without this the UI would land on `/docs` while every
        # operation it describes lives under the prefix.
        doc=f"{prefix}/docs",
    )

    # Import every handler before mounting. QF resolves `module_name` lazily
    # inside the request, so without this a renamed function is a 500 on first
    # call instead of a process that refuses to start.
    verify_handlers()
    map_path = write_endpoint_map(endpoint_map)
    generate_endpoints_from_config(api, str(map_path))

    install_restx_error_handlers(api)
    install_flask_error_handlers(app)
    _install_root(app, prefix)

    log.info(
        f"{Config.APP_NAME} {Config.APP_VERSION} ready: "
        f"{len(ROUTES)} routes under {prefix or '/'} [{Config.ENVIRONMENT}]",
        "green",
    )
    return app


def _install_root(app: Flask, prefix: str) -> None:
    """A useful `/`.

    Hitting the bare host is the first thing anyone does with an unfamiliar
    service, and Flask-RESTX answers the prefix root with a 404. This points at
    the docs and the health probes instead.
    """

    @app.get("/")
    def _index():
        return jsonify(
            {
                "name": Config.APP_NAME,
                "version": Config.APP_VERSION,
                "environment": Config.ENVIRONMENT,
                "docs": f"{prefix}/docs",
                "openapi": f"{prefix}/swagger.json",
                "health": f"{prefix}/health/live",
                "routes": f"{prefix}/meta/routes",
            }
        )
