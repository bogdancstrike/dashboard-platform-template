"""One vocabulary per enum column, shared by the seed and the query builder.

The failure this prevents is silent by nature. When the explorer declared its
own copy of the task statuses, it omitted `IN_REVIEW` — so eleven per cent of
the tasks were unreachable from the filter menu, and the menu looked complete.
Nothing errored, no test failed, and the only symptom was a dataset that seemed
to have no tasks in review.

So: the seed and the catalogue read the same tuples (asserted without a
database), and every value that actually reached a column is offered by the
field that exposes it (asserted against the seeded database).
"""

from __future__ import annotations

import pytest
from sqlalchemy import distinct, select

from src.core import vocabulary
from src.seed import catalog
from src.services.explorer import resources


def _names(weighted_values) -> tuple[str, ...]:
    return tuple(value for value, _weight in weighted_values)


@pytest.mark.parametrize(
    ("seeded", "declared"),
    [
        (_names(catalog.TASK_STATUSES), vocabulary.TASK_STATUS),
        (catalog.TASK_KINDS, vocabulary.TASK_KIND),
        (_names(catalog.PRIORITIES), vocabulary.PRIORITY),
        (_names(catalog.SEVERITIES), vocabulary.SEVERITY),
        (_names(catalog.TICKET_STATUSES), vocabulary.TICKET_STATUS),
        (catalog.TICKET_CATEGORIES, vocabulary.TICKET_CATEGORY),
        (_names(catalog.TICKET_CHANNELS), vocabulary.TICKET_CHANNEL),
        (_names(catalog.PROJECT_STATUSES), vocabulary.PROJECT_STATUS),
        (catalog.PROJECT_PHASES, vocabulary.PROJECT_PHASE),
        (_names(catalog.PROJECT_HEALTH), vocabulary.PROJECT_HEALTH),
        (_names(catalog.CUSTOMER_STATUSES), vocabulary.CUSTOMER_STATUS),
        (_names(catalog.CUSTOMER_SEGMENTS), vocabulary.CUSTOMER_SEGMENT),
        (_names(catalog.LIFECYCLE_STAGES), vocabulary.LIFECYCLE_STAGE),
        (_names(catalog.ORDER_STATUSES), vocabulary.ORDER_STATUS),
        (_names(catalog.PAYMENT_STATUSES), vocabulary.PAYMENT_STATUS),
        (catalog.ORDER_CHANNELS, vocabulary.ORDER_CHANNEL),
        (_names(catalog.DEVICE_KINDS), vocabulary.DEVICE_KIND),
        (_names(catalog.DEVICE_STATUSES), vocabulary.DEVICE_STATUS),
    ],
)
def test_the_seed_draws_from_the_shared_vocabulary(seeded, declared):
    assert seeded == declared


def test_weights_must_cover_the_whole_vocabulary():
    with pytest.raises(ValueError) as failure:
        vocabulary.weighted(("A", "B"), (1.0,))

    assert "needs a share" in str(failure.value)


def test_every_enum_field_declares_its_values():
    """An enum with no choices leaves the query builder a free-text box, which
    is how a filter comes to accept a value the column can never hold."""
    without = [
        f"{key}.{spec.name}"
        for key, resource in resources().items()
        for spec in resource.fields.fields
        if spec.kind == "enum" and not spec.choices
    ]
    assert without == []


@pytest.mark.database
def test_no_seeded_value_is_missing_from_the_filter_menu(app):
    """Data ⊆ declared: whatever is in the column can be filtered for."""
    from src.core.db import session_scope

    missing: dict[str, list[str]] = {}
    with session_scope() as session:
        for key, resource in resources().items():
            for spec in resource.fields.fields:
                if spec.kind != "enum" or not spec.choices:
                    continue
                present = {
                    value
                    for (value,) in session.execute(select(distinct(spec.column)))
                    if value is not None
                }
                unreachable = sorted(present - set(spec.choices))
                if unreachable:
                    missing[f"{key}.{spec.name}"] = unreachable

    assert missing == {}
