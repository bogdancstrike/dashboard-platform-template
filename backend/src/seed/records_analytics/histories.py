"""Seed data for records analytics: _histories, _watches."""

from __future__ import annotations

import random
from datetime import timedelta

from sqlalchemy import func, select

from src.core.clock import now
from src.seed.records_analytics.drop_notifications import MARK, SEED, WATCHES, _persona
from src.seed.records_analytics.snapshots import _EDITS, _audit, _earlier, _staff


def _histories(session) -> int:
    from src.models.platform import AuditLog
    from src.services.records import writes as record_writes
    from src.services.records.explorer import resource_for

    if session.scalar(select(func.count()).select_from(AuditLog).where(
            AuditLog.metadata_json["source"].astext == MARK["source"], AuditLog.resource_type != "contract")):
        return 0
    rng = random.Random(SEED + 2)
    staff = [u for u in _staff(session)][:12] or [None]
    audited = set(session.scalars(select(AuditLog.resource_id).where(AuditLog.resource_id.is_not(None))).all())
    anchor = now()
    made = 0
    for key, edits in _EDITS.items():
        resource = resource_for(key)
        rows = [r for r in session.scalars(
            select(resource.model).where(resource.model.deleted_at.is_(None))
            .order_by(resource.model.updated_at.desc()).limit(40)
        ).unique().all() if str(r.id) not in audited][:3]
        for row in rows:
            current = record_writes._state(resource, row)
            state = dict(current)
            steps = rng.randint(4, 6)
            moment = anchor - timedelta(hours=rng.randint(2, 30))
            chain = []
            for _ in range(steps):
                field, choices = rng.choice([e for e in edits if e[0] in state])
                old = _earlier(state[field], choices, rng, field)
                if old == state[field]:
                    continue
                others = rng.sample([e for e in edits if e[0] != field and e[0] in state], k=min(1, len(edits) - 1))
                change_before = {field: old}
                change_after = {field: state[field]}
                if others and rng.random() < 0.4:
                    second = others[0][0]
                    older = _earlier(state[second], others[0][1], rng, second)
                    if older != state[second]:
                        change_before[second] = older
                        change_after[second] = state[second]
                chain.append((moment, change_before, change_after))
                state.update(change_before)
                moment -= timedelta(days=rng.randint(1, 9), hours=rng.randint(0, 20))
            created_at = min(row.created_at or moment, moment - timedelta(days=2))
            actor = rng.choice(staff)
            label = resource.label_for(row)
            _audit(session, at=created_at, action="CREATE", resource_type=key, resource_id=row.id, label=label,
                   actor=actor, before=None, after=dict(state), message=f"created {label}")
            for at, before, after in reversed(chain):
                status_only = set(before) == {resource.status_field}
                _audit(session, at=at, action="STATUS_CHANGE" if status_only else "UPDATE", resource_type=key,
                       resource_id=row.id, label=label, actor=rng.choice(staff), before=before, after=after,
                       message=(f"moved {label} to {after[resource.status_field]}" if status_only
                                else f"updated {label} ({', '.join(sorted(after))})"))
            made += 1
    session.flush()
    return made


def _watches(session) -> int:
    from src.models.records_analytics import MetricWatch
    from src.services.analytics import metric_watches

    if session.scalar(select(func.count()).select_from(MetricWatch)):
        return 0
    owner = _persona(session, "admin") or (_staff(session) or [None])[0]
    manager = _persona(session, "manager")
    made = 0
    for spec in WATCHES:
        row = MetricWatch(
            name=spec["name"], description=spec.get("description"), dataset=spec["dataset"],
            measure=spec["measure"], measure_field=spec.get("measure_field"), date_field=spec.get("date_field"),
            filters=spec.get("filters") or {}, granularity=spec["granularity"], method=spec["method"],
            sensitivity=spec["sensitivity"], direction=spec.get("direction", "both"), window=spec["window"],
            channels=spec.get("channels", ["in_app"]), recipient_ids=[str(manager.id)] if manager else [],
            enabled=True, muted=False, owner_id=owner.id if owner else None,
        )
        session.add(row)
        session.flush()
        metric_watches.evaluate(session, row, backfill=True, notify=False)
        made += 1
    # One snoozed, so the list shows what that looks like.
    snoozed = session.scalars(select(MetricWatch).where(MetricWatch.name == "Escalated tickets per week")).first()
    if snoozed is not None:
        snoozed.snoozed_until = now() + timedelta(days=2)
    session.flush()
    return made
