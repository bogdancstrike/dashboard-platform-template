"""How a record's human identifier is spelled, in one place.

`TSK-00042` is the string people quote to each other, paste into tickets and
search for; it is not the primary key. Two things produce them — the seed
writing fifteen thousand rows, and a person creating one from a form — and a
record created by hand has to be indistinguishable from a seeded one or the
demo dataset visibly splits into "the real ones" and "the ones I made".

Fixed-width zero padding is what makes that work beyond cosmetics: it keeps the
identifiers *lexicographically* ordered, so "what is the highest one so far"
is `MAX(reference)` — one index scan — rather than a parse of every row.
"""

from __future__ import annotations

import re


def identifier(prefix: str, number: int, *, width: int = 5) -> str:
    """`TSK-00042` — the prefix, a dash, and the number zero-padded to `width`."""
    return f"{prefix}-{number:0{width}d}"


def sequence_of(value: str | None, *, prefix: str) -> int:
    """The number inside an identifier, or 0 when there is not one.

    Tolerant on purpose: a dataset that has been imported from somewhere else
    holds identifiers in shapes this module never wrote, and "I cannot read
    that one" must mean "start again from one" rather than a 500 on the next
    create.
    """
    if not value:
        return 0
    match = re.fullmatch(rf"{re.escape(prefix)}-(\d+)", str(value))
    return int(match.group(1)) if match else 0
