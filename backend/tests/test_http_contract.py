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


def test_index_points_at_the_useful_urls(client):
    body = client.get("/").get_json()
    assert body["docs"] == f"{PREFIX}/docs"
    assert body["openapi"] == f"{PREFIX}/swagger.json"


def test_unknown_path_is_json_not_html(client):
    response = client.get(f"{PREFIX}/health/nope")
    assert response.status_code == 404
    assert response.is_json
    assert "error" in response.get_json()


def test_swagger_ui_renders(client):
    response = client.get(f"{PREFIX}/docs")
    assert response.status_code == 200
    assert b"<html" in response.data.lower()


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


def test_domain_error_raised_in_a_handler_becomes_its_status(client):
    """The probe route in `conftest` raises a domain error; the installed
    handlers must turn it into the documented envelope rather than a 500."""
    response = client.get("/__error_probe")
    assert response.status_code == 409
    assert response.get_json() == {
        "error": "conflict",
        "message": "already exists",
        "details": {"id": "42"},
    }
