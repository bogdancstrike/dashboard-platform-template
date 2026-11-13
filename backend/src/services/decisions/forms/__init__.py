"""Intake forms: designed here, answered anywhere, turned into records.
See docs/architecture/backend/forms.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "field_checks": (
        "MANAGE", "VIEW", "FIELD_TYPES", "STATUSES", "TARGETS", "SLUG", "EMAIL", "MAX_FIELDS",
        "MAX_FILE_BYTES", "HONEYPOT", "CHALLENGE_TTL", "REFERENCE_PREFIX", "DEFAULT_SETTINGS",
        "_writable", "targets_catalogue", "_checked_fields", "_refuse", "_FieldChecker",
    ),
    "public_side": (
        "_sign", "challenge", "_check_challenge", "_live", "public_form", "_visible",
        "_clean_answers", "_store_file",
    ),
    "submissions_admin": ("submissions", "_record_path", "_submission_body", "retry", "_convert"),
    "forms_admin": (
        "_checked_settings", "_body", "listing", "_row", "entry", "_slug_from", "save",
        "_refuse_unpublishable", "remove",
    ),
    "submission": ("_reference", "_form_principal", "submit"),
})
