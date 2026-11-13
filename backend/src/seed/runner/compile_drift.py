"""Seeded reports and automations the compiler would refuse."""

from __future__ import annotations

from src.services.automation.graph.shape import trigger_of


def _unrunnable_reports(session) -> list[str]:
    """Reports naming a column or an aggregation the compiler does not know.

    Checked against the same declarations the analysis catalogue publishes,
    which is what the compiler itself resolves against — so this cannot drift
    from the rule it is testing.
    """
    from sqlalchemy import select as _select

    from src.models.personal import Report
    from src.services.analytics.analysis import (
        AGGREGATIONS,
        DIMENSION_KINDS,
        MEASURE_KINDS,
    )
    from src.services.records.explorer import resources

    catalogue = resources()
    problems: list[str] = []
    counts: dict[str, int] = {}

    for row in session.scalars(_select(Report).where(Report.deleted_at.is_(None))):
        resource = catalogue.get(row.resource_type)
        if resource is None:
            counts[f"names dataset {row.resource_type}, which does not exist"] = (
                counts.get(f"names dataset {row.resource_type}, which does not exist", 0) + 1
            )
            continue

        groupable = {
            field.name
            for field in resource.fields.fields
            if field.kind in DIMENSION_KINDS and field.filterable
        }
        measurable = {
            field.name for field in resource.fields.fields if field.kind in MEASURE_KINDS
        }

        faults: list[str] = []
        if len(row.dimensions or []) > 2:
            faults.append("groups by more than two columns")
        for entry in row.dimensions or []:
            name = str(entry).partition(":")[0]
            if name not in groupable:
                faults.append(f"cannot group {row.resource_type} by {name}")
        for entry in row.metrics or []:
            aggregation, _, field = str(entry).partition(":")
            if aggregation not in AGGREGATIONS:
                faults.append(f"{aggregation} is not an aggregation")
            elif aggregation != "count" and field not in measurable:
                faults.append(f"cannot {aggregation} {row.resource_type}.{field or '(nothing)'}")

        for fault in faults:
            counts[fault] = counts.get(fault, 0) + 1

    for fault, count in sorted(counts.items(), key=lambda pair: -pair[1]):
        problems.append(f"{count} report(s) {fault}")
    return problems


def _unrunnable_automations(session) -> list[str]:
    """Automations the engine could not evaluate or could not act on.

    The same check the *reports* one is: rules seeded before the generator
    derived them from the declarations watch datasets the explorer does not
    have, compile conditions against fields that are not there, and carry
    actions in a shape `services/workflows` never reads. A rule like that
    reports success by never firing, which is the worst failure a monitoring
    feature has — so it is checked, and named.
    """
    from sqlalchemy import select as _select

    from src.core.errors import ValidationError
    from src.core.rules import compile_tree
    from src.models.automation_graphs import AutomationGraph
    from src.models.platform import AlertRule
    from src.services.automation.workflows import ACTIONS
    from src.services.records.explorer import resources

    catalogue = resources()
    counts: dict[str, int] = {}

    # Enabled rules only. A paused rule cannot fire, so an unrunnable one is a
    # recorded outcome rather than a fault — `--sync-automations` pauses the
    # rules whose dataset is gone, and a check that kept reporting them after
    # the repair is a check nobody can ever get to green.
    live = _select(AlertRule).where(
        AlertRule.deleted_at.is_(None), AlertRule.enabled.is_(True)
    )
    for row in session.scalars(live):
        resource = catalogue.get(row.resource_type)
        if resource is None:
            counts[f"watch dataset {row.resource_type}, which does not exist"] = (
                counts.get(f"watch dataset {row.resource_type}, which does not exist", 0) + 1
            )
            continue
        # A workflow started by an event (a record created, a webhook, a form)
        # walks the record it was given; only a scheduled one needs a condition
        # to say which records each run looks at (§49).
        graph = session.scalar(_select(AutomationGraph.published).where(AutomationGraph.rule_id == row.id))
        trigger = trigger_of(graph)
        event_started = bool(trigger and trigger["data"].get("event") not in (None, "SCHEDULE"))
        try:
            if compile_tree(row.condition_tree, resource.fields) is None and not event_started:
                counts["have no condition, so they match nothing"] = (
                    counts.get("have no condition, so they match nothing", 0) + 1
                )
        except ValidationError as error:
            key = f"cannot compile their condition ({error})"
            counts[key] = counts.get(key, 0) + 1
        kinds = {
            str(item.get("kind") or item.get("type") or "").upper()
            for item in (row.actions or [])
            if isinstance(item, dict)
        }
        if not kinds or not kinds & set(ACTIONS):
            counts["carry no action this platform can run"] = (
                counts.get("carry no action this platform can run", 0) + 1
            )

    return [
        f"{count} automation(s) {fault}"
        for fault, count in sorted(counts.items(), key=lambda pair: -pair[1])
    ]
