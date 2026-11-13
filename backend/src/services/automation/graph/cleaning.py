"""One action node's configuration, cleaned against the dataset it writes."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.services.automation.graph.kinds import FLOW, MAX_WAIT_MINUTES
from src.services.automation.graph.shape import _resource, assignable_field
from src.services.automation.workflows.registry import ACTIONS, _recipient_config
from src.services.automation.workflows.webhook import _webhook_url
from src.services.records import writes as record_writes


def clean_action(session, data: dict[str, Any], resource) -> dict[str, Any]:
    """One action's configuration, checked against what its kind needs.

    Shared by the canvas and the form editor, so the two cannot accept
    different things under the same name.
    """

    kind = str(data.get("kind") or data.get("type") or "").strip().upper()
    if kind in FLOW:
        return _clean_flow(kind, data)
    if kind not in ACTIONS:
        raise ValidationError(
            f"{kind or '(none)'} is not an action this platform can run.",
            details={"allowed": sorted([*ACTIONS, *FLOW])},
        )
    config: dict[str, Any] = {"kind": kind}
    action = ACTIONS[kind]
    if "recipients" in action.needs:
        config["recipients"] = _recipient_config(data)
    if "url" in action.needs:
        config["url"] = _webhook_url(data.get("url"))
    for name in ("title", "body", "subject", "template", "priority", "label"):
        if data.get(name):
            config[name] = str(data[name])[:2000]
    if data.get("assignee_id"):
        config["assignee_id"] = str(parse_uuid(data["assignee_id"], field="assignee_id"))
    if config.get("template"):
        from src.models.content import EmailTemplate

        code = config["template"]
        if session.scalar(select(EmailTemplate.id).where(EmailTemplate.code == code)) is None:
            raise ValidationError(f"No email template is called {code!r}.")

    if kind == "UPDATE_FIELD":
        _clean_update(session, data, resource, config)
    elif kind == "ASSIGN":
        if resource is not None and assignable_field(resource) is None:
            raise ValidationError(f"{resource.label} have nobody to assign.")
        if not config.get("assignee_id") and not data.get("to_owner"):
            raise ValidationError("Choose who to assign it to.")
        config["to_owner"] = bool(data.get("to_owner")) and not config.get("assignee_id")
    elif kind == "CREATE_RECORD":
        _clean_create(session, data, config)
    return config


def _clean_flow(kind: str, data: dict[str, Any]) -> dict[str, Any]:
    if kind == "WAIT":
        try:
            minutes = int(data.get("minutes"))
        except (TypeError, ValueError) as error:
            raise ValidationError("Say how many minutes to wait.") from error
        if not 1 <= minutes <= MAX_WAIT_MINUTES:
            raise ValidationError("A wait runs from one minute to thirty days.")
        return {"kind": kind, "minutes": minutes}
    config: dict[str, Any] = {"kind": kind}
    if data.get("title"):
        config["title"] = str(data["title"])[:240]
    if data.get("body"):
        config["body"] = str(data["body"])[:2000]
    if data.get("assignee_id"):
        config["assignee_id"] = str(parse_uuid(data["assignee_id"], field="assignee_id"))
    return config


def _clean_update(session, data: dict[str, Any], resource, config: dict[str, Any]) -> None:

    name = str(data.get("field") or "")
    if resource is None:
        raise ValidationError("Choose the dataset first.")
    if name not in resource.writable:
        raise ValidationError("Choose a field this workflow may set.",
                              details={"editable": sorted(resource.writable)})
    if "value" not in data or data.get("value") in (None, ""):
        raise ValidationError("Say what to set it to.")
    value = data["value"]
    if not (isinstance(value, str) and "{" in value):
        _, issues = record_writes.coerce(session, resource, {name: value}, creating=False)
        if issues:
            raise ValidationError(issues[0]["message"])
    config.update({"field": name, "value": value})


def _clean_create(session, data: dict[str, Any], config: dict[str, Any]) -> None:

    target = _resource(data.get("resource_type"))
    if target is None or target.identity is None:
        raise ValidationError("Choose a dataset records can be created in.")
    values = data.get("values") if isinstance(data.get("values"), dict) else {}
    literal = {k: v for k, v in values.items() if not (isinstance(v, str) and "{" in v)}
    _, issues = record_writes.coerce(session, target, {**{k: "x" for k in values if k not in literal}, **literal}, creating=True)
    # A templated value is checked for its *name* only; its text is filled
    # in when the workflow runs.
    issues = [item for item in issues if item["field"] not in values or item["field"] in literal]
    if issues:
        raise ValidationError(issues[0]["message"])
    config.update({"resource_type": target.key, "values": dict(values)})
