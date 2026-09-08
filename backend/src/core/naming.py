"""How a record's human identifier — and a person's — is spelled, in one place.

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


def initials(name: str | None) -> str:
    """`Ada Administrator` → `AA`. The first name's letter and the last name's.

    Here because it was written twice and the two copies disagreed. The
    directory took the first and *last* words; the user endpoint took the first
    *two*. So "Ada Marie Administrator" was `AA` on one screen and `AM` on
    another — the same person, two avatars, and no way for a reader to tell
    which was the mistake.

    First-and-last is the surviving rule: it is what a person's initials are,
    and a middle name is not part of them.
    """
    parts = [part for part in str(name or "").split() if part]
    if not parts:
        return "?"
    first = parts[0][0]
    last = parts[-1][0] if len(parts) > 1 else ""
    return (first + last).upper()
