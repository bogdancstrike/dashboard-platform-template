"""Seed data for personal: SEARCH_SCOPES, SCOPES, _SPEC."""

from __future__ import annotations

from src.core.query import Field, FieldSet
from src.core.rules import describe_tree, rule_count
from src.models.business import Task
from src.seed import catalog
from src.seed.world import World

#: Saved searches (§5): private by default, some shared with named people, a
#: few public. Weighted so the majority are private — which is what makes the
#: sharing screens worth having and the visibility query worth testing.
SEARCH_SCOPES: tuple[tuple[str, float], ...] = (
    ("PRIVATE", 0.6), ("SHARED", 0.28), ("PUBLIC", 0.12),
)


#: Views, dashboards and reports share the *same* three states, because
#: `core/sharing` is the one sharing model and it knows three.
#:
#: This used to carry a broader ladder — `TEAM` and `ORGANIZATION` — for an
#: audience nothing implements. The consequence was silent: `sharing.visibility`
#: has no branch for either, so a seeded dashboard scoped `TEAM` was invisible
#: to everybody but its owner, and any edit touching its scope was refused
#: against a vocabulary it was not in. Three states that work beat four where
#: two are a plan.
SCOPES: tuple[tuple[str, float], ...] = (
    ("PRIVATE", 0.5), ("SHARED", 0.32), ("PUBLIC", 0.18),
)


#: Enough of a field set to render `condition_text` through the same code the
#: query inspector uses, rather than writing the description by hand.
_SPEC = FieldSet(
    Field("status", Task.status, kind="enum", label="Status"),
    Field("priority", Task.priority, kind="enum", label="Priority"),
    Field("due_date", Task.due_date, kind="datetime", label="Due date"),
    Field("title", Task.title, kind="text", label="Title", searchable=True),
)


COLUMN_SETS: dict[str, tuple[str, ...]] = {
    "task": ("reference", "title", "status", "priority", "assignee", "due_date"),
    "ticket": ("reference", "subject", "status", "severity", "customer", "due_at"),
    "project": ("code", "name", "status", "health", "owner", "progress", "due_date"),
    "customer": ("code", "name", "segment", "lifecycle_stage", "lifetime_value", "account_manager"),
    "order": ("reference", "customer", "status", "payment_status", "total", "placed_at"),
    "device": ("serial", "name", "kind", "status", "location", "last_seen_at"),
    "user": ("full_name", "email", "role", "department", "status", "last_login_at"),
    "file": ("name", "kind", "size_bytes", "owner", "created_at"),
}


def _audience(world: World):
    """Personas weighted heavily, everyone else present but thin."""
    return list(world.personas.values()) * 4 + world.users


def _condition_tree(rng) -> dict:
    return {
        "type": "group",
        "conjunction": rng.pick(("AND", "AND", "OR")),
        "children1": {
            "r1": {
                "type": "rule",
                "properties": {
                    "field": "status",
                    "operator": "select_not_any_in",
                    "value": [["DONE", "CANCELLED"]],
                },
            },
            "r2": {
                "type": "rule",
                "properties": {
                    "field": "priority",
                    "operator": "select_any_in",
                    "value": [["HIGH", "CRITICAL"]],
                },
            },
        },
    }


def _saved_searches(world: World) -> None:
    from src.models.personal import SavedSearch

    rng = world.rng.derive("saved-searches")
    audience = _audience(world)
    if not audience:
        return

    for index in range(world.scale.saved_searches):
        name, resource_type = catalog.SAVED_SEARCH_NAMES[index % len(catalog.SAVED_SEARCH_NAMES)]
        owner = rng.pick(audience)
        tree = _condition_tree(rng)
        columns = COLUMN_SETS.get(resource_type, ("name", "status"))

        world.saved_searches.append(
            SavedSearch(
                id=rng.uuid(),
                name=name if index < len(catalog.SAVED_SEARCH_NAMES) else f"{name} ({index // len(catalog.SAVED_SEARCH_NAMES) + 1})",
                description=rng.maybe(f"{name} — kept for the weekly review.", 0.5),
                resource_type=resource_type,
                owner_id=owner.id,
                organization_id=owner.organization_id,
                scope=rng.weighted(SEARCH_SCOPES),
                condition_tree=tree,
                # Rendered by the inspector's own function: the text a user
                # reads is then provably the shape of the SQL that runs.
                condition_text=describe_tree(tree, _SPEC),
                # Nothing: these are the *explorer's* searches and the
                # question is the tree above. `filters` holds plain field
                # filters, which is what `_list_views` below writes. It used to
                # be `{"q": …}`, a key no dataset declares — `apply_filters`
                # ignores one, so the row looked fine and put `f.q=overdue` in
                # the address of every list that applied it (§46).
                filters={},
                query_text=rng.maybe("overdue", 0.3),
                sort=rng.pick(("created_at", "due_date", "priority")),
                order=rng.pick(("asc", "desc")),
                columns=list(columns),
                page_size=rng.pick((10, 25, 50, 100)),
                view_mode=rng.pick(("table", "table", "board", "cards")),
                # Not `is_favorite`: a star is a fact about a reader, so it
                # lives in `favorites` and `_favorites` below writes it (§38).
                is_default=index == 0,
                rule_count=rule_count(tree),
                use_count=rng.integer(0, 240),
                last_used_at=rng.maybe(rng.recent(days=30), 0.8),
                created_at=rng.ago(days_min=5, days_max=400),
            )
        )
