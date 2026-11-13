"""The fields every dataset declares."""

from __future__ import annotations

from src.core.query import Field


def common_fields(model) -> tuple[Field, ...]:
    """The three fields every dataset has, plus tags where the table carries them.

    `tags` is declared here rather than per resource because it is the same
    thing everywhere — a shared vocabulary applied to anything (§37) — and
    because leaving it to each declaration is how five of the six datasets end
    up filterable by tag and the sixth silently does not.

    It is the *derived array column*, not a join to `tag_links`: the links are
    the truth and `services/tags._resync` is their only writer, so filtering on
    the column asks the same question with no join. `contains` is the operator
    that matters — "tagged urgent" — and `array` already has it.
    """
    fields = [
        Field("id", model.id, kind="uuid", label="ID"),
        Field("created_at", model.created_at, kind="datetime", label="Created"),
        Field("updated_at", model.updated_at, kind="datetime", label="Updated"),
    ]
    if hasattr(model, "tags"):
        fields.insert(
            0,
            Field("tags", model.tags, kind="array", label="Tags", searchable=True),
        )
    return tuple(fields)
