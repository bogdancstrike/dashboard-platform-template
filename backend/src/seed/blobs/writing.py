"""Seed data for blobs: materialise."""

from __future__ import annotations

import zlib

from src.seed.blobs.bodies import body_for


#: The 1×1 transparent PNG this module used to write for every seeded image.
#:
#: Kept so `materialise` can recognise its own placeholder and replace it — see
#: there for why that is the *only* object it is allowed to overwrite.
def _legacy_pixel() -> bytes:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        body = kind + payload
        return len(payload).to_bytes(4, "big") + body + zlib.crc32(body).to_bytes(4, "big")

    header = (1).to_bytes(4, "big") + (1).to_bytes(4, "big") + bytes([8, 6, 0, 0, 0])
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\x00\x00"))
        + chunk(b"IEND", b"")
    )


def materialise(session, store) -> dict[str, int]:
    """Write the bytes for every ready file that has none, and correct its size.

    Idempotent: a file whose object is already there is left alone, so this is
    safe to run on every seed and on an existing database that predates object
    storage.

    **It never overwrites bytes it did not write.** A library holds real
    uploads as well as seeded rows, and a repair that regenerated every body
    would replace somebody's file with a plausible-looking fake — which is the
    worst outcome available to a function like this.
    
    The one exception is its own former placeholder: every seeded image used to
    be a 1×1 transparent pixel, so the preview pane (§20) showed an empty frame
    for all of them. An object whose bytes are *exactly* that placeholder is
    recognisably this module's, and is replaced with a picture.
    """
    from sqlalchemy import select

    from src.models.content import FileObject, Folder

    written = 0
    skipped = 0
    upgraded = 0
    placeholder = _legacy_pixel()

    rows = session.execute(
        select(FileObject, Folder.path)
        .outerjoin(Folder, Folder.id == FileObject.folder_id)
        .where(FileObject.deleted_at.is_(None), FileObject.status == "READY")
    ).all()

    for row, folder_path in rows:
        if not row.storage_key:
            skipped += 1
            continue
        present = store.stat(row.storage_key)
        if present is not None:
            # The placeholder, and nothing else: identified by its exact bytes
            # rather than by its size, so a real 68-byte upload is safe.
            if present.size_bytes != len(placeholder) or store.get(row.storage_key) != placeholder:
                skipped += 1
                continue
            upgraded += 1

        body = body_for(
            row.name, (row.extension or "").lower(), folder_path or "the library", row.preview_text
        )
        stored = store.put(
            row.storage_key, body, content_type=row.mime_type or "application/octet-stream"
        )
        # The row now describes the object rather than a number the seed made
        # up: a file manager that reports 15 MB and downloads 400 bytes is one
        # nobody trusts twice.
        row.size_bytes = stored.size_bytes
        row.checksum = stored.checksum
        written += 1

    session.flush()
    return {"written": written, "already_present": skipped, "upgraded": upgraded}
