"""Cross-cutting HTTP behaviour: errors, correlation, CORS.

Every one of these is something the frontend depends on for all endpoints at
once, so a regression here breaks every screen rather than one.
"""

from __future__ import annotations

import pytest

from src.config import Config
from src.core.correlation import CORRELATION_HEADER
from src.core.errors import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    UnauthorizedError,
    ValidationError,
)

PREFIX = Config.API_PREFIX


def test_swagger_ui_is_served_at_the_root(client):
    """QF mounts Flask-RESTX with its default doc path, which is `/`."""
    response = client.get("/")
    assert response.status_code == 200
    assert b"<html" in response.data.lower()


def test_openapi_document_describes_the_app(client):
    spec = client.get("/swagger.json").get_json()
    assert spec["info"]["title"] == Config.APP_NAME
    assert spec["info"]["version"] == Config.APP_VERSION
    assert "platform" in {tag["name"] for tag in spec["tags"]}


def test_unknown_path_is_json_not_html(client):
    response = client.get(f"{PREFIX}/health/nope")
    assert response.status_code == 404
    assert response.is_json
    assert "error" in response.get_json()


def test_correlation_id_is_echoed(client):
    response = client.get(f"{PREFIX}/health/live", headers={CORRELATION_HEADER: "trace-me"})
    assert response.headers[CORRELATION_HEADER] == "trace-me"


def test_correlation_id_is_generated_when_absent(client):
    response = client.get(f"{PREFIX}/health/live")
    assert len(response.headers[CORRELATION_HEADER]) == 32


def test_preflight_is_answered_without_reaching_a_handler(client):
    response = client.open(
        f"{PREFIX}/health/live",
        method="OPTIONS",
        headers={"Origin": "http://localhost:5174", "Access-Control-Request-Method": "GET"},
    )
    assert response.status_code == 204
    assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:5174"
    assert "Authorization" in response.headers["Access-Control-Allow-Headers"]


def test_unlisted_origin_gets_no_cors_header(client):
    response = client.get(f"{PREFIX}/health/live", headers={"Origin": "http://evil.example"})
    assert "Access-Control-Allow-Origin" not in response.headers


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (ValidationError, 400, "validation_error"),
        (UnauthorizedError, 401, "unauthorized"),
        (ForbiddenError, 403, "forbidden"),
        (NotFoundError, 404, "not_found"),
        (ConflictError, 409, "conflict"),
    ],
)
def test_domain_errors_map_to_their_status(error, status, code):
    raised = error("nope")
    assert raised.status_code == status
    assert raised.to_dict()["error"] == code
    assert raised.to_dict()["message"] == "nope"


def test_domain_errors_carry_details():
    raised = ValidationError("bad", details={"field": "name"})
    assert raised.to_dict()["details"] == {"field": "name"}


def test_domain_error_from_a_flask_route(client):
    """The probe route in `conftest` raises a domain error."""
    response = client.get("/__error_probe")
    assert response.status_code == 409
    assert response.get_json() == {
        "error": "conflict",
        "message": "already exists",
        "details": {"id": "42"},
    }


def test_domain_error_from_a_mounted_endpoint(client, monkeypatch):
    """The case `@app.errorhandler` alone would miss.

    Flask-RESTX handles exceptions inside `Resource.dispatch_request`, so an
    error raised by a QF-mounted handler only becomes its documented status
    because the handlers are installed on the Api too. QF resolves the handler
    by name on every request, which is what makes this patchable.
    """
    import src.api.health as health

    def _explode(app=None, operation="", request=None, **_):
        raise ForbiddenError("not for you", details={"missing": ["health.view"]})

    monkeypatch.setattr(health, "liveness", _explode)
    response = client.get(f"{PREFIX}/health/live")
    assert response.status_code == 403
    assert response.get_json()["error"] == "forbidden"
    assert response.get_json()["details"] == {"missing": ["health.view"]}


def test_unexpected_error_does_not_leak_its_message(client, monkeypatch):
    import src.api.health as health

    def _explode(app=None, operation="", request=None, **_):
        raise RuntimeError("connection string postgres://user:hunter2@db/app")

    monkeypatch.setattr(health, "liveness", _explode)
    response = client.get(f"{PREFIX}/health/live")
    assert response.status_code == 500
    body = response.get_json()
    assert body == {"error": "internal_error", "message": "internal server error"}
    assert "hunter2" not in response.get_data(as_text=True)
