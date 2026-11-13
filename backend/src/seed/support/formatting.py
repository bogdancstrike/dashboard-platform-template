"""Seed data for support: reference, avatar_data_uri, checksum_of, mask_hash."""

from __future__ import annotations

import hashlib
from typing import Any

from src.core.naming import identifier
from src.seed.support.rng import initials_of


def reference(prefix: str, number: int, *, width: int = 5) -> str:
    """A seeded record's human identifier.

    Delegates to `core.naming` so a row written here and one created from a
    form later carry the same shape; two spellings of `TSK-00042` is a dataset
    that visibly splits into "the seeded ones" and "the ones somebody made".
    """
    return identifier(prefix, number, width=width)


def avatar_data_uri(name: str, color: str) -> str:
    """An initials avatar as an inline SVG.

    No avatar service, no image files: the demo has to render identically on a
    laptop with no network, and 150 users' worth of portraits is not something
    a template should carry in git.
    """
    initials = initials_of(name)
    svg = (
        "<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'>"
        f"<rect width='64' height='64' rx='32' fill='{color}'/>"
        "<text x='32' y='41' font-family='Inter,system-ui,sans-serif' font-size='24' "
        f"font-weight='600' fill='#ffffff' text-anchor='middle'>{initials}</text></svg>"
    )
    from urllib.parse import quote

    return f"data:image/svg+xml;charset=utf-8,{quote(svg)}"


def checksum_of(*parts: Any) -> str:
    return hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()


def mask_hash(secret: str) -> str:
    """What actually goes in `api_credentials.secret_hash`.

    A plain SHA-256, matching the seed's purpose: this is demo data, and the
    point being demonstrated is that the *plaintext is not stored*. Real
    credential issuance should use a slow KDF; the column is sized for it.
    """
    return f"sha256${hashlib.sha256(secret.encode()).hexdigest()}"
