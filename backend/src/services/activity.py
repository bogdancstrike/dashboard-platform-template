"""The activity feed (§35, §48).

Every notable thing that happened, in one place, in the order it happened.

**Why this is not the audit trail.** `services/audit.py` answers "what was done
to *this record*, exactly, by whom, from where, and what changed" — it is
evidence, it is scoped to one resource on purpose, and it sits behind
`audit.view`. This answers "what has been going on", it spans everything the
reader may see, and it needs only `records.view`. Two questions, two
permissions, two shapes. Serving both from one endpoint would mean either
publishing the ledger to everybody or hiding the feed from almost everybody.

**The strip is the filter, and the server counts it.** A feed is worth a page
only if it can be narrowed faster than it can be read, so the response carries
a count per kind over the *whole* matching set. Counting the page that was
downloaded would give a number that silently means "of the fifty I have" (§71)
— and the counts are what make the strip honest: a kind with nothing in it is
offered, greyed, at zero, rather than vanishing and leaving the reader to
wonder whether the platform has stopped recording comments.

**Scoped by organization, like everything else.** An entry belongs to the
organization it happened in; a reader sees their own. `resource_type` is
filtered against the declared resources so an unknown value is a validation
error rather than a query that quietly matches nothing.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from src.core.errors import ValidationError
from src.core.naming import initials
from src.core.pagination import envelope, parse_page
from src.core.query import count_of
from src.services.analysis import period_window

VIEW_PERMISSION = "records.view"

#: The kinds the feed groups by, in the order the strip offers them.
#:
#: Written down here rather than read off the rows, because a vocabulary
#: derived from the data disappears one item at a time as a quiet installation
#: stops producing that kind — and "no security events today" is a fact worth
#: showing, not a chip worth hiding. Kept in step with
#: `core/audit._activity_kind`, which is what writes them.
KINDS: tuple[tuple[str, str], ...] = (
    ("RECORD", "Records"),
    ("UPDATE", "Edits"),
    ("STATUS", "Status changes"),
    ("COMMENT", "Comments"),
    ("FILE", "Files"),
    ("ASSIGNMENT", "Assignments"),
    ("SECURITY", "Sign-ins"),
    ("SYSTEM", "System"),
)

KIND_LABELS = dict(KINDS)

#: How far back the feed looks by default. A feed with no window is a feed that
#: reads the whole table to answer "what happened", which gets slower every day
#: the platform is used.
DEFAULT_PERIOD = "last_30_days"


def feed(session, args, *, principal) -> dict[str, Any]:
    """One page of the feed, plus a count per kind over the whole match."""
    principal.require(VIEW_PERMISSION)
    from src.models.platform import ActivityEntry

    page = parse_page(args, default_sort="occurred_at")
    kind = _kind(args.get("kind"))
    resource_type = _resource_type(args.get("resource_type"), principal=principal)
    actor_id = (args.get("actor_id") or "").strip()
    period = (args.get("period") or DEFAULT_PERIOD).strip()

    # The window is the analysis compiler's, so "last 30 days" means the same
    # thing on this page as it does on every chart in the product.
    window = period_window(period)

    def scoped():
        statement = select(ActivityEntry)
        if principal.organization_id:
            statement = statement.where(
                ActivityEntry.organization_id == principal.organization_id
            )
        if window.start is not None:
            statement = statement.where(ActivityEntry.occurred_at >= window.start)
        if window.end is not None:
            statement = statement.where(ActivityEntry.occurred_at <= window.end)
        if resource_type:
            statement = statement.where(ActivityEntry.resource_type == resource_type)
        if actor_id:
            statement = statement.where(ActivityEntry.actor_id == actor_id)
        return statement

    # Counted before the kind filter is applied, so choosing a chip does not
    # change the numbers on the other chips — a strip whose counts move when
    # you use it cannot be used to compare.
    counted = dict(
        session.execute(
            scoped()
            .with_only_columns(ActivityEntry.kind, func.count())
            .group_by(ActivityEntry.kind)
        ).all()
    )

    statement = scoped()
    if kind:
        statement = statement.where(ActivityEntry.kind == kind)

    ordered = statement.order_by(
        ActivityEntry.occurred_at.asc() if page.order == "asc"
        else ActivityEntry.occurred_at.desc()
    )
    total = count_of(session, ordered)
    rows = session.scalars(ordered.offset(page.offset).limit(page.page_size)).all()

    return envelope(
        [_entry(row) for row in rows],
        total,
        page,
        kinds=[
            {
                "key": key,
                "label": label,
                "count": int(counted.get(key, 0)),
            }
            for key, label in KINDS
        ],
        kind=kind,
        resource_type=resource_type,
        actor_id=actor_id,
        period=window.key,
        # The whole matching set, whatever kind is chosen — so the strip can
        # say "of 1 162" rather than leaving the reader to add its chips up.
        matched=sum(int(value) for value in counted.values()),
    )


def _entry(row) -> dict[str, Any]:
    """One row, as the feed reads it.

    `resource_path` rather than a URL assembled in the browser: which page a
    resource opens on is declared once, beside the resource, and a feed that
    built its own links would be a second router.
    """
    return {
        "id": str(row.id),
        "occurred_at": _iso(row.occurred_at),
        "kind": row.kind,
        "kind_label": KIND_LABELS.get(row.kind, row.kind),
        "action": row.action,
        # The initials come from the one rule (`core/naming`), not from a
        # split done in the browser: two copies of "what are somebody's
        # initials" is how the same person ends up with two avatars.
        "actor": {
            "id": str(row.actor_id) if row.actor_id else None,
            "name": row.actor_label,
            "initials": initials(row.actor_label) if row.actor_label else None,
        },
        "resource_type": row.resource_type,
        "resource_id": row.resource_id,
        "resource_label": row.resource_label,
        "resource_path": _path_for(row.resource_type, row.resource_id),
        "summary": row.summary,
        "changed": list((row.metadata_json or {}).get("changed") or []),
    }


def _path_for(resource_type: str | None, resource_id: str | None) -> str | None:
    """Where this entry's subject lives, from the resource declarations."""
    if not resource_type or not resource_id:
        return None
    from src.services.explorer import resources

    resource = resources().get(resource_type)
    return f"{resource.path}/{resource_id}" if resource and resource.path else None


def _iso(value) -> str | None:
    return value.isoformat().replace("+00:00", "Z") if value else None


def _kind(raw: Any) -> str:
    kind = str(raw or "").strip().upper()
    if not kind:
        return ""
    if kind not in KIND_LABELS:
        raise ValidationError(
            "That is not an activity kind.",
            details={"kind": kind, "allowed": [key for key, _ in KINDS]},
        )
    return kind


def _resource_type(raw: Any, *, principal) -> str:
    """A declared resource the reader may see, or nothing.

    Validated rather than passed through: an unknown value would produce an
    empty feed that looks like "nothing happened" instead of "you asked for a
    dataset that does not exist" (§34).
    """
    resource_type = str(raw or "").strip()
    if not resource_type:
        return ""

    from src.services.explorer import resources

    resource = resources().get(resource_type)
    if resource is None:
        raise ValidationError(
            "That is not a dataset.",
            details={"resource_type": resource_type, "allowed": sorted(resources())},
        )
    principal.require(resource.permission)
    return resource_type
