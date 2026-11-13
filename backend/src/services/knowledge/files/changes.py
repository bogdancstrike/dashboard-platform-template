"""Renaming, moving and removing files and folders."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from src.core import audit, storage
from src.core.clock import now
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.models.content import FileObject, Folder
from src.services.knowledge.files.browsing import MANAGE_PERMISSION
from src.services.knowledge.files.serializers import _file, _folder_of, _serialize


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
