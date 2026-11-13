"""What the seeded data says that is no longer true: tags, reports, automations, headcounts."""

from __future__ import annotations


def _headcount_drift(session) -> list[str]:
    """Departments whose stored `headcount` disagrees with their people.

    Reported rather than tolerated because two numbers for one fact is the
    defect this whole codebase keeps finding, and the stored one is always the
    one that lies. `--sync-org` is the repair; `services/organizations`
    computes the count itself so the API is right either way.
    """
    from sqlalchemy import func, select

    from src.models.identity import Department, User

    actual = dict(
        session.execute(
            select(User.department_id, func.count())
            .where(User.department_id.is_not(None), User.deleted_at.is_(None))
            .group_by(User.department_id)
        ).all()
    )
    problems: list[str] = []
    for row in session.scalars(
        select(Department).where(Department.deleted_at.is_(None))
    ).all():
        real = int(actual.get(row.id, 0))
        if int(row.headcount or 0) != real:
            problems.append(
                f"department {row.name!r} says {row.headcount} people, has {real}"
            )
    return problems


def _tags_out_of_step(session) -> list[str]:
    """Where a record's `tags` array disagrees with its links.

    Compared as *sets of names*, because that is what the column is a cache
    of. Reported per dataset with a count rather than per record: "17 tasks
    disagree" is what somebody acts on, and seventeen identical lines are what
    they scroll past.
    """
    from sqlalchemy import func
    from sqlalchemy import select as _select

    from src.models.content import Tag, TagLink
    from src.services.records.explorer import resources as _resources

    problems: list[str] = []

    links: dict[tuple[str, str], set[str]] = {}
    for resource_type, resource_id, name in session.execute(
        _select(TagLink.resource_type, TagLink.resource_id, Tag.name).join(
            Tag, Tag.id == TagLink.tag_id
        )
    ).all():
        links.setdefault((str(resource_type), str(resource_id)), set()).add(str(name))

    for key, resource in _resources().items():
        model = resource.model
        if not hasattr(model, "tags"):
            continue
        wrong = 0
        for row in session.scalars(_select(model)).unique().all():
            stored = set(row.tags or [])
            wanted = links.get((key, str(row.id)), set())
            if stored != wanted:
                wrong += 1
        if wrong:
            problems.append(
                f"{key}.tags: {wrong} records disagree with their tag links — "
                "run `python -m src.seed --sync-tags`"
            )

    # And the counts the tag manager sorts by.
    drifted = 0
    for tag in session.scalars(_select(Tag)).all():
        wanted = int(
            session.scalar(
                _select(func.count()).select_from(TagLink).where(TagLink.tag_id == tag.id)
            )
            or 0
        )
        if int(tag.usage_count or 0) != wanted:
            drifted += 1
    if drifted:
        problems.append(
            f"tags.usage_count: {drifted} tags disagree with their links — "
            "run `python -m src.seed --sync-tags`"
        )
    return problems
