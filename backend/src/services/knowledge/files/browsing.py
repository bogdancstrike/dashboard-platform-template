"""File permissions and states, the folder tree and a folder's listing."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from src.core import storage
from src.core.pagination import envelope, parse_page, parse_uuid
from src.models.content import FileObject, Folder
from src.services.knowledge.files.serializers import _serialize

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
