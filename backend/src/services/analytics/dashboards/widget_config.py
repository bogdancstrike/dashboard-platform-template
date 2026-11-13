"""A widget's configuration, checked against its kind."""

from __future__ import annotations

from typing import Any

from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.services.analytics.dashboards.widget_catalogue import (
    DATASET_KINDS,
    MODULE_KINDS,
    MODULE_OPTIONS,
    MODULE_PERMISSIONS,
    REFERENCE_KINDS,
)
from src.services.records.explorer import resource_for


def _config(raw: Any, *, kind: str, principal) -> dict[str, Any]:
    """What the widget asks, checked against what may actually be asked.

    **An unconfigured widget is a legitimate state, not an error.** The create
    flow picks *shapes* — four headline numbers, an alert strip, a bar chart —
    and each is filled in afterwards on the grid it will live on. Requiring a
    dataset up front would mean choosing thirteen datasets in a modal before
    seeing a single card, which is the flow this one exists to replace. So what
    is validated is that whatever *is* named can actually be asked for; the
    widget itself says, in place, that it still needs a subject (§34).

    Deliberately shallow beyond that: the question is executed by the endpoint
    that owns it, and re-deriving which fields are groupable would be a second
    copy of the analysis catalogue.
    """
    config = dict(raw or {})
    entity = str(config.get("entity") or "").strip()

    if kind in MODULE_KINDS:
        # A module widget is checked here as well as when it is drawn: a
        # dashboard shared with somebody who lacks `mail.access` still holds
        # the card, and its body says so — but *adding* one you could never
        # see is a mistake worth refusing at the point it is made.
        needed = MODULE_PERMISSIONS.get(kind)
        if needed and not principal.can(needed):
            raise ValidationError(
                "That module is not one your role can open.",
                details={"kind": kind, "permission": needed},
            )
        return _module_options(config, kind=kind, principal=principal)

    if kind in REFERENCE_KINDS:
        key, noun = REFERENCE_KINDS[kind]
        reference = str(config.get(key) or "").strip()
        if reference:
            # Parsed, not resolved: whether the reader may *see* that report is
            # decided when the widget is drawn, by the endpoint that owns it. A
            # check here would go stale the moment the owner changed its
            # audience.
            config[key] = str(parse_uuid(reference, field=key))
        else:
            config.pop(key, None)
        if entity:
            raise ValidationError(
                f"That widget takes its dataset from the saved {noun} it names.",
                details={"kind": kind, "entity": entity},
            )
        return config

    if kind in DATASET_KINDS:
        if entity:
            # Checked against the reader's own permissions: a widget pointing
            # at a dataset they may not read would be a card that always says
            # forbidden.
            resource_for(entity, principal=principal)
            config["entity"] = entity
        else:
            config.pop("entity", None)
    elif entity:
        raise ValidationError(
            "That widget is a platform-wide feed and names no dataset.",
            details={"kind": kind, "entity": entity},
        )

    filters = config.get("filters")
    if filters is not None and not isinstance(filters, dict):
        raise ValidationError("config.filters must be an object.")

    return config


def _module_options(config: dict[str, Any], *, kind: str, principal) -> dict[str, Any]:
    """What a module widget was told, keeping only what that module reads.

    Unknown keys are dropped rather than refused. A config is a place a client
    would otherwise accumulate scratch state, and a stored key nothing reads is
    a key somebody later has to work out the meaning of; but refusing the whole
    write over one stray field would make every client upgrade a breaking
    change.
    """
    declared = MODULE_OPTIONS.get(kind, {})
    out: dict[str, Any] = {}
    for key, shape in declared.items():
        if key not in config or config[key] in (None, ""):
            continue
        value = config[key]
        if shape == "flag":
            out[key] = bool(value)
        elif shape == "count":
            try:
                out[key] = max(1, min(365, int(value)))
            except (TypeError, ValueError) as exc:
                raise ValidationError(f"config.{key} must be a whole number.") from exc
        elif shape == "id":
            out[key] = str(parse_uuid(value, field=key))
        else:
            text = str(value).strip()[:120]
            # An `entity` on a module widget names which dataset the module is
            # pointed at — the explorer's saved searches for one resource, a
            # relationship map rooted in one — so it is checked against the
            # reader's own permissions exactly as a chart's dataset is.
            if key == "entity":
                resource_for(text, principal=principal)
            out[key] = text
    return out
