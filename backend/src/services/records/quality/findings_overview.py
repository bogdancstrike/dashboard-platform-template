"""The quality overview, and its summary."""

from __future__ import annotations

from typing import Any

from src.core import cache
from src.core.clock import iso, now
from src.core.errors import NotFoundError
from src.core.query import count_of
from src.services.records.explorer import Resource, resource_for
from src.services.records.quality.check_catalogue import catalogue
from src.services.records.quality.checks import SAMPLE, VIEW_PERMISSION, Check
from src.services.records.quality.counting import _link, _statement


def overview(session, *, principal, resource_key: str = "") -> dict[str, Any]:
    """Every check, counted, with somewhere to go for each (§65)."""
    principal.require(VIEW_PERMISSION)
    checks = catalogue()
    if resource_key:
        # Validated, so an unknown dataset is a *refusal* rather than an empty
        # page that looks exactly like a clean bill of health. `resource_for`
        # raises a 400 naming the datasets that do exist, which is more use
        # than a 404: the caller has usually mistyped one of them.
        resource_for(resource_key, principal=principal)
        checks = [check for check in checks if check.resource == resource_key]

    findings = [_finding(session, check, principal=principal) for check in checks]
    counted = [finding for finding in findings if finding["count"] > 0]

    return {
        "resource_type": resource_key,
        "generated_at": iso(now()),
        "findings": findings,
        "totals": {
            # Findings rather than rows: "four things are wrong" is what somebody
            # acts on, and one contradiction matters more than four hundred
            # missing phone numbers.
            "checks": len(findings),
            "failing": len(counted),
            "records": sum(finding["count"] for finding in counted),
            "by_severity": {
                severity: sum(
                    1 for finding in counted if finding["severity"] == severity
                )
                for severity in ("CRITICAL", "WARNING", "INFO")
            },
        },
        "datasets": _datasets(session, principal=principal),
    }


def summary(session, resource_key: str, *, principal) -> dict[str, Any]:
    """How many findings one dataset has, for the indicator on its list (§65).

    Deliberately just the counts. A list page wants a chip saying "3 data
    issues" that opens the page which explains them; putting the explanations
    on every list would be the quality page rendered six times.
    """
    principal.require(VIEW_PERMISSION)
    resource = resource_for(resource_key, principal=principal)
    return cache.aggregate(
        f"quality:summary:{resource.key}",
        {},
        depends_on=(resource.key,),
        producer=lambda: _summary(session, resource, principal=principal),
    )


def _summary(session, resource: Resource, *, principal) -> dict[str, Any]:
    counts = {"CRITICAL": 0, "WARNING": 0, "INFO": 0}
    records = 0
    failing = 0
    for check in catalogue():
        if check.resource != resource.key:
            continue
        count = _count(session, check, resource)
        if count == 0:
            continue
        failing += 1
        records += count
        counts[check.severity] = counts.get(check.severity, 0) + 1

    return {
        "resource_type": resource.key,
        "failing": failing,
        "records": records,
        "by_severity": counts,
        # The worst thing found, so a chip can be one colour rather than three.
        "worst": (
            "CRITICAL" if counts["CRITICAL"] else "WARNING" if counts["WARNING"] else
            "INFO" if counts["INFO"] else ""
        ),
    }


def _count(session, check: Check, resource: Resource) -> int:
    return int(count_of(session, _statement(check, resource)))


def _finding(session, check: Check, *, principal) -> dict[str, Any]:
    resource = resource_for(check.resource, principal=principal)
    statement = _statement(check, resource)
    count = int(count_of(session, statement))

    rows = (
        session.scalars(statement.limit(SAMPLE)).unique().all() if count else []
    )
    return {
        "key": check.key,
        "resource_type": resource.key,
        "resource_label": resource.label,
        "title": check.title,
        "why": check.why,
        "fix": check.fix,
        "severity": check.severity,
        "count": count,
        # The address the reader goes to. Present only when the check *is* a
        # filter, because a link that returned different rows from the count
        # beside it would be worse than no link at all.
        "link": _link(resource, check) if check.linkable else "",
        "why_no_link": (
            ""
            if check.linkable
            else "This compares two columns, which a filter cannot express — so the records are named here instead."
        ),
        "sample": [
            {
                "id": str(row.id),
                "label": resource.label_for(row),
                "path": f"{resource.path}/{row.id}",
            }
            for row in rows
        ],
    }


def _datasets(session, *, principal) -> list[dict[str, Any]]:
    """Each dataset with its own failing count, for the page's own navigation."""
    keys = sorted({check.resource for check in catalogue()})
    out = []
    for key in keys:
        try:
            resource = resource_for(key, principal=principal)
        except NotFoundError:  # pragma: no cover - a dataset removed from the catalogue
            continue
        found = _summary(session, resource, principal=principal)
        out.append({**found, "label": resource.label, "path": resource.path})
    return out
