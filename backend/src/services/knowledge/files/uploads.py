"""Uploading (begin, confirm, receive bytes) and download URLs."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from src.core import audit, storage
from src.core.clock import now
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.models.content import FileObject
from src.services.knowledge.files.browsing import (
    MANAGE_PERMISSION,
    READY,
    UPLOADING,
    VIEW_PERMISSION,
)
from src.services.knowledge.files.serializers import (
    _file,
    _folder_of,
    _kind_for,
    _serialize,
)


def begin_upload(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """A place to put the bytes, and a row that says they are coming.

    Two phases, because a presigned upload goes straight to storage and this
    process never sees it. The row exists so the upload has an id to confirm
    against and so a failed upload is *visible* rather than absent.
    """
    principal.require(MANAGE_PERMISSION)
    if not isinstance(payload, dict):
        raise ValidationError("The upload must be a JSON object.")

    name = str(payload.get("name") or "").strip()
    if not name:
        raise ValidationError("A file needs a name.")
    size = int(payload.get("size_bytes") or 0)
    storage.refuse_unacceptable(name, size)

    folder = _folder_of(session, payload.get("folder_id"))
    content_type = storage.content_type_for(name, str(payload.get("mime_type") or ""))
    extension = storage.extension_of(name)

    # The key is generated, never taken from the client. A key built from a
    # name is a key somebody can aim at another object with `../`, and the
    # name a person gave the file is metadata in PostgreSQL anyway.
    key = storage.key_for(
        "files",
        folder.path.strip("/") if folder else "unfiled",
        f"{uuid4().hex}{'.' + extension if extension else ''}",
    )

    row = FileObject(
        name=name[:255],
        extension=extension or None,
        mime_type=content_type,
        kind=_kind_for(extension),
        size_bytes=size,
        storage_key=key,
        folder_id=folder.id if folder else None,
        organization_id=principal.organization_id,
        owner_id=principal.user_id,
        status=UPLOADING,
        visibility="PRIVATE",
    )
    session.add(row)
    session.flush()

    signed = storage.for_config().upload_url(key, content_type=content_type)
    return {
        "file": _serialize(row),
        "upload": {
            "url": signed.url,
            "method": signed.method,
            "expires_in": signed.expires_in,
            "headers": signed.headers,
        },
    }


def confirm_upload(session, file_id: Any, *, principal) -> dict[str, Any]:
    """Check the object is actually there, then let the file be seen.

    `stat` rather than the client's word. A confirmation that trusts the
    caller produces a file list full of rows with nothing behind them, which
    is worse than an upload that visibly failed.
    """
    principal.require(MANAGE_PERMISSION)
    row = _file(session, file_id)

    stored = storage.for_config().stat(row.storage_key or "")
    if stored is None:
        raise ConflictError(
            "Those bytes never arrived. The upload can be retried.",
            details={"file_id": str(row.id), "status": row.status},
        )

    row.size_bytes = stored.size_bytes
    row.checksum = stored.checksum
    row.status = READY
    session.flush()

    audit.record(
        session, action="CREATE", resource_type="file", resource_id=row.id,
        resource_label=row.name, principal=principal,
        after={"name": row.name, "size_bytes": row.size_bytes},
        message=f"uploaded {row.name}",
    )
    return _serialize(row)


def receive_bytes(session, file_id: Any, data: bytes, *, principal) -> dict[str, Any]:
    """Store an upload's bytes sent *through* the API, then confirm it.

    The fallback, not the path: the browser PUTs straight to object storage
    whenever it can. It cannot when storage refuses the page's origin (CORS) —
    an app opened on another host or port than the one storage was told about —
    and failing the upload there is worse than one request through a worker.
    Bounded by `MAX_UPLOAD_MB`, so a fallback can never hold a worker for long.
    """
    from src.config import Config

    principal.require(MANAGE_PERMISSION)
    row = _file(session, file_id)
    if row.status != UPLOADING:
        raise ConflictError("That file has already been uploaded.", details={"status": row.status})
    limit = Config.MAX_UPLOAD_MB * 1024 * 1024
    if len(data) > limit:
        raise ValidationError(
            f"Through the application a file may be at most {Config.MAX_UPLOAD_MB} MB.",
            details={"size_bytes": len(data), "maximum": limit},
        )
    storage.for_config().put(row.storage_key or "", data,
                             content_type=row.mime_type or "application/octet-stream")
    return confirm_upload(session, file_id, principal=principal)


def download_url(
    session, file_id: Any, *, principal, inline: bool = False
) -> dict[str, Any]:
    """A URL the browser follows itself, and a record that it was asked for.

    `inline` asks for the same object framed for *showing* rather than saving
    (§20) — an image in a pane, a PDF in a frame, a text file read in place.
    One word of the response's disposition, not a second copy of the bytes and
    not a second endpoint: a preview that went through the API would put a
    400 MB file back on a worker, which is the thing presigned URLs exist to
    avoid.
    """
    principal.require(VIEW_PERMISSION)
    row = _file(session, file_id)
    if row.status != READY:
        raise ConflictError(
            "That file is still uploading.", details={"status": row.status},
        )

    store = storage.for_config()
    if store.stat(row.storage_key or "") is None:
        # The row is here and the object is not. Said plainly rather than
        # handing out a URL that 404s somewhere else.
        raise NotFoundError(
            "The record is here but the file is not in storage.",
            details={"file_id": str(row.id), "key": row.storage_key},
        )

    signed = store.download_url(row.storage_key or "", filename=row.name, inline=inline)
    # A preview is a *look*, not a download: counting it would make the number
    # beside a file the number of times somebody glanced at it, and the column
    # is called `download_count`.
    if not inline:
        row.download_count = (row.download_count or 0) + 1
    row.last_accessed_at = now()
    session.flush()

    return {
        "file": _serialize(row),
        "download": {
            "url": signed.url,
            "method": signed.method,
            "expires_in": signed.expires_in,
        },
    }
