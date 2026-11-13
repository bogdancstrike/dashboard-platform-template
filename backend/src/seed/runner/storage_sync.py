"""Repairs for files, exports and imports."""

from __future__ import annotations

from src.seed import blobs
from src.seed import exports as export_files
from src.seed import imports as import_runs


def sync_files(session) -> dict[str, int]:
    """Write the bytes for every seeded file that has none.

    Separate from `run` so it also serves an *existing* database — this one
    predates object storage, and its twenty file rows point at objects that
    were never written. Idempotent, so it is safe on every seed too.
    """
    from src.core import storage

    return blobs.materialise(session, storage.for_config())


def sync_exports(session) -> dict[str, int]:
    """Make every seeded export true, and write the file it claims (§30).

    Separate from `run` for the same reason `sync_files` is: it also serves an
    existing database, whose export rows claimed an artefact nobody had written
    and a row count that was a progress counter. Idempotent — an export whose
    object is already there is left alone.
    """
    from src.core import storage

    return export_files.materialise(session, storage.for_config())


def sync_imports(session) -> dict[str, int]:
    """Make every seeded import run describe a file that could exist (§29).

    The third content repair, and the one with the most to fix: the seeded
    runs had counts that could not all be true, mappings onto fields their
    target does not accept, more rows than an import may carry, and open
    drafts with nothing staged — so resuming one showed an empty wizard.
    Idempotent; a run that is already true is left alone.
    """
    return import_runs.materialise(session)
