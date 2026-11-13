"""Object keys, extensions, content types, and refusing unacceptable files."""

from __future__ import annotations

import mimetypes
import pathlib

from src.core.errors import ValidationError
from src.core.storage.base import MAX_UPLOAD_BYTES, REFUSED_EXTENSIONS


def key_for(*parts: str) -> str:
    """A storage key from path segments, with nothing a client chose in it.

    The name a person gave a file is metadata in PostgreSQL; the key is
    generated. A key built from user input is a key somebody can aim at
    somebody else's object with `../`, and sanitising a path is a game nobody
    wins twice.
    """
    cleaned = [segment.strip().strip("/").strip() for segment in parts]
    cleaned = [segment for segment in cleaned if segment]
    if not cleaned:
        raise ValidationError("A storage key needs at least one segment.")
    # Belt and braces at the key level as well as in the local store's path
    # resolution: a key is generated here, but this function is the one place
    # every key in the platform is built, so it is the cheapest place to make
    # a traversal impossible rather than merely unlikely.
    if any(segment in ("..", ".") for segment in cleaned):
        raise ValidationError(
            "A storage key segment cannot be a relative path.",
            details={"segments": cleaned},
        )
    return "/".join(cleaned)


def extension_of(filename: str) -> str:
    return (pathlib.PurePosixPath(filename).suffix or "").lstrip(".").lower()


def content_type_for(filename: str, declared: str = "") -> str:
    """What the bytes are, preferring the name over what the client claimed.

    A client that says `image/png` about a `.sh` is either confused or trying
    something; the extension is the thing a later reader will act on.
    """
    guessed, _encoding = mimetypes.guess_type(filename)
    return guessed or declared or "application/octet-stream"


def refuse_unacceptable(filename: str, size_bytes: int) -> None:
    """Say no before a URL is issued, not after the bytes have moved."""
    extension = extension_of(filename)
    if extension in REFUSED_EXTENSIONS:
        raise ValidationError(
            "That kind of file is not accepted here.",
            details={"extension": extension, "refused": sorted(REFUSED_EXTENSIONS)},
        )
    if size_bytes < 0 or size_bytes > MAX_UPLOAD_BYTES:
        raise ValidationError(
            f"A file may be at most {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
            details={"size_bytes": size_bytes, "maximum": MAX_UPLOAD_BYTES},
        )
