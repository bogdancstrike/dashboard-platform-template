"""The file manager (§20).

One decision shapes this whole module: **the bytes never pass through the API**.
A browser asks for a presigned URL, uploads straight to object storage, and
then tells the API it is done; a download is a presigned URL the browser
follows itself. An API that streams a 400 MB upload through a gevent worker is
an API whose worker is gone for the duration of it.

That has a consequence worth stating plainly: the API *cannot know* whether the
upload happened. So a file is created in two phases — a row in `UPLOADING`
alongside the URL, and a confirmation that checks the object is actually there
with `stat` before flipping it to `READY`. Trusting the client's "done" would
mean a file list full of rows with nothing behind them, which is worse than an
upload that visibly failed.

Everything else follows the platform's existing shapes: folders are a
materialised-path tree so a breadcrumb is one row read, listing is
`core/pagination`, permissions are `files.view` to read and `files.manage` to
change, and every mutation is audited.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from src.core import audit, storage
from src.core.clock import now
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.pagination import envelope, parse_page, parse_uuid
from src.models.content import FileObject, Folder

VIEW_PERMISSION = "files.view"
MANAGE_PERMISSION = "files.manage"

#: Where a file sits until its bytes are confirmed present.
UPLOADING = "UPLOADING"
READY = "READY"


def tree(session, *, principal) -> dict[str, Any]:
    """Every folder, with what is in it, as one flat list the client nests.

    Flat rather than nested on the wire: the client needs to expand, collapse
    and highlight a path, and a recursive JSON structure makes finding one node
    a traversal. `path` is materialised, so nesting it is a string split.
    """
    principal.require(VIEW_PERMISSION)

    counted = (
        select(
            FileObject.folder_id.label("folder_id"),
            func.count().label("files"),
            func.coalesce(func.sum(FileObject.size_bytes), 0).label("bytes"),
        )
        .where(FileObject.deleted_at.is_(None), FileObject.status == READY)
        .group_by(FileObject.folder_id)
        .subquery()
    )

    rows = session.execute(
        select(Folder, counted.c.files, counted.c.bytes)
        .outerjoin(counted, counted.c.folder_id == Folder.id)
        .where(Folder.deleted_at.is_(None))
        .order_by(Folder.path)
    ).all()

    # Live counts rather than the denormalised `file_count`/`total_size`
    # columns: those are a second description of something one GROUP BY
    # already knows, and wrong the first time anybody moves a file.
    folders = [
        {
            "id": str(folder.id),
            "name": folder.name,
            "path": folder.path,
            "parent_id": str(folder.parent_id) if folder.parent_id else None,
            "depth": folder.path.strip("/").count("/"),
            "color": folder.color,
            "is_shared": bool(folder.is_shared),
            "file_count": int(files or 0),
            "total_bytes": int(byte_count or 0),
            "owner": folder.owner.full_name if folder.owner else "",
        }
        for folder, files, byte_count in rows
    ]

    loose = session.execute(
        select(func.count(), func.coalesce(func.sum(FileObject.size_bytes), 0)).where(
            FileObject.deleted_at.is_(None),
            FileObject.status == READY,
            FileObject.folder_id.is_(None),
        )
    ).one()

    return {
        "folders": folders,
        # Files belonging to no folder are real and have to be reachable, or
        # they are rows nobody can ever see again.
        "unfiled": {"file_count": int(loose[0] or 0), "total_bytes": int(loose[1] or 0)},
        "store": storage.for_config().name,
        "max_upload_bytes": storage.MAX_UPLOAD_BYTES,
        "refused_extensions": sorted(storage.REFUSED_EXTENSIONS),
        "can_manage": principal.can(MANAGE_PERMISSION),
    }


def listing(session, args, *, principal) -> dict[str, Any]:
    """The files in one folder, or the unfiled ones, newest first."""
    principal.require(VIEW_PERMISSION)
    page = parse_page(args or {}, default_sort="created_at")

    statement = (
        select(FileObject)
        .options(selectinload(FileObject.owner))
        .where(FileObject.deleted_at.is_(None))
    )

    folder = (args or {}).get("folder_id")
    if folder in ("", None):
        pass
    elif str(folder) == "unfiled":
        statement = statement.where(FileObject.folder_id.is_(None))
    else:
        statement = statement.where(FileObject.folder_id == parse_uuid(folder, field="folder_id"))

    term = str((args or {}).get("q") or "").strip()
    if term:
        statement = statement.where(FileObject.name.ilike(f"%{term}%"))

    kind = str((args or {}).get("kind") or "").strip()
    if kind:
        statement = statement.where(FileObject.kind == kind)

    total = session.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = session.scalars(
        statement.order_by(FileObject.created_at.desc())
        .offset((page.page - 1) * page.page_size)
        .limit(page.page_size)
    ).unique().all()

    return envelope([_serialize(row) for row in rows], total=total, page=page)


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


def update(session, file_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Rename it, or move it to another folder.

    The object is *not* moved. A storage key is an address, not a path: moving
    bytes to make a tree look tidy is a copy and a delete for something no
    reader ever sees.
    """
    principal.require(MANAGE_PERMISSION)
    row = _file(session, file_id)
    before = {"name": row.name, "folder_id": str(row.folder_id) if row.folder_id else None}

    if "name" in payload:
        name = str(payload.get("name") or "").strip()
        if not name:
            raise ValidationError("A file needs a name.")
        storage.refuse_unacceptable(name, row.size_bytes or 0)
        row.name = name[:255]

    if "folder_id" in payload:
        folder = _folder_of(session, payload.get("folder_id"))
        row.folder_id = folder.id if folder else None

    session.flush()
    audit.record(
        session, action="UPDATE", resource_type="file", resource_id=row.id,
        resource_label=row.name, principal=principal, before=before,
        after={"name": row.name, "folder_id": str(row.folder_id) if row.folder_id else None},
        message=f"changed {row.name}",
    )
    return _serialize(row)


def remove(session, file_id: Any, *, principal) -> dict[str, Any]:
    """Soft-delete the record and remove the object.

    Both, in that order. A row without its bytes is a file somebody will try
    to download; bytes without a row are storage nobody can ever reclaim.
    """
    principal.require(MANAGE_PERMISSION)
    row = _file(session, file_id)
    name = row.name
    key = row.storage_key

    row.deleted_at = now()
    session.flush()
    audit.record(
        session, action="DELETE", resource_type="file", resource_id=row.id,
        resource_label=name, principal=principal,
        before={"name": name, "size_bytes": row.size_bytes},
        message=f"deleted {name}",
    )
    if key:
        storage.for_config().delete(key)
    return {"id": str(row.id), "deleted": True, "name": name}


def create_folder(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """A folder under another, with its path materialised on the way in."""
    principal.require(MANAGE_PERMISSION)
    name = str((payload or {}).get("name") or "").strip()
    if not name:
        raise ValidationError("A folder needs a name.")
    if "/" in name:
        raise ValidationError("A folder name cannot contain a slash.")

    parent = _folder_of(session, (payload or {}).get("parent_id"))
    path = f"{parent.path.rstrip('/')}/{name}" if parent else f"/{name}"

    if session.scalar(
        select(func.count()).select_from(Folder)
        .where(Folder.path == path, Folder.deleted_at.is_(None))
    ):
        raise ConflictError("A folder of that name is already there.", details={"path": path})

    row = Folder(
        name=name[:200],
        path=path[:1000],
        parent_id=parent.id if parent else None,
        organization_id=principal.organization_id,
        owner_id=principal.user_id,
    )
    session.add(row)
    session.flush()
    audit.record(
        session, action="CREATE", resource_type="folder", resource_id=row.id,
        resource_label=row.path, principal=principal, after={"path": row.path},
        message=f"created folder {row.path}", activity=False,
    )
    return {
        "id": str(row.id),
        "name": row.name,
        "path": row.path,
        "parent_id": str(row.parent_id) if row.parent_id else None,
        "depth": row.path.strip("/").count("/"),
        "color": row.color,
        "is_shared": False,
        "file_count": 0,
        "total_bytes": 0,
        "owner": "",
    }


def remove_folder(session, folder_id: Any, *, principal) -> dict[str, Any]:
    """Only an empty one. A recursive delete of a tree of files is a mistake
    somebody makes once and cannot undo."""
    principal.require(MANAGE_PERMISSION)
    identifier = parse_uuid(folder_id, field="folder_id")
    row = session.scalars(
        select(Folder).where(Folder.id == identifier, Folder.deleted_at.is_(None))
    ).first()
    if row is None:
        raise NotFoundError("That folder does not exist.", details={"id": str(identifier)})

    files = session.scalar(
        select(func.count()).select_from(FileObject)
        .where(FileObject.folder_id == row.id, FileObject.deleted_at.is_(None))
    ) or 0
    children = session.scalar(
        select(func.count()).select_from(Folder)
        .where(Folder.parent_id == row.id, Folder.deleted_at.is_(None))
    ) or 0
    if files or children:
        raise ConflictError(
            "That folder is not empty. Move or delete what is in it first.",
            details={"files": int(files), "folders": int(children)},
        )

    path = row.path
    row.deleted_at = now()
    audit.record(
        session, action="DELETE", resource_type="folder", resource_id=row.id,
        resource_label=path, principal=principal, before={"path": path},
        message=f"deleted folder {path}", activity=False,
    )
    return {"id": str(row.id), "deleted": True, "path": path}


# ── plumbing ─────────────────────────────────────────────────────────────

#: Extension → the kind a file list groups and filters by. Coarse on purpose:
#: a reader wants "the spreadsheets", not "the xlsx files".
_KINDS: dict[str, tuple[str, ...]] = {
    "IMAGE": ("png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"),
    "SPREADSHEET": ("xlsx", "xls", "csv", "tsv", "ods"),
    "DOCUMENT": ("pdf", "doc", "docx", "odt", "rtf", "md", "txt"),
    "PRESENTATION": ("pptx", "ppt", "odp", "key"),
    "ARCHIVE": ("zip", "tar", "gz", "bz2", "7z", "rar"),
    "DATA": ("json", "xml", "yaml", "yml", "parquet", "sql"),
}


def _kind_for(extension: str) -> str:
    for kind, extensions in _KINDS.items():
        if extension in extensions:
            return kind
    return "OTHER"


def _file(session, file_id: Any) -> FileObject:
    identifier = parse_uuid(file_id, field="file_id")
    row = session.scalars(
        select(FileObject)
        .options(selectinload(FileObject.owner))
        .where(FileObject.id == identifier, FileObject.deleted_at.is_(None))
    ).first()
    if row is None:
        raise NotFoundError("That file does not exist.", details={"id": str(identifier)})
    return row


def _folder_of(session, folder_id: Any) -> Folder | None:
    if folder_id in (None, "", "unfiled"):
        return None
    identifier = parse_uuid(folder_id, field="folder_id")
    row = session.scalars(
        select(Folder).where(Folder.id == identifier, Folder.deleted_at.is_(None))
    ).first()
    if row is None:
        raise NotFoundError("That folder does not exist.", details={"id": str(identifier)})
    return row


def _serialize(row: FileObject) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "name": row.name,
        "extension": row.extension,
        "mime_type": row.mime_type,
        "kind": row.kind,
        "size_bytes": int(row.size_bytes or 0),
        "checksum": row.checksum,
        "folder_id": str(row.folder_id) if row.folder_id else None,
        "status": row.status,
        "version": row.version,
        "download_count": int(row.download_count or 0),
        "preview_text": row.preview_text,
        "owner": row.owner.full_name if row.owner else "",
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "last_accessed_at": row.last_accessed_at.isoformat() if row.last_accessed_at else None,
    }
