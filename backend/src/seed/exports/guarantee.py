"""Seed data for exports: _guarantee."""

from __future__ import annotations

from sqlalchemy import select

from src.seed.exports.recount import GUARANTEED_DOWNLOADABLE, _next_reference


def _guarantee(session, store) -> int:
    """Give every persona who may export one finished export. Additive."""
    from src.core import vocabulary
    from src.core.clock import now
    from src.models.identity import User
    from src.models.platform import BackgroundJob
    from src.seed.identity import PERSONAS
    from src.seed.support import Rng
    from src.services.records import explorer
    from src.services.transfer import exports

    anchor = now()
    # Seeded from the clock, as every repair is: a fixed seed regenerates the
    # same UUIDs, so a second run collides with the rows the first one wrote.
    rng = Rng(int(anchor.timestamp() * 1000), anchor).derive("exports-topup")

    people = session.scalars(
        select(User).where(
            User.username.in_([username for username, *_rest in PERSONAS]),
            User.deleted_at.is_(None),
        )
    ).all()

    written = 0
    for person in people:
        allowed = set((person.role.permissions if person.role else None) or ())
        if exports.PERMISSION not in allowed:
            # A viewer holds no export privilege, so an export attributed to
            # one would be a row the product would refuse to create.
            continue

        ready = [
            row
            for row in session.scalars(
                select(BackgroundJob).where(
                    BackgroundJob.kind == exports.KIND,
                    BackgroundJob.initiated_by_id == person.id,
                    BackgroundJob.status == "SUCCEEDED",
                )
            )
            if store.stat(str((row.result or {}).get("artifact") or "") or "-") is not None
        ]
        if len(ready) >= GUARANTEED_DOWNLOADABLE:
            continue

        # A dataset this person's role can actually read, chosen from the
        # registry rather than named here: a resource whose permission the
        # persona lacks is an export the API would refuse.
        candidates = [
            resource
            for key, resource in sorted(explorer.resources().items())
            if resource.permission in allowed
        ]
        if not candidates:
            continue
        resource = candidates[0]

        plan = explorer.replan({
            "resource_type": resource.key,
            "format": rng.pick(("csv", "json", "xlsx")),
        })
        row = BackgroundJob(
            id=rng.uuid(),
            reference=_next_reference(session),
            name=f"{resource.label} — {plan.fmt.upper()}",
            kind=exports.KIND,
            queue=exports.QUEUE,
            status="SUCCEEDED",
            priority="NORMAL",
            attempt=1,
            max_attempts=1,
            initiated_by_id=person.id,
            initiated_by_label=person.full_name,
            organization_id=person.organization_id,
            payload=plan.stored(),
            # Recent, because `retention.export_days` is measured from here and
            # an export seeded a month ago is one that arrives expired.
            started_at=rng.recent(days=1),
            log_lines=[
                {"at": anchor.isoformat(), "level": "INFO", "message": "accepted"},
                {"at": anchor.isoformat(), "level": "INFO", "message": "finished"},
            ],
        )
        row.finished_at = row.started_at
        session.add(row)
        session.flush()

        result = exports.produce(session, row, store=store)
        row.result = {**result, "ran_as": "seed"}
        row.total_units = row.processed_units = result["rows"]
        row.progress = 100
        row.duration_ms = rng.integer(400, 9_000)
        assert vocabulary.JOB_STATUS, "job statuses are declared in core/vocabulary"
        written += 1

    return written
