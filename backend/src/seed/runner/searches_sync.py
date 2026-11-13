"""Repairing saved searches."""

from __future__ import annotations


def sync_searches(session) -> dict[str, int]:
    """Make saved searches runnable, and give every list one view it can show (§5, §46).

    Two repairs, both of which an existing database needs and neither of which
    a seed run will perform, because seeding refuses to touch a populated one.

    **Filter keys no dataset declares are dropped.** The generator used to
    write `filters={"q": …}`, and `q` is not a field: `apply_filters` iterates
    the *declared* fields and ignores anything else, so the row looked correct
    for as long as nothing applied it. The moment the entity lists could apply
    a saved search (§46) it put `f.q=overdue` in the address and counted it as
    a filter that narrows nothing.

    **Every dataset gets one public view a list can actually show.** A saved
    search carrying a condition tree is offered on a list as a link to the Data
    Explorer, because a tree of ANDs and ORs is not expressible in a row of
    facet selects — so a database whose saved searches all came from the rule
    builder demonstrates half of §46. The six in `catalog.LIST_VIEWS` are added
    if they are missing, owned by the personas in turn and public.

    Additive and idempotent: nothing existing is deleted or rewritten except
    the removal of filter keys that cannot work, and a view already present is
    left exactly as its owner has it.
    """
    from sqlalchemy import func
    from sqlalchemy import select as _select

    from src.models.identity import User
    from src.models.personal import SavedSearch
    from src.seed import catalog
    from src.seed.identity import PERSONA_DOMAIN, PERSONAS
    from src.seed.personal import COLUMN_SETS
    from src.services.records.explorer import resources as _resources

    catalogue = _resources()
    cleaned = 0
    added = 0

    for row in session.scalars(
        _select(SavedSearch).where(SavedSearch.deleted_at.is_(None))
    ).unique():
        resource = catalogue.get(row.resource_type)
        if resource is None or not isinstance(row.filters, dict):
            continue
        kept = {
            key: value
            for key, value in row.filters.items()
            if key in resource.fields.by_name and resource.fields.by_name[key].filterable
        }
        if len(kept) != len(row.filters):
            row.filters = kept
            cleaned += 1

    # The personas, in the order `identity` writes them, so which one owns
    # which view is the same in a repaired database as in a freshly seeded one.
    people: list[User] = []
    for username, *_rest in PERSONAS:
        person = session.scalars(
            _select(User).where(User.email == f"{username}@{PERSONA_DOMAIN}")
        ).one_or_none()
        if person is not None:
            people.append(person)
    if not people:
        return {"cleaned": cleaned, "added": added}

    for index, (name, resource_type, field, value) in enumerate(catalog.LIST_VIEWS):
        resource = catalogue.get(resource_type)
        if resource is None:
            continue
        exists = session.scalar(
            _select(func.count())
            .select_from(SavedSearch)
            .where(
                SavedSearch.name == name,
                SavedSearch.resource_type == resource_type,
                SavedSearch.deleted_at.is_(None),
            )
        )
        if exists:
            continue
        owner = people[index % len(people)]
        session.add(
            SavedSearch(
                name=name,
                description=f"Saved from the {resource_type} list.",
                resource_type=resource_type,
                owner_id=owner.id,
                organization_id=owner.organization_id,
                scope="PUBLIC",
                condition_tree=None,
                condition_text=None,
                filters={field: value},
                sort="updated_at",
                order="desc",
                columns=list(COLUMN_SETS.get(resource_type, ("name", "status"))),
                page_size=25,
                view_mode="table",
                is_default=False,
                rule_count=0,
                use_count=0,
            )
        )
        added += 1

    return {"cleaned": cleaned, "added": added}
