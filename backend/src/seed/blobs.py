"""Real bytes for the seeded files (§20).

Before MinIO existed, a seeded file was a row with a `storage_key` pointing at
nothing — and the comment in `content.py` said as much. A file manager whose
every download fails is not a demonstration of a file manager, so the seed now
writes an actual object for each file it creates.

**Every format here is one this module can genuinely produce.** A `.xlsx` whose
bytes are plain text is not a spreadsheet: it is a file that looks fine in a
list and fails in the application the reader opens it with, which is worse than
not offering it. So the catalogue was narrowed to the formats a generator can
write honestly — text, markdown, CSV, JSON, logs, SVG, and the two binary
formats small enough to emit by hand.

The content is generated from the file's own name and folder, so a downloaded
document is *about* the thing the list said it was.
"""

from __future__ import annotations

import hashlib
import json
import zlib
#: The demo images' own four inks. Not the product's palette, which lives in
#: `frontend/src/theme/tokens.ts` where the interface can read it — these are
#: bytes inside a seeded file, the way the colours inside somebody's uploaded
#: screenshot are.
_INK: tuple[tuple[int, int, int], ...] = (
    (91, 91, 214),
    (8, 145, 178),
    (22, 163, 74),
    (202, 138, 4),
)
_PAPER = (248, 250, 252)
_AXIS = (203, 213, 225)

#: A PNG that is actually a picture, assembled rather than pasted as base64 so
#: the chunk structure is visible and the CRCs are computed rather than
#: trusted.
#:
#: It used to be a 1×1 transparent pixel — valid, 68 bytes, and *invisible*.
#: The file manager's preview pane (§20) then showed an empty frame for every
#: seeded image, which is indistinguishable from a broken one. A chart-shaped
#: image derived from the file's own name costs forty lines and no dependency,
#: and it makes the demo's images demonstrate something.
def _png(name: str = "", width: int = 480, height: int = 300) -> bytes:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        body = kind + payload
        return (
            len(payload).to_bytes(4, "big")
            + body
            + zlib.crc32(body).to_bytes(4, "big")
        )

    # Deterministic from the name: two files are two different pictures, and
    # the same file is the same bytes on every seed (§57).
    digest = hashlib.sha256(name.encode("utf-8")).digest()
    bars = 8
    gap = 10
    margin = 24
    span = (width - 2 * margin - gap * (bars - 1)) // bars
    heights = [
        margin + int((height - 2 * margin) * (0.25 + 0.75 * (digest[index] / 255)))
        for index in range(bars)
    ]

    rows: list[bytes] = []
    for y in range(height):
        row = bytearray()
        for x in range(width):
            colour = _PAPER
            # The baseline, so the bars stand on something.
            if height - margin <= y <= height - margin + 1:
                colour = _AXIS
            else:
                offset = x - margin
                if 0 <= offset:
                    index = offset // (span + gap)
                    within = offset - index * (span + gap)
                    if index < bars and within < span:
                        top = height - margin - heights[index]
                        if top <= y < height - margin:
                            colour = _INK[index % len(_INK)]
            row.extend(colour)
        # Filter byte 0 (None) per scanline: the simplest of the five, and the
        # only one worth hand-writing.
        rows.append(b"\x00" + bytes(row))

    header = (
        width.to_bytes(4, "big")
        + height.to_bytes(4, "big")
        # 8 bits per channel, colour type 2 (truecolour, no alpha).
        + bytes([8, 2, 0, 0, 0])
    )
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(b"".join(rows), 9))
        + chunk(b"IEND", b"")
    )


def _pdf(title: str, body: str) -> bytes:
    """A minimal, valid single-page PDF. Opens in a reader; says what it is."""
    text = f"BT /F1 14 Tf 56 720 Td ({_pdf_escape(title)}) Tj ET\n"
    text += f"BT /F1 10 Tf 56 690 Td ({_pdf_escape(body)}) Tj ET"
    stream = text.encode("latin-1", "replace")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body_bytes in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body_bytes + b"\nendobj\n"

    start = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{start}\n".encode()
        + b"%%EOF\n"
    )
    return bytes(out)


def _pdf_escape(text: str) -> str:
    return text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def body_for(name: str, extension: str, folder: str, preview: str | None) -> bytes:
    """The bytes one seeded file should contain.

    Generated from the file's own name and folder, so a downloaded document is
    about the thing the list said it was — a demo whose files all contain
    "lorem ipsum" teaches nobody whether the preview pane works.
    """
    heading = name.rsplit(".", 1)[0]
    note = preview or f"Prepared for {folder}. Generated by the Nucleus seed."

    if extension == "json":
        return json.dumps(
            {"title": heading, "folder": folder, "note": note, "generated_by": "nucleus-seed"},
            indent=2,
        ).encode()

    if extension == "csv":
        rows = ["period,opened,closed,carried"]
        rows += [f"2026-{month:02d},{month * 7},{month * 5},{month * 2}" for month in range(1, 13)]
        return "\n".join(rows).encode()

    if extension == "log":
        lines = [
            f"2026-03-{day:02d}T09:00:00Z INFO  {heading}: reconciliation started"
            for day in range(1, 9)
        ]
        lines.append("2026-03-09T09:00:00Z WARN  three records carried forward")
        return "\n".join(lines).encode()

    if extension == "md":
        return (
            f"# {heading}\n\n{note}\n\n"
            "## Scope\n\nEverything in this document is generated demo content.\n"
        ).encode()

    if extension == "svg":
        return (
            '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80">'
            '<rect width="240" height="80" fill="#eeeefc"/>'
            f'<text x="16" y="46" font-family="sans-serif" font-size="14" fill="#332f96">'
            f"{heading[:26]}</text></svg>"
        ).encode()

    if extension == "png":
        return _png(name)

    if extension == "pdf":
        return _pdf(heading, note)

    return f"{heading}\n\n{note}\n".encode()


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
