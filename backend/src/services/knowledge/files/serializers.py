"""File kinds, row lookups, and a file as the API returns it."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.core.errors import NotFoundError
from src.core.pagination import parse_uuid
from src.models.content import FileObject, Folder

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
