"""Repairing automations whose conditions or actions no longer compile."""

from __future__ import annotations

from typing import Any


def sync_automations(session) -> dict[str, int]:
    """Make existing automations runnable, without a destructive reseed.

    The report repair's sibling, for the same reason and with the same shape:
    the rules already in a populated database were written before the generator
    derived them, and seeding refuses to touch populated data. Three repairs,
    each the smallest one that makes the rule mean something:

      * a rule watching a dataset that does not exist is **paused**. There is
        nothing to repair it *to*, and a rule left enabled against a missing
        dataset is a monitor that reports quiet because it cannot look;
      * a condition that will not compile is replaced by one derived from the
        dataset's own state field — the same derivation the seed uses;
      * actions are kept where they are executable and dropped where they are
        not, falling back to notifying the rule's owner, because a rule with no
        actions matches, records fires and does nothing.

    Idempotent, so it can run on every deploy.
    """
    from sqlalchemy import select as _select

    from src.core.errors import ValidationError
    from src.core.rules import compile_tree, describe_tree
    from src.models.platform import AlertRule
    from src.services.records.explorer import resources

    catalogue = resources()
    repaired = 0
    paused = 0

    for row in session.scalars(_select(AlertRule).where(AlertRule.deleted_at.is_(None))):
        resource = catalogue.get(row.resource_type)
        if resource is None:
            if row.enabled:
                row.enabled = False
                paused += 1
            continue

        changed = False

        try:
            compiled = compile_tree(row.condition_tree, resource.fields)
        except ValidationError:
            compiled = None
        if compiled is None:
            tree = _derived_condition(resource)
            if tree is None:
                # No state to watch: pausing is the only honest outcome.
                if row.enabled:
                    row.enabled = False
                    paused += 1
                continue
            row.condition_tree = tree
            row.condition_text = describe_tree(tree, resource.fields)
            changed = True

        actions = [
            action
            for item in (row.actions or [])
            if isinstance(item, dict)
            and (action := _repaired_action(item)) is not None
        ]
        if not actions:
            actions = [
                {
                    "kind": "NOTIFY",
                    "recipients": {"user_ids": [], "role": "", "owner": True},
                    "title": "{rule}: {record}",
                }
            ]
        if actions != list(row.actions or []):
            # Reassigned rather than mutated: a JSONB column changed in place
            # is not seen as dirty by SQLAlchemy and the UPDATE never happens.
            row.actions = actions
            changed = True

        if changed:
            repaired += 1

    return {"repaired": repaired, "paused": paused}


def _derived_condition(resource) -> dict[str, Any] | None:
    """A condition on a dataset's own state field, or None if it has none.

    Deliberately the same shape the seed builds, so a repaired rule is
    indistinguishable from a freshly seeded one.
    """
    for name in (resource.status_field, "priority", "status"):
        field = resource.fields.by_name.get(name) if name else None
        if field is not None and field.kind == "enum" and field.filterable and field.choices:
            return {
                "type": "group",
                "conjunction": "AND",
                "children1": {
                    "a": {
                        "type": "rule",
                        "properties": {
                            "field": field.name,
                            "operator": "select_any_in",
                            "value": [list(field.choices[:2])],
                        },
                    }
                },
            }
    return None


def _repaired_action(item: dict[str, Any]) -> dict[str, Any] | None:
    """One action in the shape the engine reads, or None if it cannot be.

    `type` → `kind` and an audience word → a recipient declaration: the old
    seed wrote `{"type": "NOTIFY", "audience": "OWNERS"}`, which the engine
    reads as an action addressed to nobody.
    """
    from src.services.automation.workflows import ACTIONS

    kind = str(item.get("kind") or item.get("type") or "").upper()
    action = ACTIONS.get(kind)
    if action is None:
        return None

    repaired: dict[str, Any] = {"kind": kind}
    for name in ("title", "body", "subject", "template", "priority", "assignee_id"):
        if item.get(name):
            repaired[name] = item[name]

    if "recipients" in action.needs:
        existing = item.get("recipients")
        if isinstance(existing, dict) and (
            existing.get("user_ids") or existing.get("role") or existing.get("owner")
        ):
            repaired["recipients"] = existing
        else:
            # `audience: OWNERS` and its friends meant the rule's owner.
            repaired["recipients"] = {"user_ids": [], "role": "", "owner": True}

    if "url" in action.needs:
        url = str(item.get("url") or "")
        if not url.startswith(("http://", "https://")):
            return None
        repaired["url"] = url

    return repaired
