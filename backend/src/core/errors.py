"""Domain error taxonomy and the handlers that turn it into HTTP.

Handlers must be installed on the *flask-restx Api* as well as the Flask app:
restx installs its own error handling inside `Resource.dispatch_request`, so an
exception raised in a generated endpoint never reaches `@app.errorhandler` and
would otherwise surface as an opaque 500.
"""

from __future__ import annotations

from typing import Any


class ApiError(Exception):
    code = "error"
    status_code = 500

    def __init__(self, message: str = "", *, details: dict[str, Any] | None = None):
        super().__init__(message or self.code)
        self.message = message or self.code
        self.details = details or {}

    def to_dict(self) -> dict[str, Any]:
        body: dict[str, Any] = {"error": self.code, "message": self.message}
        if self.details:
            body["details"] = self.details
        return body


class ValidationError(ApiError):
    code = "validation_error"
    status_code = 400


class UnauthorizedError(ApiError):
    """No usable credential. The UI answers this with the 401 page."""

    code = "unauthorized"
    status_code = 401


class ForbiddenError(ApiError):
    """Authenticated, but the role does not carry the permission."""

    code = "forbidden"
    status_code = 403


class NotFoundError(ApiError):
    code = "not_found"
    status_code = 404


class ConflictError(ApiError):
    code = "conflict"
    status_code = 409


class UnprocessableError(ApiError):
    """Shape is right, meaning is wrong — e.g. a wizard step that fails a rule."""

    code = "unprocessable"
    status_code = 422


class RateLimitedError(ApiError):
    code = "rate_limited"
    status_code = 429


class ServiceUnavailableError(ApiError):
    code = "service_unavailable"
    status_code = 503


#: Seconds a client is told to wait after the database was unreachable.
RETRY_AFTER_SECONDS = 5


def database_unavailable(err: Exception) -> tuple[dict[str, Any], int, dict[str, str]] | None:
    """The 503 for a database that is down, unreachable or out of connections.

    A dependency outage is not a bug in the request, and answering it with a
    500 "internal server error" sent people to the wrong page and the wrong
    on-call. `None` for any other error, which keeps its 500.
    """
    try:
        from sqlalchemy.exc import DBAPIError, OperationalError
        from sqlalchemy.exc import TimeoutError as PoolTimeoutError
    except ImportError:  # pragma: no cover - SQLAlchemy is a requirement
        return None
    unavailable = isinstance(err, (OperationalError, PoolTimeoutError)) or (
        isinstance(err, DBAPIError) and getattr(err, "connection_invalidated", False)
    )
    if not unavailable:
        return None
    body = ServiceUnavailableError(
        "The database is not answering right now. Try again in a moment.",
        details={"dependency": "database"},
    ).to_dict()
    return body, 503, {"Retry-After": str(RETRY_AFTER_SECONDS)}


def database_rejected_input(err: Exception) -> tuple[dict[str, Any], int] | None:
    """The 400 for a value PostgreSQL itself refuses — the client's data, not a bug.

    A NUL byte in a search box (`a\u0000b`), a number past numeric's range:
    the request is malformed in a way no validator up the stack anticipated,
    and it surfaced as a 500 (found by the edge-case pass,
    docs/testing/security-edge-cases.md). The database's message is not
    echoed: it can quote the statement.
    """
    try:
        from sqlalchemy.exc import DataError
    except ImportError:  # pragma: no cover
        return None
    # psycopg2 refuses a NUL before sending anything, as a plain ValueError.
    nul = isinstance(err, ValueError) and "NUL (0x00)" in str(err)
    if not (isinstance(err, DataError) or nul):
        return None
    return ValidationError(
        "A value in the request cannot be used (for example it contains a NUL character or is out of range).",
    ).to_dict(), 400


def install_restx_error_handlers(api) -> None:
    @api.errorhandler(ApiError)
    def _handle_domain(err: ApiError):
        return err.to_dict(), err.status_code

    try:
        from sqlalchemy.exc import SQLAlchemyError
    except ImportError:  # pragma: no cover
        return

    @api.errorhandler(SQLAlchemyError)
    def _handle_database(err: Exception):
        answer = database_unavailable(err) or database_rejected_input(err)
        if answer is None:
            raise err
        return answer


def install_flask_error_handlers(app) -> None:
    from framework.commons.logger import logger as log

    @app.errorhandler(ApiError)
    def _handle_domain(err: ApiError):
        return err.to_dict(), err.status_code

    @app.errorhandler(Exception)
    def _handle_unexpected(err: Exception):
        from werkzeug.exceptions import HTTPException

        if isinstance(err, HTTPException):
            return {"error": err.name, "message": err.description}, err.code
        answer = database_unavailable(err)
        if answer is not None:
            log.warning(f"database unavailable: {type(err).__name__}")
            return answer
        rejected = database_rejected_input(err)
        if rejected is not None:
            return rejected
        log.exception(f"unhandled error: {err}")
        return {"error": "internal_error", "message": "internal server error"}, 500
