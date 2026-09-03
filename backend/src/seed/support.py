"""Deterministic randomness, and the small helpers every builder needs.

"Deterministic" here means the *graph* is deterministic: the same seed produces
the same organizations, the same people in the same departments, the same
projects owned by the same users, with the same ids. Timestamps are offsets
from an anchor taken once at the start of a run, so a dataset seeded today
looks like it was made today rather than in whatever month this template was
written. Two runs at the same instant are byte-identical; runs a week apart
differ only by the anchor.

Stable ids matter more than they look. A screenshot in the documentation, a
bookmark, a URL pasted into a ticket — all of them survive a reseed only if
`gen_random_uuid()` is not what produced the id.
"""

from __future__ import annotations

import hashlib
import random
import re
import unicodedata
from datetime import datetime, timedelta
from typing import Any, Iterable, Sequence, TypeVar
from uuid import UUID

T = TypeVar("T")

_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


class Rng:
    """A seeded random source with the vocabulary a data generator wants.

    Wraps `random.Random` rather than the module-global, so seeding one part of
    the generator cannot be perturbed by anything else that happens to call
    `random` — including a library doing it at import time.
    """

    __slots__ = ("_random", "anchor", "seed")

    def __init__(self, seed: int, anchor: datetime) -> None:
        self.seed = seed
        self.anchor = anchor
        self._random = random.Random(seed)

    def derive(self, label: str) -> Rng:
        """An independent stream, named.

        Lets one section of the seed change without shifting every value in the
        sections after it — otherwise adding one customer renames every user.
        """
        digest = hashlib.sha256(f"{self.seed}:{label}".encode()).digest()
        return Rng(int.from_bytes(digest[:8], "big"), self.anchor)

    # ── identity ─────────────────────────────────────────────────────────

    def uuid(self) -> UUID:
        """A version-4 UUID drawn from the seeded stream, not from urandom."""
        return UUID(int=self._random.getrandbits(128), version=4)

    # ── choice ───────────────────────────────────────────────────────────

    def pick(self, options: Sequence[T]) -> T:
        return self._random.choice(options)

    def sample(self, options: Sequence[T], k: int) -> list[T]:
        k = max(0, min(k, len(options)))
        return self._random.sample(list(options), k)

    def shuffled(self, options: Iterable[T]) -> list[T]:
        items = list(options)
        self._random.shuffle(items)
        return items

    def weighted(self, choices: Sequence[tuple[T, float]]) -> T:
        """Pick by weight — the reason statuses look like a real backlog.

        Uniformly random statuses give every column of a kanban the same
        height, which is the one thing no real board ever looks like.
        """
        values = [value for value, _ in choices]
        weights = [weight for _, weight in choices]
        return self._random.choices(values, weights=weights, k=1)[0]

    def chance(self, probability: float) -> bool:
        return self._random.random() < probability

    def maybe(self, value: T, probability: float = 0.8) -> T | None:
        """`value` most of the time, `None` the rest.

        Deliberate holes in the data: a template whose every column is populated
        never exercises the empty states, the "—" placeholders or the
        `is empty` filter, and those are exactly what break in production.
        """
        return value if self.chance(probability) else None

    # ── numbers ──────────────────────────────────────────────────────────

    def integer(self, low: int, high: int) -> int:
        return self._random.randint(low, high)

    def money(self, low: float, high: float, *, step: int = 50) -> float:
        raw = self._random.uniform(low, high)
        return float(round(raw / step) * step)

    def decimal(self, low: float, high: float, *, places: int = 2) -> float:
        return round(self._random.uniform(low, high), places)

    def spread(self, total: int, buckets: int) -> list[int]:
        """Split `total` into `buckets` positive-ish parts that sum exactly."""
        if buckets <= 0:
            return []
        cuts = sorted(self._random.randint(0, total) for _ in range(buckets - 1))
        edges = [0, *cuts, total]
        return [edges[i + 1] - edges[i] for i in range(buckets)]

    # ── time ─────────────────────────────────────────────────────────────

    def ago(self, *, days_min: int = 0, days_max: int = 365) -> datetime:
        """A moment in the past, uniformly."""
        seconds = self._random.randint(days_min * 86_400, max(days_max * 86_400, days_min * 86_400))
        return self.anchor - timedelta(seconds=seconds)

    def recent(self, *, days: int = 90, bias: float = 2.4) -> datetime:
        """A moment in the past, weighted towards *now*.

        Real systems have far more activity this week than in the same week
        last year, and a uniform spread makes every "recent activity" panel
        look empty.
        """
        fraction = self._random.random() ** bias
        return self.anchor - timedelta(seconds=fraction * days * 86_400)

    def ahead(self, *, days_min: int = 1, days_max: int = 120) -> datetime:
        seconds = self._random.randint(days_min * 86_400, days_max * 86_400)
        return self.anchor + timedelta(seconds=seconds)

    def between(self, start: datetime, end: datetime) -> datetime:
        if end <= start:
            return start
        span = int((end - start).total_seconds())
        return start + timedelta(seconds=self._random.randint(0, span))

    def business_hour(self, moment: datetime) -> datetime:
        """Move a timestamp into a plausible working hour.

        Charts bucketed by hour are unreadable when events are spread evenly
        across the night.
        """
        return moment.replace(
            hour=self._random.randint(8, 18),
            minute=self._random.randint(0, 59),
            second=self._random.randint(0, 59),
            microsecond=0,
        )


# ── formatting helpers ───────────────────────────────────────────────────


def slugify(value: str, *, limit: int = 80) -> str:
    normalised = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return _SLUG_STRIP.sub("-", normalised.lower()).strip("-")[:limit] or "item"


def initials_of(name: str) -> str:
    parts = [part for part in name.split() if part]
    return "".join(part[0] for part in parts[:2]).upper() or "?"


def reference(prefix: str, number: int, *, width: int = 5) -> str:
    return f"{prefix}-{number:0{width}d}"


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
